import type { Request, Response } from 'express';
import { validated } from '../../middleware/validate';
import { currentUser } from '../../middleware/auth';
import type { LoginInput } from './auth.validation';
import * as authService from './auth.service';

export async function loginHandler(_req: Request, res: Response): Promise<void> {
  const { body } = validated<unknown, unknown, LoginInput>(res);
  const result = await authService.login(body);

  res.status(200).json({ data: result });
}

export function meHandler(req: Request, res: Response): void {
  res.status(200).json({ data: currentUser(req) });
}
