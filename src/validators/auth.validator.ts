import { z } from 'zod';

/**
 * bcrypt only uses the first 72 BYTES of a password and silently ignores the
 * rest. Two passwords sharing the same first 72 bytes would both be accepted,
 * so longer passwords are rejected outright. Bytes, not characters: "é" is
 * 2 bytes in UTF-8 and many emoji are 4.
 */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN_LENGTH = 8;

const withinBcryptLimit = (value: string): boolean =>
  Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES;

/**
 * Trimmed and lowercased BEFORE validation and storage, so "Vijay@Example.com "
 * and "vijay@example.com" are the same account and the unique index on
 * users.email catches both.
 */
const emailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.email('Email must be a valid email address').max(255, 'Email is too long'));

const strongPasswordSchema = z
  .string({ error: 'Password is required' })
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .refine(withinBcryptLimit, `Password must be at most ${PASSWORD_MAX_BYTES} bytes`)
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character');

export const registerSchema = z.object({
  name: z
    .string({ error: 'Name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    // No control characters (newlines, NUL, etc.): they have no place in a
    // display name and can be used for log/header injection.
    .regex(/^[^\p{Cc}]+$/u, 'Name contains invalid characters'),
  email: emailSchema,
  password: strongPasswordSchema,
});

/**
 * Login deliberately does NOT re-check password strength: the rules may have
 * changed since the user registered, and a detailed strength error on login
 * would leak information. It only bounds the input.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: 'Password is required' })
    .min(1, 'Password is required')
    .refine(withinBcryptLimit, `Password must be at most ${PASSWORD_MAX_BYTES} bytes`),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
