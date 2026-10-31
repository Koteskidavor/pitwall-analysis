import { type BinaryAsset, type Storage } from './storage';
import {
  sessionSchema,
  type Session,
  driverSchema,
  type Driver,
  resultSchema,
  type Result,
  lapSchema,
  type Lap,
  stintSchema,
  type Stint,
  pitStopSchema,
  type PitStop,
  eventSchema,
  type Event,
  validateManifest,
  validateTrack,
  type Manifest,
  type Track,
  type ZodSchema,
} from '@pitwall/shared';
import Database from 'better-sqlite3';
import { join, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

export interface StorageLogger {
  warn: (details: unknown, message?: string) => void;
}

// Reads processed session data from disk. Sessions are discovered by scanning
// DATA_ROOT/sessions, and one read-only SQLite connection is opened lazily per
// session (and cached) so listing many sessions stays cheap.
export class SqliteStorage implements Storage {
  private readonly rootPath: string;
  private readonly connections = new Map<string, Database.Database>();

  constructor(
    rootPath: string,
    private readonly logger?: StorageLogger,
  ) {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const projectRoot = join(currentDir, '..', '..', '..');
    this.rootPath = isAbsolute(rootPath) ? rootPath : join(projectRoot, rootPath);
  }

  private sessionDir(sessionId: string): string {
    return join(this.rootPath, 'sessions', sessionId);
  }

  private openSessionDb(sessionId: string): Database.Database | null {
    const cached = this.connections.get(sessionId);
    if (cached) return cached;

    const dbPath = join(this.sessionDir(sessionId), 'data.sqlite');
    if (!existsSync(dbPath)) return null;

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    this.connections.set(sessionId, db);
    return db;
  }

  private all<T>(sessionId: string, sql: string, ...params: unknown[]): T[] {
    const db = this.openSessionDb(sessionId);
    if (!db) return [];
    try {
      return db.prepare(sql).all(...params) as T[];
    } catch (error) {
      // A session processed by an older schema may be missing a table or column;
      // treat only that as an empty result. Anything else (for example a corrupt
      // database file) must not be swallowed silently.
      if (isMissingSchema(error)) return [];
      throw error;
    }
  }

  private parseRows<T>(
    schema: ZodSchema<T>,
    rows: Record<string, unknown>[],
    sessionId: string,
    table: string,
  ): T[] {
    const parsed: T[] = [];

    for (const row of rows) {
      const result = schema.safeParse(row);
      if (result.success) {
        parsed.push(result.data);
      } else {
        this.logger?.warn(
          { sessionId, table, issues: result.error.issues },
          'Skipping row that failed validation',
        );
      }
    }

    return parsed;
  }

  private sessionIds(): string[] {
    const dir = join(this.rootPath, 'sessions');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((entry) => {
      try {
        return (
          statSync(join(dir, entry)).isDirectory() &&
          existsSync(join(dir, entry, 'data.sqlite'))
        );
      } catch {
        return false;
      }
    });
  }

  // ---- Static artifacts -------------------------------------------------

  async readManifest(sessionId: string): Promise<Manifest | null> {
    const path = join(this.sessionDir(sessionId), 'manifest.json');
    try {
      return validateManifest(JSON.parse(await readFile(path, 'utf8')));
    } catch {
      return null;
    }
  }

  async readTrack(sessionId: string): Promise<Track | null> {
    const path = join(this.sessionDir(sessionId), 'track.json');
    try {
      return validateTrack(JSON.parse(await readFile(path, 'utf8')));
    } catch {
      return null;
    }
  }

  async readBinary(sessionId: string, asset: BinaryAsset): Promise<Buffer | null> {
    const filePath =
      asset.type === 'motion'
        ? join(
            this.sessionDir(sessionId),
            'motion',
            `${String(asset.chunkIndex).padStart(3, '0')}.bin`,
          )
        : join(this.sessionDir(sessionId), 'gaps.bin');

    try {
      return await readFile(filePath);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  // ---- Sessions ---------------------------------------------------------

  // A session is only "full telemetry" when the manifest advertises motion and
  // at least one motion chunk actually exists on disk. Older ingests wrote only
  // results, so those sessions open without the replay panels.
  private hasMotion(sessionId: string, manifest: Manifest | null): boolean {
    if (!manifest?.availableLayers.includes('motion')) return false;
    const dir = join(this.sessionDir(sessionId), 'motion');
    if (!existsSync(dir)) return false;
    try {
      return readdirSync(dir).some((file) => file.endsWith('.bin'));
    } catch {
      return false;
    }
  }

  private async enrich(session: Session): Promise<Session> {
    const manifest = await this.readManifest(session.id);
    const track = await this.readTrack(session.id);
    const winner =
      this.all<{ driverId: string }>(
        session.id,
        'SELECT driver_id AS driverId FROM results WHERE position = 1 LIMIT 1',
      )[0]?.driverId ?? null;

    return {
      ...session,
      dataTier: this.hasMotion(session.id, manifest) ? 'full' : 'results',
      trackOutline: track?.outline,
      winner,
    };
  }

  async getSessions(): Promise<Session[]> {
    const sessions: Session[] = [];
    for (const id of this.sessionIds()) {
      try {
        const rows = this.all<Record<string, unknown>>(id, 'SELECT * FROM sessions');
        const valid = this.parseRows(sessionSchema, rows, id, 'sessions');
        sessions.push(
          ...(await Promise.all(valid.map((session) => this.enrich(session)))),
        );
      } catch (error) {
        // One unreadable session (for example a corrupt database) should not
        // take down the whole library, but it should be visible in the logs.
        this.logger?.warn({ sessionId: id, err: error }, 'Skipping unreadable session');
      }
    }
    return sessions;
  }

  async getSessionById(id: string): Promise<Session | null> {
    const rows = this.all<Record<string, unknown>>(
      id,
      'SELECT * FROM sessions WHERE id = ?',
      id,
    );
    const sessions = this.parseRows(sessionSchema, rows, id, 'sessions');
    if (sessions.length === 0) return null;
    return this.enrich(sessions[0]);
  }

  async hasSession(id: string): Promise<boolean> {
    const rows = this.all<{ id: string }>(
      id,
      'SELECT id FROM sessions WHERE id = ? LIMIT 1',
      id,
    );
    return rows.length > 0;
  }

  // ---- Drivers and results ---------------------------------------------

  async getDriversBySessionId(sessionId: string): Promise<Driver[]> {
    const rows = this.all<Record<string, unknown>>(sessionId, 'SELECT * FROM drivers');
    return this.parseRows(driverSchema, rows, sessionId, 'drivers');
  }

  async getResultsBySessionId(sessionId: string): Promise<Result[]> {
    const rows = this.all<Record<string, unknown>>(
      sessionId,
      `SELECT driver_id AS driverId, position, time_ms, gap_ms, grid_position, points
         FROM results ORDER BY position`,
    );
    return this.parseRows(resultSchema, rows, sessionId, 'results');
  }

  // ---- Laps -------------------------------------------------------------

  async getLapsBySessionId(sessionId: string): Promise<Lap[]> {
    const rows = this.all<Record<string, unknown>>(
      sessionId,
      'SELECT *, driver_id AS driverId FROM laps',
    );
    return this.parseRows(lapSchema, rows, sessionId, 'laps');
  }

  async getLapsByDriverAndSession(driverId: string, sessionId: string): Promise<Lap[]> {
    const rows = this.all<Record<string, unknown>>(
      sessionId,
      'SELECT *, driver_id AS driverId FROM laps WHERE driver_id = ? ORDER BY lap',
      driverId,
    );
    return this.parseRows(lapSchema, rows, sessionId, 'laps');
  }

  // ---- Stints -----------------------------------------------------------

  async getStintsBySessionId(sessionId: string): Promise<Stint[]> {
    const rows = this.all<Record<string, unknown>>(
      sessionId,
      'SELECT *, driver_id AS driverId FROM stints',
    );
    return this.parseRows(stintSchema, rows, sessionId, 'stints');
  }

  async getStintsByDriverAndSession(driverId: string, sessionId: string): Promise<Stint[]> {
    const rows = this.all<Record<string, unknown>>(
      sessionId,
      'SELECT *, driver_id AS driverId FROM stints WHERE driver_id = ?',
      driverId,
    );
    return this.parseRows(stintSchema, rows, sessionId, 'stints');
  }

  // ---- Pit stops --------------------------------------------------------

  async getPitStopsBySessionId(sessionId: string): Promise<PitStop[]> {
    const rows = this.all<Record<string, unknown>>(
      sessionId,
      'SELECT *, driver_id AS driverId FROM pit_stops',
    );
    return this.parseRows(pitStopSchema, rows, sessionId, 'pit_stops');
  }

  async getPitStopsByDriverAndSession(driverId: string, sessionId: string): Promise<PitStop[]> {
    const rows = this.all<Record<string, unknown>>(
      sessionId,
      'SELECT *, driver_id AS driverId FROM pit_stops WHERE driver_id = ?',
      driverId,
    );
    return this.parseRows(pitStopSchema, rows, sessionId, 'pit_stops');
  }

  // ---- Events -----------------------------------------------------------

  async getEventsBySessionId(sessionId: string): Promise<Event[]> {
    const rows = this.all<Record<string, unknown>>(
      sessionId,
      'SELECT *, driver_id AS driverId FROM events',
    );
    return this.parseRows(eventSchema, rows, sessionId, 'events');
  }

  async getEventsByDriverAndSession(driverId: string, sessionId: string): Promise<Event[]> {
    const rows = this.all<Record<string, unknown>>(
      sessionId,
      'SELECT *, driver_id AS driverId FROM events WHERE driver_id = ? OR driver_id IS NULL',
      driverId,
    );
    return this.parseRows(eventSchema, rows, sessionId, 'events');
  }

  close(): void {
    for (const db of this.connections.values()) db.close();
    this.connections.clear();
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function isMissingSchema(error: unknown): boolean {
  return (
    error instanceof Error &&
    /no such (?:table|column):/i.test(error.message)
  );
}
