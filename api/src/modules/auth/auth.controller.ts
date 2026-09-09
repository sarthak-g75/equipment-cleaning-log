import type { Request, Response } from 'express';
import { validated } from '../../middleware/validate';
import { currentUser } from '../../middleware/auth';
import type { Services } from '../../container';
import type { LoginInput } from './auth.validation';

/**
 * Handlers are built from the services they use rather than importing the
 * container. Reaching into `container.ts` from here made this module depend on
 * the composition root — a service locator, which points the dependency the
 * wrong way and means no controller can be exercised without a live Prisma
 * client behind it.
 */
export function createAuthController(services: Services) {
  return {
    async login(_req: Request, res: Response): Promise<void> {
      const { body } = validated<unknown, unknown, LoginInput>(res);
      const result = await services.auth.login(body);

      res.status(200).json({ data: result });
    },

    me(req: Request, res: Response): void {
      res.status(200).json({ data: currentUser(req) });
    },
  };
}
