import { z } from 'zod';

export const loginBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginBodySchema>;
