import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { fileURLToPath } from 'node:url';
import { BinaryController } from './controllers/binary-controller';
import { SessionsController } from './controllers/sessions-controller';
import { HttpError } from './errors/http-error';
import { SqliteStorage } from './models/sqlite-storage';
import { registerRoutes } from './routes';
import { renderError } from './views/error-view';

export interface ServerOptions {
  dataRoot?: string;
}

export function createServer(options: ServerOptions = {}) {
  const server = Fastify({
    logger: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  const storage = new SqliteStorage(
    options.dataRoot ?? process.env.DATA_ROOT ?? './data',
    server.log,
  );

  server.addHook('onClose', async () => {
    storage.close();
  });

  server.setErrorHandler((error, request, reply) => {
    const { statusCode, body } = renderError(error);

    if (!(error instanceof HttpError) && statusCode >= 500) {
      request.log.error(error);
    }

    return reply.status(statusCode).send(body);
  });

  registerRoutes(server, {
    sessions: new SessionsController(storage),
    binary: new BinaryController(storage),
  });

  return server;
}

const server = createServer();

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = parseInt(process.env.API_PORT ?? '3001', 10);

  server.listen({ port, host: '0.0.0.0' }, (error, address) => {
    if (error) {
      server.log.error(error);
      process.exit(1);
    }
    server.log.info(`Server listening at ${address}`);
  });
}

export default server;
