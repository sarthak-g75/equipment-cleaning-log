import { z } from 'zod';

export const equipmentIdParamsSchema = z.object({ id: z.uuid() });

export const listEquipmentQuerySchema = z.object({
  status: z.enum(['active', 'retired']).optional(),
});

export const createEquipmentBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  // Equipment codes are printed on asset labels and referenced in batch records,
  // so the format is constrained rather than free text.
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Code must be uppercase letters, digits and hyphens')
    .transform((value) => value.toUpperCase()),
  status: z.enum(['active', 'retired']).default('active'),
});

export const updateEquipmentBodySchema = createEquipmentBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update',
  });

export type CreateEquipmentInput = z.infer<typeof createEquipmentBodySchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentBodySchema>;
export type ListEquipmentQuery = z.infer<typeof listEquipmentQuerySchema>;
