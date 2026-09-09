import type { Request, Response } from 'express';
import { validated } from '../../middleware/validate';
import { currentUser } from '../../middleware/auth';
import { services } from '../../container';
import type {
  CreateEquipmentInput,
  ListEquipmentQuery,
  UpdateEquipmentInput,
} from './equipment.validation';

type IdParams = { id: string };

export async function listEquipmentHandler(_req: Request, res: Response): Promise<void> {
  const { query } = validated<unknown, ListEquipmentQuery>(res);
  res.status(200).json({ data: await services.equipment.list(query) });
}

export async function getEquipmentHandler(_req: Request, res: Response): Promise<void> {
  const { params } = validated<IdParams>(res);
  res.status(200).json({ data: await services.equipment.get(params.id) });
}

export async function createEquipmentHandler(req: Request, res: Response): Promise<void> {
  const { body } = validated<unknown, unknown, CreateEquipmentInput>(res);
  const created = await services.equipment.create(body, currentUser(req));

  res.status(201).location(`/api/v1/equipment/${created.id}`).json({ data: created });
}

export async function updateEquipmentHandler(req: Request, res: Response): Promise<void> {
  const { params, body } = validated<IdParams, unknown, UpdateEquipmentInput>(res);
  const updated = await services.equipment.update(params.id, body, currentUser(req));

  res.status(200).json({ data: updated });
}

export async function deleteEquipmentHandler(_req: Request, res: Response): Promise<void> {
  const { params } = validated<IdParams>(res);
  await services.equipment.remove(params.id);

  res.status(204).send();
}
