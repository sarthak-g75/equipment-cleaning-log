import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/auth';
import type { Services } from '../../container';
import { createCleaningRecordsByEquipmentRouter } from '../cleaning-records/cleaning-record.routes';
import { auditHistoryQuerySchema } from '../audit/audit.validation';
import {
  createEquipmentBodySchema,
  equipmentIdParamsSchema,
  listEquipmentQuerySchema,
  updateEquipmentBodySchema,
} from './equipment.validation';
import { createEquipmentController } from './equipment.controller';

export function createEquipmentRouter(services: Services): Router {
  const router = Router();
  const controller = createEquipmentController(services);

  // Reading the asset register is open to any authenticated user — an operator
  // has to pick equipment to log a cleaning against. Changing it is not: the
  // register is reference data that cleaning records and their audit trail hang
  // off, and retiring or deleting a piece of equipment changes what the whole
  // plant is allowed to log. That is a QA responsibility, and it matches the
  // permissions table in the README.
  router.get('/', validate({ query: listEquipmentQuerySchema }), controller.list);
  router.get('/:id', validate({ params: equipmentIdParamsSchema }), controller.get);

  router.post(
    '/',
    requireRole('qa'),
    validate({ body: createEquipmentBodySchema }),
    controller.create,
  );
  router.patch(
    '/:id',
    requireRole('qa'),
    validate({ params: equipmentIdParamsSchema, body: updateEquipmentBodySchema }),
    controller.update,
  );
  router.delete(
    '/:id',
    requireRole('qa'),
    validate({ params: equipmentIdParamsSchema }),
    controller.remove,
  );

  router.get(
    '/:id/audit',
    validate({ params: equipmentIdParamsSchema, query: auditHistoryQuerySchema }),
    controller.audit,
  );

  // Cleaning records are listed and created under their equipment, because the
  // brief asks for records "for a given equipment" and a record has no meaning
  // without one. Id-addressed record routes stay flat (see cleaning-record.routes).
  router.use('/:equipmentId/cleaning-records', createCleaningRecordsByEquipmentRouter(services));

  return router;
}
