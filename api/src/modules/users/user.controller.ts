import type { Request, Response } from 'express';
import { validated } from '../../middleware/validate';
import type { Services } from '../../container';
import type { ListUsersQuery } from './user.validation';

export function createUserController(services: Services) {
  return {
    async list(_req: Request, res: Response): Promise<void> {
      const { query } = validated<unknown, ListUsersQuery>(res);
      res.status(200).json({ data: await services.users.list(query) });
    },
  };
}
