import type { Request, Response } from 'express';
import { getAuthenticatedUser } from '../middleware/auth.middleware';
import { getUserProfile } from '../services/user.service';
import { sendSuccess } from '../utils/response';

/** GET /api/v1/users/me */
export async function getMe(req: Request, res: Response): Promise<void> {
  const { id } = getAuthenticatedUser(req);
  const profile = await getUserProfile(id);
  sendSuccess(res, { data: profile });
}
