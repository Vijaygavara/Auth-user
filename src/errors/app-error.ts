import { ERROR_CODES, type ErrorCode } from '../constants/error-codes';

/**
 * Base class for expected, "operational" errors: situations the code
 * anticipates (bad input, wrong password, duplicate email) and that map to a
 * specific HTTP status and a message that is safe to show the client.
 *
 * Anything that is NOT an AppError is treated by the error middleware as an
 * unexpected bug: logged in full and answered with a generic 500.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export interface FieldError {
  field: string;
  message: string;
}

/** 400: the request is malformed or fails validation. */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: FieldError[]) {
    super(400, ERROR_CODES.VALIDATION_ERROR, message, details);
  }
}

export class BadRequestError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(400, code, message);
  }
}

/** 401: not authenticated (no/invalid/expired credentials or token). */
export class UnauthorizedError extends AppError {
  constructor(code: ErrorCode = ERROR_CODES.TOKEN_INVALID, message = 'Authentication required') {
    super(401, code, message);
  }
}

/** 403: authenticated, but not allowed to do this. */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, ERROR_CODES.FORBIDDEN, message);
  }
}

/** 404: the resource does not exist. */
export class NotFoundError extends AppError {
  constructor(code: ErrorCode = ERROR_CODES.NOT_FOUND, message = 'Resource not found') {
    super(404, code, message);
  }
}

/** 409: the request conflicts with current state (e.g. email already taken). */
export class ConflictError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(409, code, message);
  }
}

/** 429: rate limit exceeded. retryAfter is in seconds. */
export class TooManyRequestsError extends AppError {
  constructor(
    public readonly retryAfter: number,
    message = 'Too many requests. Please try again later.',
  ) {
    super(429, ERROR_CODES.TOO_MANY_REQUESTS, message);
  }
}

/** 503: a required dependency is unavailable; the client may retry later. */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable. Please try again later.') {
    super(503, ERROR_CODES.SERVICE_UNAVAILABLE, message);
  }
}
