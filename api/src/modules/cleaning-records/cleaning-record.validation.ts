import { z } from 'zod';
import { paginationQuerySchema } from '../../lib/pagination';

export const recordIdParamsSchema = z.object({ id: z.uuid() });
export const equipmentIdParamsSchema = z.object({ equipmentId: z.uuid() });

export const listRecordsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'verified']).optional(),
});

/** Tolerance for clock skew between the client's machine and this server. */
const FUTURE_TOLERANCE_MS = 60_000;

/**
 * A cleaning is a record of something that has already happened, so a timestamp
 * in the future is not a valid one.
 *
 * This rule also exists in the web form, but that copy is convenience — a
 * client cannot be trusted to enforce a business rule, and this endpoint is
 * reachable without it. The minute of tolerance absorbs ordinary clock skew
 * rather than rejecting a browser that is thirty seconds fast.
 */
const cleanedAtSchema = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => Date.parse(value) <= Date.now() + FUTURE_TOLERANCE_MS,
    'A cleaning cannot be logged in the future',
  )
  .transform((value) => new Date(value));

/**
 * `""` is normalised to `null` here, at the boundary, rather than inside the
 * diff. That keeps one decision in one place: the diff stays a dumb comparison,
 * and "the user cleared this field" is decided by the layer that knows what the
 * client meant.
 */
const notesSchema = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .transform((value) => (value === '' ? null : value))
  // .optional() must come AFTER .transform(): a transform applied to an optional
  // schema still produces a value, which makes the key REQUIRED in the inferred
  // type. Ordering it last keeps "omitted" and "explicitly null" distinguishable,
  // which the whole audit diff depends on.
  .optional();

export const createRecordBodySchema = z.object({
  cleanedById: z.uuid('Select who performed the cleaning'),
  cleanedAt: cleanedAtSchema,
  method: z.string().trim().min(1).max(120),
  notes: notesSchema,
});

/**
 * `status` is deliberately absent from both bodies. Verification is a distinct,
 * role-gated transition (POST /cleaning-records/:id/verify) — if status were
 * patchable, an operator could sign off their own cleaning record, which is both
 * an authorisation hole and meaningless as a quality workflow.
 */
export const updateRecordBodySchema = z
  .object({
    cleanedById: z.uuid('Select who performed the cleaning').optional(),
    cleanedAt: cleanedAtSchema.optional(),
    method: z.string().trim().min(1).max(120).optional(),
    notes: notesSchema,
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update',
  });

export type CreateRecordInput = z.infer<typeof createRecordBodySchema>;
export type UpdateRecordInput = z.infer<typeof updateRecordBodySchema>;
export type ListRecordsQuery = z.infer<typeof listRecordsQuerySchema>;
