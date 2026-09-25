import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { ValidationError, type FieldError } from '../errors/app-error';

/**
 * Validates and normalizes `req.body` with a Zod schema.
 *
 * On success, req.body is REPLACED by the parsed output: unknown fields are
 * stripped and values are normalized (e.g. trimmed, lowercased email), so the
 * controller only ever sees data that matches the schema. This also blocks
 * mass assignment: a client sending { "role": "admin" } has it removed here.
 *
 * On failure, a 400 lists every invalid field.
 */
export function validateBody(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});

    if (!result.success) {
      const details: FieldError[] = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      }));
      next(new ValidationError('Validation failed', details));
      return;
    }

    req.body = result.data;
    next();
  };
}
