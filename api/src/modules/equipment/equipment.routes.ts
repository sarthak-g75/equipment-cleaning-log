import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { cleaningRecordsByEquipmentRouter } from '../cleaning-records/cleaning-record.routes';
import { auditHistoryQuerySchema } from '../audit/audit.validation';
import { equipmentAuditHandler } from './equipment.audit.routes';
import {
  createEquipmentBodySchema,
  equipmentIdParamsSchema,
  listEquipmentQuerySchema,
  updateEquipmentBodySchema,
} from './equipment.validation';
import {
  createEquipmentHandler,
  deleteEquipmentHandler,
  getEquipmentHandler,
  listEquipmentHandler,
  updateEquipmentHandler,
} from './equipment.controller';

export const equipmentRouter = Router();

equipmentRouter.get('/', validate({ query: listEquipmentQuerySchema }), listEquipmentHandler);
equipmentRouter.post('/', validate({ body: createEquipmentBodySchema }), createEquipmentHandler);
equipmentRouter.get('/:id', validate({ params: equipmentIdParamsSchema }), getEquipmentHandler);
equipmentRouter.patch(
  '/:id',
  validate({ params: equipmentIdParamsSchema, body: updateEquipmentBodySchema }),
  updateEquipmentHandler,
);
equipmentRouter.delete(
  '/:id',
  validate({ params: equipmentIdParamsSchema }),
  deleteEquipmentHandler,
);

equipmentRouter.get(
  '/:id/audit',
  validate({ params: equipmentIdParamsSchema, query: auditHistoryQuerySchema }),
  equipmentAuditHandler,
);

// Cleaning records are listed and created under their equipment, because the
// brief asks for records "for a given equipment" and a record has no meaning
// without one. Id-addressed record routes stay flat (see cleaning-record.routes).
equipmentRouter.use('/:equipmentId/cleaning-records', cleaningRecordsByEquipmentRouter);
