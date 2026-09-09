import { z } from 'zod';

export const recordSchema = z.object({
  cleanedBy: z.string().trim().min(1, 'Who performed the cleaning?').max(120),
  cleanedAt: z
    .string()
    .min(1, 'When was it cleaned?')
    .refine((value) => !Number.isNaN(Date.parse(value)), 'Enter a valid date and time')
    .refine(
      (value) => Date.parse(value) <= Date.now() + 60_000,
      'A cleaning cannot be logged in the future',
    ),
  method: z.string().trim().min(1, 'Which method was used?').max(120),
  notes: z.string().max(2000, 'Notes are limited to 2000 characters').optional(),
});

/** One source of truth: the form's type is derived from the schema, never written twice. */
export type RecordFormValues = z.infer<typeof recordSchema>;
