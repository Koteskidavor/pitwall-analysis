import Fastify from 'fastify';
import { SqliteStorage } from './storage/sqlite-storage';
import { sessionApiResponseSchema, type SessionApiResponse } from '../../shared/src/schemas';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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
