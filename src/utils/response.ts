import type { Response } from 'express';

/**
 * Every successful response has the same envelope:
 *   { "success": true, "message"?: string, "data"?: T }
 * Error responses are produced by the central error middleware.
 */
export interface SuccessResponse<T> {
  success: true;
  message?: string;
  data?: T;
}

interface SendSuccessOptions<T> {
  statusCode?: number;
  message?: string;
  data?: T;
}

export function sendSuccess<T>(res: Response, options: SendSuccessOptions<T> = {}): void {
  const { statusCode = 200, message, data } = options;
  const body: SuccessResponse<T> = { success: true };
  if (message !== undefined) body.message = message;
  if (data !== undefined) body.data = data;
  res.status(statusCode).json(body);
}
