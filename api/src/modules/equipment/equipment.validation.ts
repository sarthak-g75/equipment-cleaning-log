import { z } from 'zod';

export const equipmentIdParamsSchema = z.object({ id: z.uuid() });

export const listEquipmentQuerySchema = z.object({
  status: z.enum(['active', 'retired']).optional(),
});

const nameSchema = z.string().trim().min(1).max(120);

/**
 * Equipment codes are printed on asset labels and referenced in batch records,
 * so the format is constrained rather than free text.
 *
 * Normalised to uppercase *before* the format check, not after: "br-101" is the
 * same asset label as "BR-101", and rejecting it for case while also promising
 * to store it uppercase would be contradictory. The web form uppercases too,
 * but that is convenience — this is the guard.
 */
const codeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(
    z
      .string()
      .min(2)
      .max(32)
      .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Code must be letters, digits and hyphens'),
  );

const statusSchema = z.enum(['active', 'retired']);

export const createEquipmentBodySchema = z.object({
  name: nameSchema,
  code: codeSchema,
  status: statusSchema.default('active'),
});

/**
 * Declared field by field rather than as `createEquipmentBodySchema.partial()`.
 *
 * `.partial()` does NOT strip an inner `.default()`, so the derived schema
 * parsed `{}` into `{ status: 'active' }` — which made the "at least one field"
 * guard below unreachable (the object always had a key) and, far worse, turned
 * every PATCH that omitted `status` into a silent status write. Patching only
 * the name of a retired asset re-activated it, and the audit trail recorded a
 * status change nobody requested. There is a regression test for exactly this.
 */
export const updateEquipmentBodySchema = z
  .object({
    name: nameSchema.optional(),
    code: codeSchema.optional(),
    status: statusSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update',
  });

export type CreateEquipmentInput = z.infer<typeof createEquipmentBodySchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentBodySchema>;
export type ListEquipmentQuery = z.infer<typeof listEquipmentQuerySchema>;
