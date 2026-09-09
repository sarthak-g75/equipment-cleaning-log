import type { Request, Response } from 'express';
import { validated } from '../../middleware/validate';
import { services } from '../../container';
import type { ListUsersQuery } from './user.validation';

export async function listUsersHandler(_req: Request, res: Response): Promise<void> {
  const { query } = validated<unknown, ListUsersQuery>(res);
  res.status(200).json({ data: await services.users.list(query) });
}
