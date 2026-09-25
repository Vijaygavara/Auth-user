import { Router } from 'express';
import { getMe } from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';

export const userRouter = Router();

// Every /users route requires authentication. Applying it at router level
// means a new route added here later can't be accidentally left public.
userRouter.use(authenticate);

userRouter.get('/me', getMe);
