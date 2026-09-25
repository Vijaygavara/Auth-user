import { ERROR_CODES } from '../constants/error-codes';
import { UnauthorizedError } from '../errors/app-error';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import type { UserProfile } from '../types/auth.types';

const userProfileSelect = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

/**
 * Loads the profile of the authenticated user.
 *
 * If the user was deleted after the token was issued, the token is still
 * cryptographically valid but no longer identifies anyone. That is an
 * authentication failure (401: "your credentials are no longer valid"), not a
 * 404: the resource "me" isn't missing, the identity is.
 */
export async function getUserProfile(userId: string): Promise<UserProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userProfileSelect,
  });

  if (!user) {
    throw new UnauthorizedError(ERROR_CODES.TOKEN_INVALID, 'Invalid authentication token');
  }
  return user;
}
