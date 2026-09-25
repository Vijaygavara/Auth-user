import { Router } from 'express';
import { login, register } from '../controllers/auth.controller';
import { loginRateLimit } from '../middleware/rate-limit.middleware';
import { validateBody } from '../middleware/validation.middleware';
import { loginSchema, registerSchema } from '../validators/auth.validator';

export const authRouter = Router();

authRouter.post('/register', validateBody(registerSchema), register);

// Rate limit first: a blocked client is rejected before any validation,
// database or bcrypt work happens.
authRouter.post('/login', loginRateLimit, validateBody(loginSchema), login);
