import { z } from 'zod';
import { paginationQuerySchema } from '../../lib/pagination';

export const recordIdParamsSchema = z.object({ id: z.uuid() });
export const equipmentIdParamsSchema = z.object({ equipmentId: z.uuid() });

export const listRecordsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'verified']).optional(),
});

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
  cleanedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
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
    cleanedAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
    method: z.string().trim().min(1).max(120).optional(),
    notes: notesSchema,
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update',
  });

export type CreateRecordInput = z.infer<typeof createRecordBodySchema>;
export type UpdateRecordInput = z.infer<typeof updateRecordBodySchema>;
export type ListRecordsQuery = z.infer<typeof listRecordsQuerySchema>;
