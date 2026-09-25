import type { Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ERROR_CODES } from '../constants/error-codes';
import { UnauthorizedError } from '../errors/app-error';
import type { AuthenticatedUser } from '../types/auth.types';
import { verifyAccessToken } from '../utils/jwt';

const BEARER_SCHEME = 'bearer';

const MESSAGES = {
  missing: 'Authentication token is missing',
  malformed: 'Authorization header must be in the format: Bearer <token>',
  invalid: 'Invalid authentication token',
  expired: 'Authentication token has expired',
} as const;

/**
 * RFC 6750 asks 401 responses for bearer-token resources to carry a
 * WWW-Authenticate header telling the client which scheme to use and why the
 * token was rejected.
 */
function challenge(res: Response, error?: 'invalid_request' | 'invalid_token'): void {
  const parts = ['Bearer realm="secure-auth-api"'];
  if (error) parts.push(`error="${error}"`);
  res.setHeader('WWW-Authenticate', parts.join(', '));
}

/**
 * Returns the token from "Authorization: Bearer <token>", or null when the
 * header is absent / has no token. Throws for any other shape (wrong scheme,
 * extra parts). The scheme is matched case-insensitively (RFC 7235).
 */
function extractBearerToken(header: string | undefined): string | null {
  if (header === undefined || header.trim() === '') return null;

  const [scheme, token, ...extra] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== BEARER_SCHEME || extra.length > 0) {
    throw new UnauthorizedError(ERROR_CODES.TOKEN_INVALID, MESSAGES.malformed);
  }
  return token ?? null;
}

/**
 * Protects a route: requires a valid, unexpired access token and attaches
 * `req.user = { id }`. Stateless: no database lookup here. Controllers that
 * need the full user load it (and handle a user deleted after the token was
 * issued).
 *
 * Every failure is 401 with a specific code (TOKEN_MISSING / TOKEN_INVALID /
 * TOKEN_EXPIRED), so a client can tell "log in" apart from "refresh".
 */
export const authenticate: RequestHandler = (req, res, next) => {
  let token: string | null;
  try {
    token = extractBearerToken(req.headers.authorization);
  } catch (error) {
    challenge(res, 'invalid_request');
    throw error;
  }

  if (!token) {
    challenge(res);
    throw new UnauthorizedError(ERROR_CODES.TOKEN_MISSING, MESSAGES.missing);
  }

  try {
    const { userId } = verifyAccessToken(token);
    req.user = { id: userId };
  } catch (error) {
    challenge(res, 'invalid_token');

    // Log why (never the token itself) at debug level: useful when debugging a
    // client, but a flood of bad tokens shouldn't flood the logs.
    req.log.debug({ reason: (error as Error).name }, 'Access token rejected');

    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError(ERROR_CODES.TOKEN_EXPIRED, MESSAGES.expired);
    }
    // JsonWebTokenError (bad signature, malformed, wrong alg/iss/aud),
    // NotBeforeError, or ZodError (signed but unexpected payload).
    throw new UnauthorizedError(ERROR_CODES.TOKEN_INVALID, MESSAGES.invalid);
  }

  next();
};

/**
 * Typed accessor for protected controllers. Throws (-> 500) only if a route
 * was wired without `authenticate`, which is a programming error, not a
 * client error.
 */
export function getAuthenticatedUser(req: Request): AuthenticatedUser {
  if (!req.user) {
    throw new Error('getAuthenticatedUser() called on a route without the authenticate middleware');
  }
  return req.user;
}
