import { z } from 'zod';

export const equipmentSchema = z.object({
  name: z.string().trim().min(1, 'Give the equipment a name').max(120),
  // Mirrors the server rule, so the common mistake is caught before a round
  // trip. The server still validates — this is convenience, not the guard.
  code: z
    .string()
    .trim()
    .min(2, 'Codes are at least 2 characters')
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Letters, digits and hyphens only')
    .transform((value) => value.toUpperCase()),
  status: z.enum(['active', 'retired']),
});

export type EquipmentFormValues = z.infer<typeof equipmentSchema>;
