import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { authRateLimiter } from '../../middleware/rate-limit';
import type { Services } from '../../container';
import { loginBodySchema } from './auth.validation';
import { createAuthController } from './auth.controller';

export function createAuthRouter(services: Services): Router {
  const router = Router();
  const controller = createAuthController(services);

  router.post('/login', authRateLimiter, validate({ body: loginBodySchema }), controller.login);
  router.get('/me', requireAuth, controller.me);

  return router;
}
