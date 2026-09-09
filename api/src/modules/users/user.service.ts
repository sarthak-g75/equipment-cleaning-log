import type { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma';
import type { ListUsersQuery } from './user.validation';

/** Never selects passwordHash, so it cannot leak by omission elsewhere. */
const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const satisfies Prisma.UserSelect;

export type UserDto = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export function listUsers(query: ListUsersQuery): Promise<UserDto[]> {
  const search = query.q;

  return prisma.user.findMany({
    where: {
      ...(query.role ? { role: query.role } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: userSelect,
    orderBy: { name: 'asc' },
    // A hard cap: the picker filters server-side, so it never needs the whole
    // table, and an unbounded list is how a directory endpoint becomes a
    // performance problem later.
    take: 50,
  });
}
