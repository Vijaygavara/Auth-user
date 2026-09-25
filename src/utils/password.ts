import bcrypt from 'bcrypt';
import { config } from '../config/env';

/**
 * bcrypt: a deliberately slow, salted hash. The salt is random per password
 * and stored inside the hash string, so identical passwords produce different
 * hashes and precomputed (rainbow table) attacks don't work. The cost factor
 * (BCRYPT_SALT_ROUNDS) doubles the work per +1: ~280ms at 12 on this machine.
 *
 * The async API runs hashing on libuv's thread pool, so it never blocks the
 * event loop while other requests are being served.
 */
export function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, config.bcrypt.saltRounds);
}

export function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}

let dummyHashPromise: Promise<string> | undefined;

/**
 * A valid hash of a random value, computed once. Login compares against it
 * when the email doesn't exist, so an unknown email costs the same bcrypt time
 * as a wrong password. Without this, "unknown email" would answer in ~2ms and
 * "wrong password" in ~280ms, letting attackers find registered emails by
 * timing responses.
 */
export function getDummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash(
    `dummy-${Math.random().toString(36)}-${Date.now()}`,
    config.bcrypt.saltRounds,
  );
  return dummyHashPromise;
}
