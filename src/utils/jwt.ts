import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config/env';
import type { AccessTokenPayload } from '../types/auth.types';

/**
 * Pinned to HS256 on both sign and verify. Never let the token's own header
 * choose the algorithm: that is how "alg: none" and RS256/HS256 confusion
 * attacks work.
 */
const ALGORITHM = 'HS256';

// Verified tokens are still external input: check the payload's shape before
// trusting it.
const payloadSchema = z.object({
  userId: z.uuid(),
});

export function signAccessToken(userId: string): string {
  const payload: AccessTokenPayload = { userId };
  return jwt.sign(payload, config.jwt.secret, {
    algorithm: ALGORITHM,
    expiresIn: config.jwt.expiresInSeconds,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

/**
 * Verifies signature, algorithm, expiry, issuer and audience, then the payload.
 * Throws jsonwebtoken's TokenExpiredError / JsonWebTokenError / NotBeforeError,
 * or a ZodError for a validly signed token with an unexpected payload. The
 * auth middleware maps those to 401 responses.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.jwt.secret, {
    algorithms: [ALGORITHM],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
  return payloadSchema.parse(decoded);
}
