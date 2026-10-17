import { Storage } from '../storage';
import {
  sessionSchema,
  type Session,
  lapSchema,
  type Lap,
  stintSchema,
  type Stint,
  pitStopSchema,
  type PitStop,
  eventSchema,
  type Event
} from '../../../shared/src/schemas';
import Database from 'better-sqlite3';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync } from 'fs';

export class SqliteStorage implements Storage {
  private db: Database.Database;
  private readonly rootPath: string;

  constructor(rootPath: string) {
    // Convert to absolute path relative to project root
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // Go up two levels from src/storage to project root: src/storage -> src -> api -> project root
    const projectRoot = join(__dirname, '..', '..', '..');
    const absoluteRootPath = join(projectRoot, rootPath);

    this.rootPath = absoluteRootPath;
    const dbPath = join(this.rootPath, 'sessions', '2023_2_Race', 'data.sqlite');
    console.log(`Opening database at: ${dbPath}`);
    console.log(`Current working directory: ${process.cwd()}`);
    console.log(`Project root: ${projectRoot}`);
    console.log(`Root path: ${this.rootPath}`);

    // Check if directory exists
    const sessionsDir = join(this.rootPath, 'sessions', '2023_2_Race');
    console.log(`Sessions directory exists: ${existsSync(sessionsDir)}`);
    console.log(`Database file exists: ${existsSync(dbPath)}`);

    // Open database in read-only mode
    this.db = new Database(dbPath, {
      readonly: true,
    });

    // Debug: List tables
    console.log('Listing tables:');
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log(tables);

    // Debug: Check sessions table structure
    if (tables.some((t: any) => t.name === 'sessions')) {
      console.log('Sessions table structure:');
      const columns = this.db.prepare("PRAGMA table_info(sessions)").all();
      console.log(columns);

      // Debug: Count sessions
      const count = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get();
      console.log(`Session count: ${JSON.stringify(count)}`);
    }
  }

  async read(url: string): Promise<ArrayBuffer> {
    // For now, we'll implement this based on what we need for the API
    // This is a placeholder that will be enhanced as needed
    throw new Error('Method not implemented.');
  }

  async exists(url: string): Promise<boolean> {
    // Placeholder implementation
    throw new Error('Method not implemented.');
  }

  // Additional methods for session data
  async getSessions(): Promise<Session[]> {
    console.log('Fetching sessions...');
    try {
      const rows = this.db.prepare('SELECT * FROM sessions').all();
      console.log(`Query executed, found ${rows.length} rows`);
      if (rows.length > 0) {
        console.log('First row:', JSON.stringify(rows[0]));
      }
      const sessions = rows.map((row: any) => {
        try {
          return sessionSchema.parse(row);
        } catch (e) {
          console.error('Error parsing row:', row, e);
          throw e;
        }
      });
      console.log(`Successfully parsed ${sessions.length} sessions`);
      return sessions;
    } catch (error) {
      console.error('Error in getSessions:', error);
      throw error;
    }
  }

  async getSessionById(id: string): Promise<Session | null> {
    console.log(`Fetching session with ID: ${id}`);
    try {
      const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
      console.log(`Query for ID ${id} returned:`, row);
      if (!row) {
        console.log(`No session found with ID: ${id}`);
        return null;
      }
      const session = sessionSchema.parse(row);
      console.log(`Successfully parsed session:`, session);
      return session;
    } catch (error) {
      console.error(`Error in getSessionById for ID ${id}:`, error);
      throw error;
    }
  }

  // Lap data methods
  async getLapsBySessionId(sessionId: string): Promise<Lap[]> {
    console.log(`Fetching laps for session ID: ${sessionId}`);
    try {
      // First check if session exists
      const session = await this.getSessionById(sessionId);
      if (!session) {
        return [];
      }

      const rows = this.db.prepare('SELECT *, driver_id AS driverId FROM laps').all();
      console.log(`Query executed, found ${rows.length} lap rows`);
      const laps = rows.map((row: any) => {
        try {
          return lapSchema.parse(row);
        } catch (e) {
          console.error('Error parsing lap row:', row, e);
          throw e;
        }
      });
      console.log(`Successfully parsed ${laps.length} laps`);
      return laps;
    } catch (error) {
      console.error('Error in getLapsBySessionId:', error);
      throw error;
    }
  }

  async getLapsByDriverAndSession(driverId: string, sessionId: string): Promise<Lap[]> {
    console.log(`Fetching laps for driver ${driverId} in session ${sessionId}`);
    try {
      // First check if session exists
      const session = await this.getSessionById(sessionId);
      if (!session) {
        return [];
      }

      const rows = this.db.prepare('SELECT *, driver_id AS driverId FROM laps WHERE driver_id = ?').all(driverId);
      console.log(`Query executed, found ${rows.length} lap rows for driver ${driverId}`);
      const laps = rows.map((row: any) => {
        try {
          return lapSchema.parse(row);
        } catch (e) {
          console.error('Error parsing lap row:', row, e);
          throw e;
        }
      });
      console.log(`Successfully parsed ${laps.length} laps for driver ${driverId}`);
      return laps;
    } catch (error) {
      console.error('Error in getLapsByDriverAndSession:', error);
      throw error;
    }
  }

