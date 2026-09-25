import { Router } from 'express';
import { authRouter } from './auth.routes';
import { healthRouter } from './health.routes';
import { userRouter } from './user.routes';

/**
 * All v1 routes, mounted under /api/v1 in app.ts. A future breaking change
 * gets a new router (/api/v2) while existing clients keep using v1.
 */
export const apiV1Router = Router();

apiV1Router.use('/health', healthRouter);
apiV1Router.use('/auth', authRouter);
apiV1Router.use('/users', userRouter);
