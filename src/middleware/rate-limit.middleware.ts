import type { RequestHandler } from 'express';
import { TooManyRequestsError } from '../errors/app-error';
import { loginRateLimiter, type FixedWindowRateLimiter } from '../services/rate-limit.service';
import { getClientIp } from '../utils/client-ip';

/**
 * Counts EVERY request to the protected route (successful, failed or
 * malformed) against the client's IP, and rejects with 429 once the limit is
 * exceeded, until the window's Redis key expires.
 *
 * Mount it BEFORE validation and the controller, so blocked clients cost one
 * Redis call and nothing else: no JSON validation, no database query, no
 * bcrypt hash.
 */
export function rateLimit(limiter: FixedWindowRateLimiter, message: string): RequestHandler {
  return async (req, res, next) => {
    const ip = getClientIp(req);
    const result = await limiter.consume(ip);

    // IETF RateLimit header fields: let well-behaved clients see their budget.
    res.setHeader('RateLimit-Limit', result.limit);
    res.setHeader('RateLimit-Remaining', result.remaining);
    res.setHeader('RateLimit-Reset', result.resetSeconds);

    if (!result.allowed) {
      // Log the moment an IP crosses the limit (a security event), not every
      // blocked request after it, which would let an attacker flood the logs.
      if (result.count === result.limit + 1) {
        req.log.warn(
          { ip, limit: result.limit, retryAfter: result.resetSeconds, store: result.store },
          'Rate limit exceeded; client temporarily blocked',
        );
      }
      res.setHeader('Retry-After', result.resetSeconds);
      throw new TooManyRequestsError(result.resetSeconds, message);
    }

    next();
  };
}

export const loginRateLimit = rateLimit(
  loginRateLimiter,
  'Too many login attempts. Please try again later.',
);
