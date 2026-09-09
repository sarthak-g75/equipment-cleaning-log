import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';
import { verifyAccessToken, type AuthenticatedUser } from '../lib/tokens';

export type { AuthenticatedUser } from '../lib/tokens';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Identity comes from the verified token and nowhere else. Nothing downstream —
 * including the audit trail's "who" — may read an actor from the request body,
 * which would let any caller forge attribution.
 *
 * Token mechanics live in `lib/tokens.ts`; this module only translates them
 * into HTTP outcomes.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError('A bearer token is required.'));
    return;
  }

  const user = verifyAccessToken(header.slice('Bearer '.length));
  if (!user) {
    next(new UnauthorizedError('The access token is invalid or has expired.'));
    return;
  }

  req.user = user;
  next();
}

export function requireRole(...roles: readonly Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError(`This action requires the ${roles.join(' or ')} role.`));
      return;
    }
    next();
  };
}

/** Narrowing helper: routes behind `requireAuth` always have a user. */
export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}
