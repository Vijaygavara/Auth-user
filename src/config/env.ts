import { existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * Centralized, validated configuration.
 *
 * Every environment variable the app uses is declared here, parsed once at
 * startup and exposed as a typed, frozen `config` object. Nothing else in the
 * codebase reads `process.env` directly. If any variable is missing or invalid
 * the process refuses to start (fail fast) instead of failing later at runtime.
 */

const PLACEHOLDER_JWT_SECRET = 'replace_with_a_long_random_secret';

// Durations like "900", "15m", "1h", "1d". A bare number means seconds.
const DURATION_REGEX = /^(\d+)(s|m|h|d|w)?$/;
const SECONDS_PER_UNIT = { s: 1, m: 60, h: 3_600, d: 86_400, w: 604_800 } as const;

/**
 * Converted to a number of seconds here because jsonwebtoken treats a numeric
 * *string* as milliseconds: expiresIn: "900" would mean 0.9 seconds, and env
 * vars are always strings.
 */
const durationToSeconds = (value: string): number => {
  const [, amount = '0', unit = 's'] = DURATION_REGEX.exec(value) ?? [];
  return Number(amount) * SECONDS_PER_UNIT[unit as keyof typeof SECONDS_PER_UNIT];
};

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const commaSeparated = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

/**
 * Express "trust proxy" setting. Accepted forms:
 *   false / 0           -> trust nothing, req.ip is the TCP peer (direct exposure, localhost)
 *   <n> (e.g. 1)        -> trust exactly n proxy hops in front of the app (Nginx, Render, ALB)
 *   loopback,10.0.0.0/8 -> trust only these addresses/subnets (Docker networks, known proxies)
 *   true                -> trust every X-Forwarded-For entry (spoofable; rejected in production)
 */
export type TrustProxySetting = boolean | number | string[];

const parseTrustProxy = (raw: string): TrustProxySetting => {
  const value = raw.trim().toLowerCase();
  if (value === 'false' || value === '') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return hops === 0 ? false : hops;
  }
  return commaSeparated(value);
};

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),

    DATABASE_URL: z
      .string()
      .min(1)
      .refine((v) => /^postgres(ql)?:\/\//.test(v), {
        message: 'must be a postgresql:// connection string',
      }),

    REDIS_URL: z
      .string()
      .min(1)
      .refine((v) => /^rediss?:\/\//.test(v), { message: 'must be a redis:// or rediss:// URL' }),

    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_EXPIRES_IN: z
      .string()
      .trim()
      .default('1d')
      .pipe(z.string().regex(DURATION_REGEX, 'must be a duration such as 900, 15m, 1h or 1d'))
      .transform(durationToSeconds)
      .pipe(
        z
          .number()
          .min(60, 'must be at least 60 seconds')
          .max(30 * 86_400, 'must be at most 30 days'),
      ),

    CORS_ORIGIN: z
      .string()
      .min(1)
      .transform(commaSeparated)
      .pipe(
        z.array(z.url('each CORS origin must be a full URL, e.g. http://localhost:3000')).min(1),
      ),

    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),

    TRUST_PROXY: z.string().default('false').transform(parseTrustProxy),

    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    if (env.JWT_SECRET === PLACEHOLDER_JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'the example placeholder secret must not be used in production',
      });
    }
    if (env.TRUST_PROXY === true) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message:
          '"true" trusts spoofable X-Forwarded-For headers; use a hop count or trusted subnets in production',
      });
    }
  });

type RawEnv = Record<string, string | undefined>;

export function parseEnv(raw: RawEnv) {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    // Report which variables are wrong and why, but never echo their values:
    // they may be secrets.
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = result.data;
  const defaultLogLevel =
    env.NODE_ENV === 'production' ? 'info' : env.NODE_ENV === 'test' ? 'silent' : 'debug';

  return Object.freeze({
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isDevelopment: env.NODE_ENV === 'development',
    isTest: env.NODE_ENV === 'test',

    server: Object.freeze({
      port: env.PORT,
      trustProxy: env.TRUST_PROXY,
    }),
    database: Object.freeze({ url: env.DATABASE_URL }),
    redis: Object.freeze({ url: env.REDIS_URL }),
    jwt: Object.freeze({
      secret: env.JWT_SECRET,
      expiresInSeconds: env.JWT_EXPIRES_IN,
      issuer: 'secure-auth-api',
      audience: 'secure-auth-api',
    }),
    cors: Object.freeze({ origins: Object.freeze([...env.CORS_ORIGIN]) }),
    bcrypt: Object.freeze({ saltRounds: env.BCRYPT_SALT_ROUNDS }),
    log: Object.freeze({ level: env.LOG_LEVEL ?? defaultLogLevel }),
    rateLimit: Object.freeze({
      login: Object.freeze({
        maxAttempts: env.LOGIN_RATE_LIMIT_MAX,
        windowSeconds: env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
      }),
    }),
  });
}

export type AppConfig = ReturnType<typeof parseEnv>;

/**
 * Loads `.env` (if present) into process.env, then validates it.
 * Variables already set in the real environment (Docker, CI, the hosting
 * platform) take precedence over the file, so `.env` is only a local
 * development convenience.
 */
function loadConfig(): AppConfig {
  const envFile = process.env.ENV_FILE ?? '.env';
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  try {
    return parseEnv(process.env);
  } catch (error) {
    // The logger depends on this config, so it can't be used here.
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  }
}

export const config: AppConfig = loadConfig();
