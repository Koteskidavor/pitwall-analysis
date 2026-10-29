import {
  type Session,
  type Lap,
  type Stint,
  type PitStop,
  type Event,
  type Driver,
  type Result,
  type Manifest,
  type Track,
} from '@pitwall/shared';

export type BinaryAsset =
  | { type: 'motion'; chunkIndex: number }
  | { type: 'gaps' };

export interface Storage {
  getSessions(): Promise<Session[]>;
  getSessionById(id: string): Promise<Session | null>;
  hasSession(id: string): Promise<boolean>;

  // Static per-session artifacts
  readManifest(sessionId: string): Promise<Manifest | null>;
  readTrack(sessionId: string): Promise<Track | null>;
  readBinary(sessionId: string, asset: BinaryAsset): Promise<Buffer | null>;

  // Driver and result tables
  getDriversBySessionId(sessionId: string): Promise<Driver[]>;
  getResultsBySessionId(sessionId: string): Promise<Result[]>;

  // Lap data methods
  getLapsBySessionId(sessionId: string): Promise<Lap[]>;
  getLapsByDriverAndSession(driverId: string, sessionId: string): Promise<Lap[]>;

  // Stint data methods
  getStintsBySessionId(sessionId: string): Promise<Stint[]>;
  getStintsByDriverAndSession(driverId: string, sessionId: string): Promise<Stint[]>;

  // Pit stop data methods
  getPitStopsBySessionId(sessionId: string): Promise<PitStop[]>;
  getPitStopsByDriverAndSession(driverId: string, sessionId: string): Promise<PitStop[]>;

  // Event data methods
  getEventsBySessionId(sessionId: string): Promise<Event[]>;
  getEventsByDriverAndSession(driverId: string, sessionId: string): Promise<Event[]>;
}
