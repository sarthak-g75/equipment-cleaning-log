import { z } from 'zod';

export const auditHistoryQuerySchema = z.object({
  // The audit history for a single record is bounded in practice (a record is
  // edited a handful of times), so this is a simple safety cap rather than a
  // paginated endpoint.
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export type AuditHistoryQuery = z.infer<typeof auditHistoryQuerySchema>;
