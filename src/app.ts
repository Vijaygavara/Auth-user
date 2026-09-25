import express, { type Express } from 'express';
import { config } from './config/env';
import { errorHandler } from './middleware/error.middleware';
import { requestLogger } from './middleware/request-logger.middleware';
import { apiV1Router } from './routes';

/**
 * Builds and configures the Express application.
 *
 * The app is created by a factory and never calls `listen()` here. This keeps
 * HTTP wiring separate from process concerns (ports, signals, shutdown), and
 * lets tests mount a fresh app instance with Supertest without opening a port.
 */
export function createApp(): Express {
  const app = express();

  // Controls how req.ip is derived from X-Forwarded-For. Must match the real
  // proxy topology; see TRUST_PROXY in .env.example.
  app.set('trust proxy', config.server.trustProxy);

  // Don't advertise the framework in response headers.
  app.disable('x-powered-by');

  app.use(requestLogger);

  // Parse JSON bodies, capped to limit memory-exhaustion attacks.
  app.use(express.json({ limit: '10kb' }));

  app.use('/api/v1', apiV1Router);

  // Must be registered last so it receives errors from everything above.
  app.use(errorHandler);

  return app;
}