  // Stint data methods
  async getStintsBySessionId(sessionId: string): Promise<Stint[]> {
    console.log(`Fetching stints for session ID: ${sessionId}`);
    try {
      // First check if session exists
      const session = await this.getSessionById(sessionId);
      if (!session) {
        return [];
      }

      const rows = this.db.prepare('SELECT *, driver_id AS driverId FROM stints').all();
      console.log(`Query executed, found ${rows.length} stint rows`);
      const stints = rows.map((row: any) => {
        try {
          return stintSchema.parse(row);
        } catch (e) {
          console.error('Error parsing stint row:', row, e);
          throw e;
        }
      });
      console.log(`Successfully parsed ${stints.length} stints`);
      return stints;
    } catch (error) {
      console.error('Error in getStintsBySessionId:', error);
      throw error;
    }
  }

  async getStintsByDriverAndSession(driverId: string, sessionId: string): Promise<Stint[]> {
    console.log(`Fetching stints for driver ${driverId} in session ${sessionId}`);
    try {
      // First check if session exists
      const session = await this.getSessionById(sessionId);
      if (!session) {
        return [];
      }

      const rows = this.db.prepare('SELECT *, driver_id AS driverId FROM stints WHERE driver_id = ?').all(driverId);
      console.log(`Query executed, found ${rows.length} stint rows for driver ${driverId}`);
      const stints = rows.map((row: any) => {
        try {
          return stintSchema.parse(row);
        } catch (e) {
          console.error('Error parsing stint row:', row, e);
          throw e;
        }
      });
      console.log(`Successfully parsed ${stints.length} stints for driver ${driverId}`);
      return stints;
    } catch (error) {
      console.error('Error in getStintsByDriverAndSession:', error);
      throw error;
    }
  }

  // Pit stop data methods
  async getPitStopsBySessionId(sessionId: string): Promise<PitStop[]> {
    console.log(`Fetching pit stops for session ID: ${sessionId}`);
    try {
      // First check if session exists
      const session = await this.getSessionById(sessionId);
      if (!session) {
        return [];
      }

      const rows = this.db.prepare('SELECT *, driver_id AS driverId FROM pit_stops').all();
      console.log(`Query executed, found ${rows.length} pit stop rows`);
      const pitStops = rows.map((row: any) => {
        try {
          return pitStopSchema.parse(row);
        } catch (e) {
          console.error('Error parsing pit stop row:', row, e);
          throw e;
        }
      });
      console.log(`Successfully parsed ${pitStops.length} pit stops`);
      return pitStops;
    } catch (error) {
      console.error('Error in getPitStopsBySessionId:', error);
      throw error;
    }
  }

  async getPitStopsByDriverAndSession(driverId: string, sessionId: string): Promise<PitStop[]> {
    console.log(`Fetching pit stops for driver ${driverId} in session ${sessionId}`);
    try {
      // First check if session exists
      const session = await this.getSessionById(sessionId);
      if (!session) {
        return [];
      }

      const rows = this.db.prepare('SELECT *, driver_id AS driverId FROM pit_stops WHERE driver_id = ?').all(driverId);
      console.log(`Query executed, found ${rows.length} pit stop rows for driver ${driverId}`);
      const pitStops = rows.map((row: any) => {
        try {
          return pitStopSchema.parse(row);
        } catch (e) {
          console.error('Error parsing pit stop row:', row, e);
          throw e;
        }
      });
      console.log(`Successfully parsed ${pitStops.length} pit stops for driver ${driverId}`);
      return pitStops;
    } catch (error) {
      console.error('Error in getPitStopsByDriverAndSession:', error);
      throw error;
    }
  }

  // Event data methods
  async getEventsBySessionId(sessionId: string): Promise<Event[]> {
    console.log(`Fetching events for session ID: ${sessionId}`);
    try {
      // First check if session exists
      const session = await this.getSessionById(sessionId);
      if (!session) {
        return [];
      }

      const rows = this.db.prepare('SELECT *, driver_id AS driverId FROM events').all();
      console.log(`Query executed, found ${rows.length} event rows`);
      const events = rows.map((row: any) => {
        try {
          return eventSchema.parse(row);
        } catch (e) {
          console.error('Error parsing event row:', row, e);
          throw e;
        }
      });
      console.log(`Successfully parsed ${events.length} events`);
      return events;
    } catch (error) {
      console.error('Error in getEventsBySessionId:', error);
      throw error;
    }
  }

  async getEventsByDriverAndSession(driverId: string, sessionId: string): Promise<Event[]> {
    console.log(`Fetching events for driver ${driverId} in session ${sessionId}`);
    try {
      // First check if session exists
      const session = await this.getSessionById(sessionId);
      if (!session) {
        return [];
      }

      const rows = this.db.prepare('SELECT *, driver_id AS driverId FROM events WHERE driver_id = ? OR driver_id IS NULL').all(driverId);
      console.log(`Query executed, found ${rows.length} event rows for driver ${driverId}`);
      const events = rows.map((row: any) => {
        try {
          return eventSchema.parse(row);
        } catch (e) {
          console.error('Error parsing event row:', row, e);
          throw e;
        }
      });
      console.log(`Successfully parsed ${events.length} events for driver ${driverId}`);
      return events;
    } catch (error) {
      console.error('Error in getEventsByDriverAndSession:', error);
      throw error;
    }
  }
}
