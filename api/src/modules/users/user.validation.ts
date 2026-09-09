import { z } from 'zod';

export const MAX_USER_PAGE_SIZE = 50;

export const listUsersQuerySchema = z.object({
  role: z.enum(['operator', 'qa']).optional(),
  /**
   * Server-side filter. The picker sends this as the user types, so the client
   * never has to hold the whole directory in memory and a person outside the
   * first page is still reachable — which is not true of client-side filtering
   * over a capped list.
   */
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_USER_PAGE_SIZE).default(MAX_USER_PAGE_SIZE),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
