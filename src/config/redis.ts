import { Redis } from 'ioredis';
import { config } from './env';
import { logger } from './logger';

/**
 * The single Redis client for the whole process (Node's module cache makes
 * this file run once, so every import shares one connection).
 *
 * Design goal: Redis is a supporting dependency. When it is down, requests
 * must get a fast answer from the caller's fallback path, never hang waiting
 * for a connection, and the process must never crash.
 */

const RECONNECT_BASE_DELAY_MS = 200;
const RECONNECT_MAX_DELAY_MS = 5_000;

const log = logger.child({ component: 'redis' });

/**
 * Exponential backoff with jitter: 200ms, 400ms, 800ms ... capped at 5s.
 * Returning a number (never null) means "keep retrying forever", so the client
 * heals by itself when Redis comes back. Jitter stops many app instances from
 * reconnecting in lockstep and hammering a recovering Redis.
 */
function retryStrategy(attempt: number): number {
  const exponential = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
    RECONNECT_MAX_DELAY_MS,
  );
  const jitter = Math.floor(Math.random() * 100);
  return exponential + jitter;
}

export const redis = new Redis(config.redis.url, {
  connectionName: 'secure-auth-api',
  // Connect explicitly from server bootstrap, not as an import side effect.
  lazyConnect: true,
  connectTimeout: 5_000,
  // A single command may never block a login for more than 1s.
  commandTimeout: 1_000,
  // Fail commands immediately while disconnected instead of queueing them
  // until Redis returns (which could be minutes of hanging requests).
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy,
  // After a primary/replica failover the old primary becomes read-only:
  // reconnect so we land on the new primary.
  reconnectOnError: (error) => error.message.startsWith('READONLY'),
});

// --- Connection lifecycle logging -------------------------------------------
// During an outage ioredis emits 'error' and 'reconnecting' on every retry.
// Log the first occurrence loudly and the repeats at debug level, so an outage
// is one clear error line instead of thousands.
let outageReported = false;

redis.on('connect', () => log.debug('Redis TCP connection established'));

redis.on('ready', () => {
  if (outageReported) {
    log.info('Redis connection restored');
  } else {
    log.info('Redis connected');
  }
  outageReported = false;
});

redis.on('error', (error: Error) => {
  if (!outageReported) {
    outageReported = true;
    log.error({ err: error }, 'Redis error; rate limiting falls back until it recovers');
  } else {
    log.debug({ err: error }, 'Redis error (outage already reported)');
  }
});

redis.on('reconnecting', (delayMs: number) => log.debug({ delayMs }, 'Redis reconnecting'));

redis.on('close', () => log.debug('Redis connection closed'));

redis.on('end', () => log.warn('Redis connection ended; no further reconnect attempts'));

// --- Lifecycle helpers -------------------------------------------------------

/**
 * Starts the connection. Never throws: if Redis is unreachable at startup the
 * API still starts (degraded), and the retry strategy keeps trying.
 */
export async function connectRedis(): Promise<void> {
  // Guard against duplicate connects (connect() on a non-idle client throws).
  if (redis.status !== 'wait') return;

  try {
    await redis.connect();
  } catch (error) {
    log.warn({ err: error }, 'Redis unavailable at startup; continuing in degraded mode');
  }
}

export function isRedisReady(): boolean {
  return redis.status === 'ready';
}

/** Used by the health check. Never throws. */
export async function isRedisHealthy(): Promise<boolean> {
  if (!isRedisReady()) return false;
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}

/**
 * QUIT lets Redis finish replying to in-flight commands before closing.
 * If Redis is unreachable QUIT can't be delivered, so fall back to a hard
 * disconnect, which also stops the reconnect loop.
 */
export async function disconnectRedis(): Promise<void> {
  if (redis.status === 'end' || redis.status === 'wait') return;

  if (isRedisReady()) {
    try {
      await redis.quit();
      log.info('Redis disconnected');
      return;
    } catch (error) {
      log.warn({ err: error }, 'Redis QUIT failed; forcing disconnect');
    }
  }
  redis.disconnect();
  log.info('Redis disconnected (forced)');
}
