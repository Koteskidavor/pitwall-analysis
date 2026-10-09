// Storage interface placeholder
import { type Session } from '../../shared/src/schemas';

export interface Storage {
  read(_url: string): Promise<ArrayBuffer>
  exists(_url: string): Promise<boolean>
  getSessions(): Promise<Session[]>
  getSessionById(id: string): Promise<Session | null>
}
