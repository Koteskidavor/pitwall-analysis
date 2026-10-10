import Fastify from 'fastify';
import { SqliteStorage } from './storage/sqlite-storage';
import {
  sessionApiResponseSchema,
  type SessionApiResponse,
  lapSchema,
  type Lap,
  stintSchema,
  type Stint,
  pitStopSchema,
  type PitStop,
  eventSchema,
  type Event
} from '../../shared/src/schemas';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Initialize Fastify with TypeBox for better TypeScript support
const server = Fastify({
  logger: true,
}).withTypeProvider<TypeBoxTypeProvider>();

console.log('Initializing storage...');
// Initialize storage
const storage = new SqliteStorage(process.env.DATA_ROOT ?? './data');
console.log('Storage initialized');

// Define the parameter schema for session ID
const ParamsSchema = Type.Object({
  id: Type.String()
});

// Register routes
server.get('/api/sessions', async (request, reply) => {
  console.log('GET /api/sessions called');
  try {
    console.log('Fetching sessions from storage...');
    const sessions = await storage.getSessions();
    console.log(`Fetched ${sessions.length} sessions`);

    // For now, we'll return just the sessions data
    // In a full implementation, we'd also load manifest, drivers, results, etc.
    // But for CP6, we're focusing on the skeleton

    // Return sessions wrapped in the expected format
    // Based on sessionApiResponseSchema, we need: drivers, results, plus manifest fields
    // For now, let's return a simplified version that matches what we can get from sessions table

    // Since we don't have the full implementation yet, let's return what we have
    // and enhance it as we go
    const response: SessionApiResponse = {
      // Manifest fields (we'll need to load these from manifest.json)
      schemaVersion: '1.0.0',
      sampleHz: 5,
      chunkSeconds: 60,
      driverOrder: [],
      chunkCount: 0,
      trackLengthM: 0,
      durationMs: 0,
      availableLayers: [],

      // From sessions table
      drivers: [],
      results: []
    };

    // For now, just return the sessions data directly for testing
    // We'll refine this as we implement more
    return sessions;
  } catch (error) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

server.get('/api/sessions/:id', { schema: { params: ParamsSchema } }, async (request, reply) => {
  console.log(`GET /api/sessions/${request.params.id} called`);
  try {
    console.log('Fetching session by ID from storage...');
    const session = await storage.getSessionById(request.params.id);

    if (!session) {
      console.log('Session not found');
      return reply.status(404).send({ error: 'Session not found' });
    }

    console.log('Session found:', session);
    // Similar to above, we'll return just the session for now
    // and enhance later
    return session;
  } catch (error) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

// Define parameter schemas
const SessionParamsSchema = Type.Object({
  id: Type.String()
});

const DriverSessionParamsSchema = Type.Object({
  sessionId: Type.String(),
  driverId: Type.String()
});

// Laps routes
server.get('/api/sessions/:id/laps', { schema: { params: SessionParamsSchema } }, async (request, reply) => {
  console.log(`GET /api/sessions/${request.params.id}/laps called`);
  try {
    // Check if session exists first
    const session = await storage.getSessionById(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const laps = await storage.getLapsBySessionId(request.params.id);
    reply.send(laps);
  } catch (error) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

server.get('/api/sessions/:sessionId/drivers/:driverId/laps', { schema: { params: DriverSessionParamsSchema } }, async (request, reply) => {
  console.log(`GET /api/sessions/${request.params.sessionId}/drivers/${request.params.driverId}/laps called`);
  try {
    // Check if session exists first
    const session = await storage.getSessionById(request.params.sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const laps = await storage.getLapsByDriverAndSession(request.params.driverId, request.params.sessionId);
    reply.send(laps);
  } catch (error) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

// Stints routes
server.get('/api/sessions/:id/stints', { schema: { params: SessionParamsSchema } }, async (request, reply) => {
  console.log(`GET /api/sessions/${request.params.id}/stints called`);
  try {
    // Check if session exists first
    const session = await storage.getSessionById(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const stints = await storage.getStintsBySessionId(request.params.id);
    reply.send(stints);
  } catch (error) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

server.get('/api/sessions/:sessionId/drivers/:driverId/stints', { schema: { params: DriverSessionParamsSchema } }, async (request, reply) => {
  console.log(`GET /api/sessions/${request.params.sessionId}/drivers/${request.params.driverId}/stints called`);
  try {
    // Check if session exists first
    const session = await storage.getSessionById(request.params.sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const stints = await storage.getStintsByDriverAndSession(request.params.driverId, request.params.sessionId);
    reply.send(stints);
  } catch (error) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

// Pit stops routes
server.get('/api/sessions/:id/pit-stops', { schema: { params: SessionParamsSchema } }, async (request, reply) => {
  console.log(`GET /api/sessions/${request.params.id}/pit-stops called`);
  try {
    // Check if session exists first
    const session = await storage.getSessionById(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const pitStops = await storage.getPitStopsBySessionId(request.params.id);
    reply.send(pitStops);
  } catch (error) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

server.get('/api/sessions/:sessionId/drivers/:driverId/pit-stops', { schema: { params: DriverSessionParamsSchema } }, async (request, reply) => {
  console.log(`GET /api/sessions/${request.params.sessionId}/drivers/${request.params.driverId}/pit-stops called`);
  try {
    // Check if session exists first
    const session = await storage.getSessionById(request.params.sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const pitStops = await storage.getPitStopsByDriverAndSession(request.params.driverId, request.params.sessionId);
    reply.send(pitStops);
  } catch (error) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

// Events routes
server.get('/api/sessions/:id/events', { schema: { params: SessionParamsSchema } }, async (request, reply) => {
  console.log(`GET /api/sessions/${request.params.id}/events called`);
  try {
    // Check if session exists first
    const session = await storage.getSessionById(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const events = await storage.getEventsBySessionId(request.params.id);
    reply.send(events);
  } catch (error) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

server.get('/api/sessions/:sessionId/drivers/:driverId/events', { schema: { params: DriverSessionParamsSchema } }, async (request, reply) => {
  console.log(`GET /api/sessions/${request.params.sessionId}/drivers/${request.params.driverId}/events called`);
  try {
    // Check if session exists first
    const session = await storage.getSessionById(request.params.sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const events = await storage.getEventsByDriverAndSession(request.params.driverId, request.params.sessionId);
    reply.send(events);
  } catch (error) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

// Binary route with ETag and traversal rejection
server.get('/api/sessions/:id/binary/*', {
  schema: {
    params: Type.Object({
      id: Type.String(),
      '*': Type.String()
    })
  }
}, async (request, reply) => {
  console.log(`GET /api/sessions/${request.params.id}/binary/* called, wildcard: ${request.params['*']}`);
  try {
    const wildcard = request.params['*'] as string;
    // Split into parts, ignoring empty segments
    const parts = wildcard.split('/').filter(part => part !== '');
    
    // Validate we have at least a type
    if (parts.length === 0) {
      return reply.status(400).send({ error: 'Missing binary type' });
    }
    
    const type = parts[0];
    const chunkIndex = parts.length >= 2 ? parts[1] : undefined;
    
    // Prevent path traversal attacks in type and chunkIndex
    if (type && typeof type === 'string' &&
        (type.includes('..') || type.includes('%2E%2E'))) {
      return reply.status(400).send({ error: 'Invalid parameter' });
    }
    if (chunkIndex !== undefined && typeof chunkIndex === 'string' &&
        (chunkIndex.includes('..') || chunkIndex.includes('%2E%2E'))) {
      return reply.status(400).send({ error: 'Invalid parameter' });
    }
    
    // Validate type parameter
    if (type !== 'motion' && type !== 'gaps') {
      return reply.status(400).send({ error: 'Invalid binary type' });
    }
    
    // Validate session exists
    const session = await storage.getSessionById(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    
     // Construct file path based on type and chunk index
     let filePath: string;
     if (type === 'motion') {
       if (chunkIndex === undefined) {
         return reply.status(400).send({ error: 'Chunk index required for motion data' });
       }
       // Ensure chunkIndex is a non-negative integer
       const chunkIndexNum = parseInt(chunkIndex, 10);
       if (isNaN(chunkIndexNum) || chunkIndexNum < 0) {
         return reply.status(400).send({ error: 'Invalid chunk index' });
       }
       // Motion data is stored in chunks: motion/{chunkIndex}.bin
       filePath = join(process.env.DATA_ROOT ?? './data', 'sessions', request.params.id, 'motion', `${String(chunkIndexNum).padStart(3, '0')}.bin`);
     } else {
       // Since we validated above, type must be 'gaps'
       // Gaps data is stored as a single file: gaps.bin
       filePath = join(process.env.DATA_ROOT ?? './data', 'sessions', request.params.id, 'gaps.bin');
     }
    
    // Check if file exists
    const { existsSync } = await import('fs');
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: 'Binary data not found' });
    }
    
    // Read file
    const { readFileSync } = await import('fs');
    const buffer = readFileSync(filePath);
    
    // Set ETag header based on file content hash
    const crypto = await import('crypto');
    const hash = crypto.createHash('md5').update(buffer).digest('hex');
    reply.header('ETag', `"${hash}"`);
    
    // Handle If-None-Match header for caching
    const ifNoneMatch = request.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === `"${hash}"`) {
      return reply.status(304).send(); // Not Modified
    }
    
    // Set appropriate content type
    reply.type('application/octet-stream');
    reply.send(buffer);
  } catch (error) {
    server.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

// Start the server if this file is run directly
if (typeof process !== 'undefined' && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Starting server directly...');
  const port = parseInt(process.env.API_PORT ?? '3001', 10);
  server.listen({ port, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }
    server.log.info(`Server listening at ${address}`);
  });
}

export default server;
