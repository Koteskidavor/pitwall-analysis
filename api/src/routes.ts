import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { BinaryController } from './controllers/binary-controller';
import type { SessionsController } from './controllers/sessions-controller';

const SessionParamsSchema = Type.Object({
  id: Type.String(),
});
type SessionParams = Static<typeof SessionParamsSchema>;

const DriverSessionParamsSchema = Type.Object({
  sessionId: Type.String(),
  driverId: Type.String(),
});
type DriverSessionParams = Static<typeof DriverSessionParamsSchema>;

const BinaryParamsSchema = Type.Object({
  id: Type.String(),
  '*': Type.String(),
});
type BinaryParams = Static<typeof BinaryParamsSchema>;

export interface Controllers {
  sessions: SessionsController;
  binary: BinaryController;
}

export function registerRoutes(
  server: FastifyInstance,
  controllers: Controllers,
): void {
  server.get('/api/sessions', async () => controllers.sessions.listSessions());

  server.get<{ Params: SessionParams }>(
    '/api/sessions/:id',
    { schema: { params: SessionParamsSchema } },
    async (request) => controllers.sessions.getSession(request.params.id),
  );

  server.get<{ Params: SessionParams }>(
    '/api/sessions/:id/manifest',
    { schema: { params: SessionParamsSchema } },
    async (request) => controllers.sessions.getManifest(request.params.id),
  );

  server.get<{ Params: SessionParams }>(
    '/api/sessions/:id/track',
    { schema: { params: SessionParamsSchema } },
    async (request) => controllers.sessions.getTrack(request.params.id),
  );

  server.get<{ Params: SessionParams }>(
    '/api/sessions/:id/drivers',
    { schema: { params: SessionParamsSchema } },
    async (request) => controllers.sessions.getDrivers(request.params.id),
  );

  server.get<{ Params: SessionParams }>(
    '/api/sessions/:id/results',
    { schema: { params: SessionParamsSchema } },
    async (request) => controllers.sessions.getResults(request.params.id),
  );

  server.get<{ Params: SessionParams }>(
    '/api/sessions/:id/laps',
    { schema: { params: SessionParamsSchema } },
    async (request) => controllers.sessions.getLaps(request.params.id),
  );

  server.get<{ Params: DriverSessionParams }>(
    '/api/sessions/:sessionId/drivers/:driverId/laps',
    { schema: { params: DriverSessionParamsSchema } },
    async (request) =>
      controllers.sessions.getLapsByDriver(
        request.params.sessionId,
        request.params.driverId,
      ),
  );

  server.get<{ Params: SessionParams }>(
    '/api/sessions/:id/stints',
    { schema: { params: SessionParamsSchema } },
    async (request) => controllers.sessions.getStints(request.params.id),
  );

  server.get<{ Params: DriverSessionParams }>(
    '/api/sessions/:sessionId/drivers/:driverId/stints',
    { schema: { params: DriverSessionParamsSchema } },
    async (request) =>
      controllers.sessions.getStintsByDriver(
        request.params.sessionId,
        request.params.driverId,
      ),
  );

  server.get<{ Params: SessionParams }>(
    '/api/sessions/:id/pit-stops',
    { schema: { params: SessionParamsSchema } },
    async (request) => controllers.sessions.getPitStops(request.params.id),
  );

  server.get<{ Params: DriverSessionParams }>(
    '/api/sessions/:sessionId/drivers/:driverId/pit-stops',
    { schema: { params: DriverSessionParamsSchema } },
    async (request) =>
      controllers.sessions.getPitStopsByDriver(
        request.params.sessionId,
        request.params.driverId,
      ),
  );

  server.get<{ Params: SessionParams }>(
    '/api/sessions/:id/events',
    { schema: { params: SessionParamsSchema } },
    async (request) => controllers.sessions.getEvents(request.params.id),
  );

  server.get<{ Params: DriverSessionParams }>(
    '/api/sessions/:sessionId/drivers/:driverId/events',
    { schema: { params: DriverSessionParamsSchema } },
    async (request) =>
      controllers.sessions.getEventsByDriver(
        request.params.sessionId,
        request.params.driverId,
      ),
  );

  server.get<{ Params: BinaryParams }>(
    '/api/sessions/:id/binary/*',
    { schema: { params: BinaryParamsSchema } },
    async (request, reply) => {
      const representation = await controllers.binary.getBinary(
        request.params.id,
        request.params['*'],
        request.headers['if-none-match'],
      );

      reply.status(representation.statusCode).headers(representation.headers);

      if (representation.statusCode === 304) {
        return reply.send();
      }

      return reply.send(representation.body);
    },
  );
}
