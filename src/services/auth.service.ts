import { ERROR_CODES } from '../constants/error-codes';
import { ConflictError, UnauthorizedError } from '../errors/app-error';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import type { LoginResult, PublicUser } from '../types/auth.types';
import { signAccessToken } from '../utils/jwt';
import { getDummyHash, hashPassword, verifyPassword } from '../utils/password';
import type { LoginInput, RegisterInput } from '../validators/auth.validator';

/**
 * Explicit column list for anything returned to clients. Selecting (rather
 * than fetching everything and deleting passwordHash afterwards) means the
 * hash never even leaves the database for these queries.
 */
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
} satisfies Prisma.UserSelect;

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const emailTaken = (): ConflictError =>
  new ConflictError(ERROR_CODES.EMAIL_ALREADY_EXISTS, 'An account with this email already exists');

export async function registerUser(input: RegisterInput): Promise<PublicUser> {
  // Fast path: skip the ~280ms bcrypt hash when the email is obviously taken.
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw emailTaken();

  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash },
      select: publicUserSelect,
    });
  } catch (error) {
    // Two simultaneous registrations for the same email can both pass the
    // check above. The unique index is the real guarantee; map its violation
    // to the same 409 instead of a 500.
    if (isUniqueViolation(error)) throw emailTaken();
    throw error;
  }
}

export async function loginUser(input: LoginInput): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...publicUserSelect, passwordHash: true },
  });

  // Always run exactly one bcrypt comparison, even for unknown emails (against
  // a dummy hash), so response time doesn't reveal whether the email exists.
  const passwordMatches = await verifyPassword(
    input.password,
    user?.passwordHash ?? (await getDummyHash()),
  );

  // Same error, same message, same status for "no such user" and "wrong
  // password": the response must not reveal which one it was.
  if (!user || !passwordMatches) {
    throw new UnauthorizedError(ERROR_CODES.INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE);
  }

  const { passwordHash: _passwordHash, ...publicUser } = user;
  return { token: signAccessToken(user.id), user: publicUser };
}
