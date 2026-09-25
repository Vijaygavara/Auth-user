import { createHash } from 'node:crypto';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { redis } from '../config/redis';

/**
 * Fixed-window rate limiter backed by Redis, with an in-memory fallback.
 *
 * Redis model, one key per client and window:
 *   key   rate-limit:login:<ip>
 *   value number of attempts in the current window
 *   TTL   seconds until the window ends, set when the key is created
 *
 * When the key expires the counter is gone and the client starts fresh.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Attempts counted in the current window, including this one. */
  count: number;
  remaining: number;
  /** Seconds until the window resets (the key's TTL). Retry-After on 429. */
  resetSeconds: number;
  store: 'redis' | 'memory';
}

interface WindowHit {
  count: number;
  ttlSeconds: number;
}

export interface FixedWindowRateLimiter {
  consume(identifier: string): Promise<RateLimitResult>;
}

interface LimiterOptions {
  keyPrefix: string;
  limit: number;
  windowSeconds: number;
}

const log = logger.child({ component: 'rate-limiter' });

// --- Redis store: one atomic Lua script ---------------------------------------
//
// Why a script instead of three commands (INCR, then EXPIRE, then TTL):
//   * Redis runs a script atomically: no other command from any client runs in
//     between. Two concurrent first requests can't both think they created the
//     key, and nothing observes the key between INCR and EXPIRE.
//   * If the app crashed right after a separate INCR, the key would exist with
//     no TTL and that IP would be blocked FOREVER. Inside a script, INCR and
//     EXPIRE happen together or not at all.
//   * One network round trip instead of three.
//
// EXPIRE runs only when the key is created (count == 1), so later attempts
// never extend the window: the block ends exactly when the first attempt's
// window does. The ttl < 0 branch self-heals a key that somehow lost its TTL.
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;
const HIT_SCRIPT_SHA = createHash('sha1').update(HIT_SCRIPT).digest('hex');

/**
 * EVALSHA sends only the script's hash. Redis caches scripts, but the cache is
 * empty after a Redis restart, so fall back to EVAL (which re-caches it) on
 * NOSCRIPT.
 */
async function runHitScript(key: string, windowSeconds: number): Promise<unknown> {
  try {
    return await redis.evalsha(HIT_SCRIPT_SHA, 1, key, windowSeconds);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NOSCRIPT')) {
      return redis.eval(HIT_SCRIPT, 1, key, windowSeconds);
    }
    throw error;
  }
}

async function redisHit(key: string, windowSeconds: number): Promise<WindowHit> {
  const reply = await runHitScript(key, windowSeconds);
  if (!Array.isArray(reply) || typeof reply[0] !== 'number' || typeof reply[1] !== 'number') {
    throw new Error('Unexpected reply from rate-limit script');
  }
  return { count: reply[0], ttlSeconds: reply[1] };
}

// --- In-memory fallback store --------------------------------------------------
//
// Used only while Redis is unavailable. Same algorithm and limits, but per
// process: with N instances an attacker gets up to N x limit attempts per
// window. Much better than no limit (fail-open), and unlike fail-closed it
// doesn't lock every user out during a Redis outage.

const MEMORY_MAX_KEYS = 10_000;

class MemoryWindowStore {
  private readonly windows = new Map<string, { count: number; expiresAt: number }>();

  constructor(sweepIntervalMs: number) {
    // unref(): this timer must never keep the process alive at shutdown.
    setInterval(() => this.sweep(), sweepIntervalMs).unref();
  }

  hit(key: string, windowSeconds: number): WindowHit {
    const now = Date.now();
    let entry = this.windows.get(key);

    if (!entry || entry.expiresAt <= now) {
      this.makeRoom();
      entry = { count: 0, expiresAt: now + windowSeconds * 1000 };
      this.windows.set(key, entry);
    }
    entry.count += 1;

    return {
      count: entry.count,
      ttlSeconds: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)),
    };
  }

  /** Bound memory: many spoofed/rotating IPs must not grow the map without limit. */
  private makeRoom(): void {
    if (this.windows.size < MEMORY_MAX_KEYS) return;
    this.sweep();
    if (this.windows.size < MEMORY_MAX_KEYS) return;
    const oldestKey = this.windows.keys().next().value; // Map keeps insertion order
    if (oldestKey !== undefined) this.windows.delete(oldestKey);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows) {
      if (entry.expiresAt <= now) this.windows.delete(key);
    }
  }
}

// Throttle the fallback warning: one line per minute during an outage, not one
// per request. (The Redis client itself logs the outage once.)
const FALLBACK_WARN_INTERVAL_MS = 60_000;
let lastFallbackWarnAt = 0;

function warnFallback(error: unknown): void {
  const now = Date.now();
  if (now - lastFallbackWarnAt >= FALLBACK_WARN_INTERVAL_MS) {
    lastFallbackWarnAt = now;
    log.warn({ err: error }, 'Redis unavailable; rate limiting is using the in-memory fallback');
  } else {
    log.debug({ err: error }, 'Rate limiter fallback (warning throttled)');
  }
}

// --- Limiter -----------------------------------------------------------------

export function createFixedWindowRateLimiter(options: LimiterOptions): FixedWindowRateLimiter {
  const { keyPrefix, limit, windowSeconds } = options;
  const memory = new MemoryWindowStore(windowSeconds * 1000);

  return {
    async consume(identifier) {
      const key = `${keyPrefix}:${identifier}`;
      let hit: WindowHit;
      let store: RateLimitResult['store'] = 'redis';

      try {
        hit = await redisHit(key, windowSeconds);
      } catch (error) {
        // Redis down, timed out, or offline queue disabled: never let that
        // fail the request or bypass limiting. Degrade to per-process limits.
        warnFallback(error);
        hit = memory.hit(key, windowSeconds);
        store = 'memory';
      }

      return {
        allowed: hit.count <= limit,
        limit,
        count: hit.count,
        remaining: Math.max(0, limit - hit.count),
        resetSeconds: hit.ttlSeconds,
        store,
      };
    },
  };
}

/** 5 attempts per IP per 60 seconds by default (LOGIN_RATE_LIMIT_* env vars). */
export const loginRateLimiter = createFixedWindowRateLimiter({
  keyPrefix: 'rate-limit:login',
  limit: config.rateLimit.login.maxAttempts,
  windowSeconds: config.rateLimit.login.windowSeconds,
});
