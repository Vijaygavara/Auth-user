import pino, { type LoggerOptions } from 'pino';
import { config } from './env';

/**
 * Paths that must never reach log output. Pino replaces their values with
 * "[REDACTED]" before serializing, so a careless `logger.info({ body })` or a
 * logged request still cannot leak credentials or tokens.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.authorization',
];

const options: LoggerOptions = {
  level: config.log.level,
  base: { service: 'secure-auth-api', env: config.env },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  formatters: {
    // Emit "level":"info" instead of "level":30; easier to query in log platforms.
    level: (label) => ({ level: label }),
  },
};

// Human-readable output locally; structured JSON (one object per line) everywhere
// else so log aggregators (CloudWatch, Loki, Datadog) can parse it.
if (config.isDevelopment) {
  options.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname,service,env',
    },
  };
}

export const logger = pino(options);
