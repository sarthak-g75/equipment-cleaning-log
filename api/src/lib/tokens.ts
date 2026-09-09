import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { config } from '../config';

/**
 * Access-token minting and verification.
 *
 * This lives in `lib/` rather than in `middleware/auth.ts`, where it used to,
 * because signing a token is not an HTTP concern. With it in the middleware,
 * `auth.service.ts` had to import from `middleware/` to issue a token — a
 * service depending on the transport layer, which inverts the layering the
 * architecture doc describes ("data flows downward only"). Nothing here knows
 * what a Request is.
 */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
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
 * Verifies a token and returns the identity it carries, or null.
 *
 * Null for every failure mode on purpose: distinguishing "expired" from
 * "malformed" from "wrong signature" tells an attacker more than it helps a
 * legitimate client, and the caller has nothing useful to do differently.
 */
export function verifyAccessToken(token: string): AuthenticatedUser | null {
  let payload: unknown;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch {
    return null;
  }

  const claims = claimsSchema.safeParse(payload);
  if (!claims.success) return null;

  return {
    id: claims.data.sub,
    email: claims.data.email,
    name: claims.data.name,
    role: claims.data.role,
  };
}
