import type { Request, Response } from 'express';
import { validated } from '../../middleware/validate';
import { currentUser } from '../../middleware/auth';
import { services } from '../../container';
import type {
  CreateRecordInput,
  ListRecordsQuery,
  UpdateRecordInput,
} from './cleaning-record.validation';
import type { AuditHistoryQuery } from '../audit/audit.validation';

type IdParams = { id: string };
type EquipmentIdParams = { equipmentId: string };

export async function listRecordsHandler(_req: Request, res: Response): Promise<void> {
  const { params, query } = validated<EquipmentIdParams, ListRecordsQuery>(res);
  const page = await services.cleaningRecords.list(params.equipmentId, query);

  res.status(200).json(page);
}

export async function getRecordHandler(_req: Request, res: Response): Promise<void> {
  const { params } = validated<IdParams>(res);
  res.status(200).json({ data: await services.cleaningRecords.get(params.id) });
}

export async function createRecordHandler(req: Request, res: Response): Promise<void> {
  const { params, body } = validated<EquipmentIdParams, unknown, CreateRecordInput>(res);
  const created = await services.cleaningRecords.create(params.equipmentId, body, currentUser(req));

  res.status(201).location(`/api/v1/cleaning-records/${created.id}`).json({ data: created });
}

export async function updateRecordHandler(req: Request, res: Response): Promise<void> {
  const { params, body } = validated<IdParams, unknown, UpdateRecordInput>(res);
  const updated = await services.cleaningRecords.update(params.id, body, currentUser(req));

  res.status(200).json({ data: updated });
}

export async function verifyRecordHandler(req: Request, res: Response): Promise<void> {
  const { params } = validated<IdParams>(res);
  const verified = await services.cleaningRecords.verify(params.id, currentUser(req));

  res.status(200).json({ data: verified });
}

export async function recordAuditHandler(_req: Request, res: Response): Promise<void> {
  const { params, query } = validated<IdParams, AuditHistoryQuery>(res);
  const history = await services.audit.getRecordHistory(params.id, query);

  res.status(200).json({ data: history });
}
