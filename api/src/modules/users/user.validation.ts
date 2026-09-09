import { z } from 'zod';

export const listUsersQuerySchema = z.object({
  role: z.enum(['operator', 'qa']).optional(),
  /** Server-side filter so the picker stays correct when the list outgrows one page. */
  q: z.string().trim().max(120).optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
