import { prisma } from '../lib/prisma';
import { logger } from './logger';

/**
 * PostgreSQL lifecycle helpers. The client itself lives in lib/prisma.ts.
 */

async function ping(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

/**
 * Verifies connectivity at startup. Prisma connects lazily, so without this an
 * unreachable database would only surface on the first user request.
 * Throws so the caller can refuse to start.
 */
export async function connectDatabase(): Promise<void> {
  await ping();
  logger.info('PostgreSQL connected');
}

/** Used by the health check. Never throws. */
export async function isDatabaseHealthy(): Promise<boolean> {
  try {
    await ping();
    return true;
  } catch (error) {
    logger.error({ err: error }, 'PostgreSQL health check failed');
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('PostgreSQL disconnected');
}
