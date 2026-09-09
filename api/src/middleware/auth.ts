import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { config } from '../config';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const claimsSchema = z.object({
  sub: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(['operator', 'qa']),
});

export function signAccessToken(user: AuthenticatedUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'] },
  );
}

/**
 * Identity comes from the verified token and nowhere else. Nothing downstream —
 * including the audit trail's "who" — may read an actor from the request body,
 * which would let any caller forge attribution.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError('A bearer token is required.'));
    return;
  }

  let payload: unknown;
  try {
    payload = jwt.verify(header.slice('Bearer '.length), config.jwt.secret);
  } catch {
    // Deliberately opaque: distinguishing "expired" from "malformed" from
    // "wrong signature" tells an attacker more than it helps a legitimate client.
    next(new UnauthorizedError('The access token is invalid or has expired.'));
    return;
  }

  const claims = claimsSchema.safeParse(payload);
  if (!claims.success) {
    next(new UnauthorizedError('The access token is invalid or has expired.'));
    return;
  }

  req.user = {
    id: claims.data.sub,
    email: claims.data.email,
    name: claims.data.name,
    role: claims.data.role,
  };
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
