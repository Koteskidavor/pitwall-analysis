import type {
  Driver,
  Event,
  Lap,
  Manifest,
  PitStop,
  Result,
  Session,
  Stint,
  Track,
} from '@pitwall/shared';
import { HttpError } from '../errors/http-error';
import type { Storage } from '../models/storage';

export class SessionsController {
  constructor(private readonly storage: Storage) {}

  listSessions(): Promise<Session[]> {
    return this.storage.getSessions();
  }

  async getSession(id: string): Promise<Session> {
    const session = await this.storage.getSessionById(id);
    if (!session) throw new HttpError(404, 'Session not found');
    return session;
  }

  getManifest(id: string): Promise<Manifest> {
    return this.withSession(id, async () => {
      const manifest = await this.storage.readManifest(id);
      if (!manifest) throw new HttpError(404, 'Manifest not found');
      return manifest;
    });
  }

  getTrack(id: string): Promise<Track> {
    return this.withSession(id, async () => {
      const track = await this.storage.readTrack(id);
      if (!track) throw new HttpError(404, 'Track not found');
      return track;
    });
  }

  getDrivers(id: string): Promise<Driver[]> {
    return this.withSession(id, () => this.storage.getDriversBySessionId(id));
  }

  getResults(id: string): Promise<Result[]> {
    return this.withSession(id, () => this.storage.getResultsBySessionId(id));
  }

  getLaps(id: string): Promise<Lap[]> {
    return this.withSession(id, () => this.storage.getLapsBySessionId(id));
  }

  getLapsByDriver(sessionId: string, driverId: string): Promise<Lap[]> {
    return this.withSession(sessionId, () =>
      this.storage.getLapsByDriverAndSession(driverId, sessionId),
    );
  }

  getStints(id: string): Promise<Stint[]> {
    return this.withSession(id, () => this.storage.getStintsBySessionId(id));
  }

  getStintsByDriver(sessionId: string, driverId: string): Promise<Stint[]> {
    return this.withSession(sessionId, () =>
      this.storage.getStintsByDriverAndSession(driverId, sessionId),
    );
  }

  getPitStops(id: string): Promise<PitStop[]> {
    return this.withSession(id, () => this.storage.getPitStopsBySessionId(id));
  }

  getPitStopsByDriver(sessionId: string, driverId: string): Promise<PitStop[]> {
    return this.withSession(sessionId, () =>
      this.storage.getPitStopsByDriverAndSession(driverId, sessionId),
    );
  }

  getEvents(id: string): Promise<Event[]> {
    return this.withSession(id, () => this.storage.getEventsBySessionId(id));
  }

  getEventsByDriver(sessionId: string, driverId: string): Promise<Event[]> {
    return this.withSession(sessionId, () =>
      this.storage.getEventsByDriverAndSession(driverId, sessionId),
    );
  }

  private async withSession<T>(
    sessionId: string,
    load: () => Promise<T>,
  ): Promise<T> {
    if (!(await this.storage.hasSession(sessionId))) {
      throw new HttpError(404, 'Session not found');
    }
    return load();
  }
}
