import type { Request, Response } from 'express';
import { validated } from '../../middleware/validate';
import { currentUser } from '../../middleware/auth';
import type { Services } from '../../container';
import type { AuditHistoryQuery } from '../audit/audit.validation';
import type {
  CreateEquipmentInput,
  ListEquipmentQuery,
  UpdateEquipmentInput,
} from './equipment.validation';

type IdParams = { id: string };

export function createEquipmentController(services: Services) {
  return {
    async list(_req: Request, res: Response): Promise<void> {
      const { query } = validated<unknown, ListEquipmentQuery>(res);
      res.status(200).json({ data: await services.equipment.list(query) });
    },

    async get(_req: Request, res: Response): Promise<void> {
      const { params } = validated<IdParams>(res);
      res.status(200).json({ data: await services.equipment.get(params.id) });
    },

    async create(req: Request, res: Response): Promise<void> {
      const { body } = validated<unknown, unknown, CreateEquipmentInput>(res);
      const created = await services.equipment.create(body, currentUser(req));

      res.status(201).location(`/api/v1/equipment/${created.id}`).json({ data: created });
    },

    async update(req: Request, res: Response): Promise<void> {
      const { params, body } = validated<IdParams, unknown, UpdateEquipmentInput>(res);
      const updated = await services.equipment.update(params.id, body, currentUser(req));

      res.status(200).json({ data: updated });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const { params } = validated<IdParams>(res);
      // The actor is threaded through because a deletion is audited like any
      // other change. It comes from the verified token, never the request body.
      await services.equipment.remove(params.id, currentUser(req));

      res.status(204).send();
    },

    async audit(_req: Request, res: Response): Promise<void> {
      const { params, query } = validated<IdParams, AuditHistoryQuery>(res);
      // Returned whole, so `meta.hasMore` reaches the client and a capped trail
      // is distinguishable from a complete one.
      res.status(200).json(await services.audit.getEquipmentHistory(params.id, query));
    },
  };
}
