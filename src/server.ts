import type { Server } from 'node:http';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { config } from './config/env';
import { logger } from './config/logger';
import { connectRedis, disconnectRedis } from './config/redis';

// Upper bound for a graceful shutdown. Orchestrators send SIGKILL after their
// own grace period (Docker: 10s, Kubernetes: 30s), so finish before that.
const SHUTDOWN_TIMEOUT_MS = 8_000;

let server: Server | undefined;
let shuttingDown = false;

function listen(): Promise<Server> {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const httpServer = app.listen(config.server.port, (error?: Error) =>
      error ? reject(error) : resolve(httpServer),
    );
  });
}

function closeHttpServer(httpServer: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    // Stops accepting new connections, waits for in-flight requests to finish,
    // and (Node 19+) closes idle keep-alive connections.
    httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Shutdown order: stop accepting requests -> finish in-flight requests ->
 * close Redis -> disconnect Prisma -> exit. Each step runs even if an earlier
 * one failed, so a Redis error can't leave database connections open.
 */
async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, 'Graceful shutdown started');

  const forceExit = setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  const steps: Array<[string, () => Promise<void>]> = [
    [
      'HTTP server',
      async () => {
        if (server) await closeHttpServer(server);
        logger.info('HTTP server closed');
      },
    ],
    ['Redis', disconnectRedis],
    ['PostgreSQL', disconnectDatabase],
  ];

  for (const [name, step] of steps) {
    try {
      await step();
    } catch (error) {
      exitCode = 1;
      logger.error({ err: error }, `Error while closing ${name}`);
    }
  }

  clearTimeout(forceExit);
  logger.info({ exitCode }, 'Shutdown complete');
  process.exit(exitCode);
}

async function bootstrap(): Promise<void> {
  // Refuse to start without a database: an API that accepts traffic but can't
  // serve any auth request is worse than one that isn't running, because the
  // orchestrator can restart a crashed process but not a "zombie" one.
  await connectDatabase();

  // Redis is optional at startup: connectRedis never throws, and the client
  // keeps reconnecting in the background.
  await connectRedis();

  server = await listen();
  logger.info(
    { port: config.server.port, trustProxy: config.server.trustProxy },
    `secure-auth-api listening on port ${config.server.port}`,
  );
}

// SIGTERM: sent by Docker/Kubernetes/systemd on stop. SIGINT: Ctrl+C.
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Last-resort safety nets. After an uncaught exception the process state is
// unknown, so log it, clean up what we can, and exit non-zero so the
// orchestrator restarts a fresh instance.
process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error: Error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});

bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Startup failed');
  void shutdown('startup failure', 1);
});
