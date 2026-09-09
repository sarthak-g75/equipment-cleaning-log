import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import type { Services } from '../container';
import { createAuthRouter } from '../modules/auth/auth.routes';
import { createEquipmentRouter } from '../modules/equipment/equipment.routes';
import { createCleaningRecordRouter } from '../modules/cleaning-records/cleaning-record.routes';
import { createUserRouter } from '../modules/users/user.routes';

/**
 * The routing table, built from a set of services rather than importing them.
 * That is what keeps the dependency pointing inward: `container.ts` knows about
 * the routers, and no router knows about the container.
 */
export function createApiRouter(services: Services): Router {
  const router = Router();

  router.use('/auth', createAuthRouter(services));

  // Everything below this line requires a verified token. Applying it here
  // rather than per-route means a newly added route is protected by default;
  // forgetting to opt in is the failure mode that leaks data.
  router.use(requireAuth);
  router.use('/users', createUserRouter(services));
  router.use('/equipment', createEquipmentRouter(services));
  router.use('/cleaning-records', createCleaningRecordRouter(services));

  return router;
}
