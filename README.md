# secure-auth-api

Authentication REST API built with **Express 5 + TypeScript**. It issues **JWT** access tokens, stores users in **PostgreSQL** through **Prisma 7**, and rate-limits login attempts per client IP using **Redis**.

## Features

- Register, log in, and fetch the current user's profile
- Passwords hashed with bcrypt (cost factor is configurable)
- JWT access tokens: HS256 only, with issuer/audience checks and payload validation
- Per-IP login rate limiting in Redis (an atomic Lua script), with an in-memory fallback when Redis is down
- Request bodies validated and normalized with Zod; unknown fields are stripped
- Every response uses the same JSON envelope and a machine-readable error code
- Structured logging with Pino. Request IDs are echoed back, and passwords, tokens and auth headers are redacted
- Health endpoint that reports `healthy`, `degraded` or `unhealthy`
- Graceful shutdown on `SIGTERM`/`SIGINT`
- Environment is validated at startup; the app refuses to start on bad config

## Tech stack

| Area       | Choice                                         |
| ---------- | ---------------------------------------------- |
| Runtime    | Node.js >= 22                                  |
| Framework  | Express 5                                      |
| Language   | TypeScript 6 (CommonJS output)                 |
| Database   | PostgreSQL via Prisma 7 (`@prisma/adapter-pg`) |
| Cache      | Redis via ioredis                              |
| Auth       | jsonwebtoken, bcrypt                           |
| Validation | Zod 4                                          |
| Logging    | Pino, pino-http (pino-pretty in development)   |
| Tooling    | tsx, ESLint 10 (typescript-eslint), Prettier   |

## Prerequisites

- Node.js 22 or newer
- PostgreSQL
- Redis, or Memurai on Windows. This is optional at startup: without it the API runs in degraded mode.

## Getting started

```bash
# 1. Install dependencies (postinstall runs `prisma generate`)
npm install

# 2. Create your local env file and edit it
cp .env.example .env

# 3. Create the database schema
npm run prisma:migrate

# 4. Start the dev server (auto-restarts on changes)
npm run dev
```

The API listens on `http://localhost:5000/api/v1` by default.

### Production

```bash
npm run build           # prisma generate + compile to dist/
npm run prisma:deploy   # apply pending migrations
npm start               # node dist/server.js
```

## Environment variables

Every variable is declared and validated in [src/config/env.ts](src/config/env.ts). See [.env.example](.env.example) for a template.

| Variable                          | Default       | Description                                                                                                |
| --------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                        | `development` | `development`, `test` or `production`                                                                      |
| `PORT`                            | `5000`        | HTTP port                                                                                                  |
| `DATABASE_URL`                    | (required)    | `postgresql://` connection string                                                                          |
| `REDIS_URL`                       | (required)    | `redis://` or `rediss://` URL                                                                              |
| `JWT_SECRET`                      | (required)    | At least 32 characters. The example placeholder is rejected in production.                                 |
| `JWT_EXPIRES_IN`                  | `1d`          | Seconds or a duration (`15m`, `1h`, `1d`, `1w`). Must be between 60 s and 30 days.                         |
| `CORS_ORIGIN`                     | (required)    | Comma-separated full URLs. Validated, but no CORS middleware is applied yet (see below).                   |
| `BCRYPT_SALT_ROUNDS`              | `12`          | bcrypt cost factor, 10–15                                                                                  |
| `LOG_LEVEL`                       | per env       | `fatal`…`trace` or `silent`. Default: `debug` in dev, `info` in prod, `silent` in test.                    |
| `TRUST_PROXY`                     | `false`       | Express `trust proxy`: `false`, a hop count (`1`), or addresses/subnets. `true` is rejected in production. |
| `LOGIN_RATE_LIMIT_MAX`            | `5`           | Login attempts allowed per IP per window                                                                   |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `60`          | Rate-limit window length                                                                                   |
| `ENV_FILE`                        | `.env`        | Optional path to an alternative env file                                                                   |

Variables set in the real environment override values in `.env`.

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## API

Base path: `/api/v1`

| Method | Path             | Auth   | Description                        |
| ------ | ---------------- | ------ | ---------------------------------- |
| GET    | `/health`        | –      | Dependency status and uptime       |
| POST   | `/auth/register` | –      | Create an account                  |
| POST   | `/auth/login`    | –      | Get an access token (rate-limited) |
| GET    | `/users/me`      | Bearer | Current user's profile             |

### Response envelope

Success:

```json
{ "success": true, "message": "optional", "data": {} }
```

Error:

```json
{
  "success": false,
  "message": "Validation failed",
  "error": { "code": "VALIDATION_ERROR", "details": [{ "field": "email", "message": "..." }] }
}
```

Clients should branch on `error.code`, not on `message`. The codes are listed in [src/constants/error-codes.ts](src/constants/error-codes.ts).

### `POST /auth/register`

```json
{ "name": "Jane Doe", "email": "jane@example.com", "password": "Str0ng!Pass" }
```

- `name`: 2–100 characters, trimmed, no control characters
- `email`: valid address of at most 255 characters, trimmed and lowercased before storage
- `password`: 8+ characters, at most 72 bytes, with a lowercase letter, an uppercase letter, a digit and a special character

