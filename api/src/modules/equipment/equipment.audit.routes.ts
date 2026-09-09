import type { Request, Response } from 'express';
import { validated } from '../../middleware/validate';
import * as auditService from '../audit/audit.service';
import type { AuditHistoryQuery } from '../audit/audit.validation';

export async function equipmentAuditHandler(_req: Request, res: Response): Promise<void> {
  const { params, query } = validated<{ id: string }, AuditHistoryQuery>(res);
  res.status(200).json({ data: await auditService.getEquipmentHistory(params.id, query) });
}
