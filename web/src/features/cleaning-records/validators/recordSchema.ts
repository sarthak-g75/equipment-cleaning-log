import { z } from 'zod';
import { isValidUtcDateTimeLocal, utcDateTimeLocalToMillis } from '../../../utils/format';

/** Matches the server's tolerance, so the two rules cannot disagree at the edge. */
const FUTURE_TOLERANCE_MS = 60_000;

export const recordSchema = z.object({
  cleanedById: z.uuid('Select who performed the cleaning'),
  /**
   * Held as the raw `datetime-local` value. Both checks below read it through
   * the UTC helpers, so the validation and the payload conversion agree about
   * which zone the wall clock belongs to — they previously did not, and the
   * future check rejected the form's own prefill anywhere west of UTC.
   */
  cleanedAt: z
    .string()
    .min(1, 'When was it cleaned?')
    .refine(isValidUtcDateTimeLocal, 'Enter a valid date and time')
    .refine(
      (value) => utcDateTimeLocalToMillis(value) <= Date.now() + FUTURE_TOLERANCE_MS,
      'A cleaning cannot be logged in the future',
    ),
  method: z.string().trim().min(1, 'Which method was used?').max(120),
  notes: z.string().max(2000, 'Notes are limited to 2000 characters').optional(),
});

/** One source of truth: the form's type is derived from the schema, never written twice. */
export type RecordFormValues = z.infer<typeof recordSchema>;