| Status | Meaning                                  |
| ------ | ---------------------------------------- |
| 201    | Created; `data` is `{ id, name, email }` |
| 400    | `VALIDATION_ERROR`, `INVALID_JSON`       |
| 409    | `EMAIL_ALREADY_EXISTS`                   |

### `POST /auth/login`

```json
{ "email": "jane@example.com", "password": "Str0ng!Pass" }
```

| Status | Meaning                                                                         |
| ------ | ------------------------------------------------------------------------------- |
| 200    | `data` is `{ token, user: { id, name, email } }`                                |
| 400    | `VALIDATION_ERROR`                                                              |
| 401    | `INVALID_CREDENTIALS` (same response for an unknown email and a wrong password) |
| 429    | `TOO_MANY_REQUESTS`, with `retryAfter` in seconds                               |

Every login request counts against the limit, whether it succeeds or fails. Responses include `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` headers, and a 429 also sets `Retry-After`.

### `GET /users/me`

Send the token as `Authorization: Bearer <token>`.

| Status | Meaning                                                                               |
| ------ | ------------------------------------------------------------------------------------- |
| 200    | `data` is `{ id, name, email, createdAt }`                                            |
| 401    | `TOKEN_MISSING`, `TOKEN_INVALID` or `TOKEN_EXPIRED`, with a `WWW-Authenticate` header |

A token for a user that has since been deleted returns 401 `TOKEN_INVALID`.

### `GET /health`

```json
{
  "success": true,
  "message": "API is healthy",
  "data": { "database": "connected", "redis": "connected", "uptime": 12.34 }
}
```

| State       | When                                                      | HTTP |
| ----------- | --------------------------------------------------------- | ---- |
| `healthy`   | Both dependencies are up                                  | 200  |
| `degraded`  | Redis is down (rate limiting uses the in-memory fallback) | 200  |
| `unhealthy` | PostgreSQL is down                                        | 503  |

## Security notes

- **Timing-safe login:** unknown emails are still checked against a dummy bcrypt hash, so response time doesn't reveal which emails are registered.
- **Password length:** bcrypt ignores input past 72 bytes, so longer passwords are rejected instead of being silently truncated.
- **JWT:** the algorithm is pinned to HS256, `iss`/`aud` are both `secure-auth-api`, and the decoded payload is validated with Zod.
- **Rate limiting:** the login limit is checked before validation, database access and bcrypt, so blocked clients cost one Redis call. IPv4-mapped IPv6 addresses are normalized, and IPv6 clients are bucketed by /64. If Redis is unavailable, each process falls back to its own in-memory counter; with N instances, a client can make up to N × limit attempts.
- **Client IP:** taken only from `req.ip`, which respects `TRUST_PROXY`. Set `TRUST_PROXY` to match your real proxy setup, or per-IP limiting will not work correctly.
- **Body parsing:** JSON bodies are capped at 10 KB, and `x-powered-by` is disabled.
- **Logging:** request bodies are never logged, and Prisma query parameters are not logged.

## Project structure

```
prisma/
  schema.prisma          User model (UUIDv7 id, unique lowercased email, bcrypt hash)
  migrations/
prisma.config.ts         Prisma CLI config (schema, migrations, DATABASE_URL)
src/
  server.ts              Bootstrap, startup checks, graceful shutdown
  app.ts                 Express app factory (no listen, so tests can use it)
  config/                env validation, logger, database and Redis lifecycle
  lib/prisma.ts          Shared PrismaClient (pg driver adapter, pool of 10)
  routes/                /api/v1 routers: health, auth, users
  controllers/           Thin HTTP handlers
  services/              Business logic: auth, user, health, rate limiter
  middleware/            auth, validation, rate limit, request logger, error handler
  validators/            Zod request schemas
  errors/                AppError class hierarchy
  constants/             Error codes
  utils/                 jwt, password, client IP, response helper
  types/                 Shared types and the Express Request augmentation
  generated/prisma/      Generated Prisma client (not committed)
tests/                   Empty placeholder
```

## Scripts

| Script                            | Description                                       |
| --------------------------------- | ------------------------------------------------- |
| `npm run dev`                     | Start with `tsx watch`                            |
| `npm run build`                   | Generate the Prisma client and compile to `dist/` |
| `npm start`                       | Run the compiled server                           |
| `npm run typecheck`               | Type-check without emitting                       |
| `npm run lint` / `lint:fix`       | ESLint                                            |
| `npm run format` / `format:check` | Prettier                                          |
| `npm run prisma:generate`         | Regenerate the Prisma client                      |
| `npm run prisma:migrate`          | Create and apply a migration (development)        |
| `npm run prisma:deploy`           | Apply migrations (production)                     |
| `npm run prisma:studio`           | Open Prisma Studio                                |

## Known gaps

- `CORS_ORIGIN` is validated, but no CORS middleware is mounted yet, so browser cross-origin requests are not handled.
- There is no JSON 404 handler for unknown routes: they get Express's default HTML 404, and the `ROUTE_NOT_FOUND` code is not used yet.
- No tests have been written yet, and there is no `test` script.

## License

MIT
