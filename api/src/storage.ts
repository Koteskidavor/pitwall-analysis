// Storage interface
import { type Session } from '../../shared/src/schemas';
import { type Lap, type Stint, type PitStop, type Event } from '../../shared/src/schemas';

export interface Storage {
  read(_url: string): Promise<ArrayBuffer>
  exists(_url: string): Promise<boolean>
  getSessions(): Promise<Session[]>
  getSessionById(id: string): Promise<Session | null>
  
  // Lap data methods
  getLapsBySessionId(sessionId: string): Promise<Lap[]>
  getLapsByDriverAndSession(driverId: string, sessionId: string): Promise<Lap[]>
  
  // Stint data methods
  getStintsBySessionId(sessionId: string): Promise<Stint[]>
  getStintsByDriverAndSession(driverId: string, sessionId: string): Promise<Stint[]>
  
  // Pit stop data methods
  getPitStopsBySessionId(sessionId: string): Promise<PitStop[]>
  getPitStopsByDriverAndSession(driverId: string, sessionId: string): Promise<PitStop[]>
  
  // Event data methods
  getEventsBySessionId(sessionId: string): Promise<Event[]>
  getEventsByDriverAndSession(driverId: string, sessionId: string): Promise<Event[]>
}
