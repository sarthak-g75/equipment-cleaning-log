import bcrypt from 'bcryptjs';
import { UnauthorizedError } from '../../lib/errors';
import { signAccessToken, type AuthenticatedUser } from '../../lib/tokens';
import type { UnitOfWork } from '../../shared/ports';
import type { LoginInput } from './auth.validation';

export interface LoginResult {
  readonly token: string;
  readonly user: AuthenticatedUser;
}

export interface AuthService {
  login(input: LoginInput): Promise<LoginResult>;
}

/**
 * A bcrypt hash of a value nobody knows, used so an unknown email still costs a
 * full comparison. Returning early would make response time a reliable oracle
 * for "does this account exist?".
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO3s5oJ5CkxvVvJp1qO2PMoAqZ0oBBcTS';

export function createAuthService(uow: UnitOfWork): AuthService {
  return {
    async login(input) {
      const user = await uow.repos.users.findByEmail(input.email);

      const isValid = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);

      // One message for both "no such user" and "wrong password", so the
      // endpoint cannot be used to enumerate accounts.
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
    },
  };
}
