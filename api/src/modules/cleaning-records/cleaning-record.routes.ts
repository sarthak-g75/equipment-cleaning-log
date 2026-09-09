import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/auth';
import { auditHistoryQuerySchema } from '../audit/audit.validation';
import {
  createRecordBodySchema,
  equipmentIdParamsSchema,
  listRecordsQuerySchema,
  recordIdParamsSchema,
  updateRecordBodySchema,
} from './cleaning-record.validation';
import {
  createRecordHandler,
  getRecordHandler,
  listRecordsHandler,
  recordAuditHandler,
  updateRecordHandler,
  verifyRecordHandler,
} from './cleaning-record.controller';

/**
 * Mounted at /equipment/:equipmentId/cleaning-records. `mergeParams` is what
 * makes the parent's :equipmentId visible to this router's validation.
 */
export const cleaningRecordsByEquipmentRouter = Router({ mergeParams: true });

cleaningRecordsByEquipmentRouter.get(
  '/',
  validate({ params: equipmentIdParamsSchema, query: listRecordsQuerySchema }),
  listRecordsHandler,
);
cleaningRecordsByEquipmentRouter.post(
  '/',
  validate({ params: equipmentIdParamsSchema, body: createRecordBodySchema }),
  createRecordHandler,
);

/** Mounted at /cleaning-records — routes addressed by the record's own id. */
export const cleaningRecordRouter = Router();

cleaningRecordRouter.get('/:id', validate({ params: recordIdParamsSchema }), getRecordHandler);
cleaningRecordRouter.patch(
  '/:id',
  validate({ params: recordIdParamsSchema, body: updateRecordBodySchema }),
  updateRecordHandler,
);
cleaningRecordRouter.post(
  '/:id/verify',
  requireRole('qa'),
  validate({ params: recordIdParamsSchema }),
  verifyRecordHandler,
);
cleaningRecordRouter.get(
  '/:id/audit',
  validate({ params: recordIdParamsSchema, query: auditHistoryQuerySchema }),
  recordAuditHandler,
);
