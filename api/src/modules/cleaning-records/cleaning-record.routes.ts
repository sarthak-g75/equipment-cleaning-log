import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/auth';
import type { Services } from '../../container';
import { auditHistoryQuerySchema } from '../audit/audit.validation';
import {
  createRecordBodySchema,
  equipmentIdParamsSchema,
  listRecordsQuerySchema,
  recordIdParamsSchema,
  updateRecordBodySchema,
} from './cleaning-record.validation';
import { createCleaningRecordController } from './cleaning-record.controller';

/**
 * Mounted at /equipment/:equipmentId/cleaning-records. `mergeParams` is what
 * makes the parent's :equipmentId visible to this router's validation.
 */
export function createCleaningRecordsByEquipmentRouter(services: Services): Router {
  const router = Router({ mergeParams: true });
  const controller = createCleaningRecordController(services);

  router.get(
    '/',
    validate({ params: equipmentIdParamsSchema, query: listRecordsQuerySchema }),
    controller.list,
  );
  router.post(
    '/',
    validate({ params: equipmentIdParamsSchema, body: createRecordBodySchema }),
    controller.create,
  );

  return router;
}

/** Mounted at /cleaning-records — routes addressed by the record's own id. */
export function createCleaningRecordRouter(services: Services): Router {
  const router = Router();
  const controller = createCleaningRecordController(services);

  router.get('/:id', validate({ params: recordIdParamsSchema }), controller.get);
  router.patch(
    '/:id',
    validate({ params: recordIdParamsSchema, body: updateRecordBodySchema }),
    controller.update,
  );
  router.post(
    '/:id/verify',
    requireRole('qa'),
    validate({ params: recordIdParamsSchema }),
    controller.verify,
  );
  router.get(
    '/:id/audit',
    validate({ params: recordIdParamsSchema, query: auditHistoryQuerySchema }),
    controller.audit,
  );

  return router;
}
