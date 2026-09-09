import type { Request, Response } from 'express';
import { validated } from '../../middleware/validate';
import { currentUser } from '../../middleware/auth';
import type { Services } from '../../container';
import type { AuditHistoryQuery } from '../audit/audit.validation';
import type {
  CreateRecordInput,
  ListRecordsQuery,
  UpdateRecordInput,
} from './cleaning-record.validation';

type IdParams = { id: string };
type EquipmentIdParams = { equipmentId: string };

export function createCleaningRecordController(services: Services) {
  return {
    async list(_req: Request, res: Response): Promise<void> {
      const { params, query } = validated<EquipmentIdParams, ListRecordsQuery>(res);
      const page = await services.cleaningRecords.list(params.equipmentId, query);

      res.status(200).json(page);
    },

    async get(_req: Request, res: Response): Promise<void> {
      const { params } = validated<IdParams>(res);
      res.status(200).json({ data: await services.cleaningRecords.get(params.id) });
    },

    async create(req: Request, res: Response): Promise<void> {
      const { params, body } = validated<EquipmentIdParams, unknown, CreateRecordInput>(res);
      const created = await services.cleaningRecords.create(
        params.equipmentId,
        body,
        currentUser(req),
      );

      res.status(201).location(`/api/v1/cleaning-records/${created.id}`).json({ data: created });
    },

    async update(req: Request, res: Response): Promise<void> {
      const { params, body } = validated<IdParams, unknown, UpdateRecordInput>(res);
      const updated = await services.cleaningRecords.update(params.id, body, currentUser(req));

      res.status(200).json({ data: updated });
    },

    async verify(req: Request, res: Response): Promise<void> {
      const { params } = validated<IdParams>(res);
      const verified = await services.cleaningRecords.verify(params.id, currentUser(req));

      res.status(200).json({ data: verified });
    },

    async audit(_req: Request, res: Response): Promise<void> {
      const { params, query } = validated<IdParams, AuditHistoryQuery>(res);
      // Returned whole rather than re-wrapped, so `meta.hasMore` reaches the
      // client and a capped trail is distinguishable from a complete one.
      res.status(200).json(await services.audit.getRecordHistory(params.id, query));
    },
  };
}
