import type { AuthenticatedUser } from './auth.types';

/**
 * Adds `req.user` to Express's Request type. It is set only by the
 * `authenticate` middleware, so it is optional here; protected controllers
 * read it through `getAuthenticatedUser(req)`, which guarantees it exists.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
