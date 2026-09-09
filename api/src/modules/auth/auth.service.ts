import bcrypt from 'bcryptjs';
import { prisma } from '../../database/prisma';
import { UnauthorizedError } from '../../lib/errors';
import { signAccessToken, type AuthenticatedUser } from '../../middleware/auth';
import type { LoginInput } from './auth.validation';

export interface LoginResult {
  readonly token: string;
  readonly user: AuthenticatedUser;
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // One generic message and one comparison path for both "no such user" and
  // "wrong password". Returning different errors — or returning early without
  // hashing — turns this endpoint into a user-enumeration oracle.
  const passwordHash = user?.passwordHash ?? '$2b$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
  const isValid = await bcrypt.compare(input.password, passwordHash);

  if (!user || !isValid) {
    throw new UnauthorizedError('Incorrect email or password.');
  }

  const authenticated: AuthenticatedUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };

  return { token: signAccessToken(authenticated), user: authenticated };
}
