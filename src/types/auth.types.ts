/** Custom JWT claims. Standard claims (iat, exp, iss, aud) are added by jsonwebtoken. */
export interface AccessTokenPayload {
  userId: string;
}

/** What the auth middleware attaches to req.user after verifying a token. */
export interface AuthenticatedUser {
  id: string;
}

/** The only user shape that may leave the API. Never includes passwordHash. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
}

export interface UserProfile extends PublicUser {
  createdAt: Date;
}

export interface LoginResult {
  token: string;
  user: PublicUser;
}
