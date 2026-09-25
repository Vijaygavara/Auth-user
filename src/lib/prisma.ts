import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { PrismaClient } from '../generated/prisma/client';

/**
 * The single PrismaClient for the whole process.
 *
 * Node's module cache guarantees this file runs once, so every import shares
 * one client and one connection pool. The `globalThis` caching trick often seen
 * in examples exists for frameworks with in-process hot reload (Next.js); here
 * `tsx watch` restarts the whole process, so no extra handling is needed.
 *
 * Prisma 7 talks to PostgreSQL through a driver adapter (node-postgres pool).
 */
function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: config.database.url,
    max: 10, // pool size per app instance
    connectionTimeoutMillis: 5_000, // fail fast instead of hanging when the DB is unreachable
    idleTimeoutMillis: 30_000,
  });

  const client = new PrismaClient({
    adapter,
    // Prisma's 'error' log level is intentionally not subscribed: it fires for
    // expected, handled failures too (e.g. a duplicate email → 409). Query
    // errors are thrown to the caller, and the central error middleware logs
    // the ones that are actually unexpected.
    log: [
      { emit: 'event', level: 'warn' },
      ...(config.isDevelopment ? [{ emit: 'event', level: 'query' } as const] : []),
    ],
  });

  client.$on('warn', (event) => logger.warn({ target: event.target }, event.message));

  // Query text and timing only: parameters are deliberately not logged
  // because they contain emails and password hashes.
  if (config.isDevelopment) {
    client.$on('query', (event) =>
      logger.debug({ durationMs: event.duration }, `prisma: ${event.query}`),
    );
  }

  return client;
}

export const prisma = createPrismaClient();
