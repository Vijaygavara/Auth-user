import type { Request, Response } from 'express';
import { loginUser, registerUser } from '../services/auth.service';
import { sendSuccess } from '../utils/response';
import type { LoginInput, RegisterInput } from '../validators/auth.validator';

/**
 * Controllers are thin: take already-validated input from the request, call a
 * service, shape the HTTP response. No database access and no business rules
 * here, so the same logic can be reused (CLI, queue worker, tests) without HTTP.
 *
 * Express 5 forwards rejected promises from async handlers to the error
 * middleware automatically, so no try/catch is needed.
 */

/** POST /api/v1/auth/register */
export async function register(req: Request, res: Response): Promise<void> {
  const user = await registerUser(req.body as RegisterInput);
  sendSuccess(res, { statusCode: 201, message: 'User registered successfully', data: user });
}

/** POST /api/v1/auth/login */
export async function login(req: Request, res: Response): Promise<void> {
  const result = await loginUser(req.body as LoginInput);
  sendSuccess(res, { message: 'Login successful', data: result });
}
