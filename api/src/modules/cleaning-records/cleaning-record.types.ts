import type { Prisma } from '@prisma/client';

/**
 * Every read of a cleaning record returns the user who performed the cleaning,
 * so the client never has to make a second request (or hold a user map) just to
 * render a name. Selected explicitly rather than `include: true` so a password
 * hash cannot leak by construction.
 */
export const recordInclude = {
  cleanedBy: { select: { id: true, name: true, email: true, role: true } },
} as const satisfies Prisma.CleaningRecordInclude;

export type CleaningRecordDto = Prisma.CleaningRecordGetPayload<{
  include: typeof recordInclude;
}>;
