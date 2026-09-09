import { Router } from 'express';
import { validate } from '../../middleware/validate';
import type { Services } from '../../container';
import { listUsersQuerySchema } from './user.validation';
import { createUserController } from './user.controller';

export function createUserRouter(services: Services): Router {
  const router = Router();
  const controller = createUserController(services);

  router.get('/', validate({ query: listUsersQuerySchema }), controller.list);

  return router;
}
