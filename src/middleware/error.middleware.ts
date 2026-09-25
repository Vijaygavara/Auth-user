import type { ErrorRequestHandler } from 'express';
import { ERROR_CODES, type ErrorCode } from '../constants/error-codes';
import { AppError, TooManyRequestsError } from '../errors/app-error';

const TOKEN_ERROR_CODES = new Set<ErrorCode>([
  ERROR_CODES.TOKEN_MISSING,
  ERROR_CODES.TOKEN_INVALID,
  ERROR_CODES.TOKEN_EXPIRED,
]);

interface ErrorResponseBody {
  success: false;
  message: string;
  error: { code: string; details?: unknown };
  retryAfter?: number;
}

/**
 * express.json() (body-parser) rejects bad bodies before any route runs, with
 * http-errors objects tagged by `type`. These are client mistakes, not bugs.
 */
function fromBodyParserError(error: unknown): AppError | null {
  const type = (error as { type?: unknown } | null)?.type;
  switch (type) {
    case 'entity.parse.failed':
      return new AppError(400, ERROR_CODES.INVALID_JSON, 'Request body must be valid JSON');
    case 'entity.too.large':
      return new AppError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, 'Request body is too large');
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return new AppError(
        415,
        ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
        'Unsupported request body encoding',
      );
    default:
      return null;
  }
}

/**
 * Central error handler: every error thrown or passed to next() ends here and
 * becomes the standard error envelope. (Extended in Phase 8.)
 */
export const errorHandler: ErrorRequestHandler = (thrown, req, res, _next) => {
  const error: unknown = fromBodyParserError(thrown) ?? thrown;

  if (error instanceof AppError) {
    const body: ErrorResponseBody = {
      success: false,
      message: error.message,
      error: { code: error.code },
    };
    if (error.details !== undefined) body.error.details = error.details;
    if (error instanceof TooManyRequestsError) body.retryAfter = error.retryAfter;

    // Token 401s raised outside the auth middleware (e.g. a deleted user)
    // still get the RFC 6750 challenge header.
    if (TOKEN_ERROR_CODES.has(error.code) && !res.hasHeader('WWW-Authenticate')) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="secure-auth-api", error="invalid_token"');
    }

    res.status(error.statusCode).json(body);
    return;
  }

  // Unexpected: log everything server-side, reveal nothing to the client.
  req.log.error({ err: error }, 'Unhandled error');
  res.status(500).json({
    success: false,
    message: 'Something went wrong',
    error: { code: ERROR_CODES.INTERNAL_ERROR },
  } satisfies ErrorResponseBody);
};
