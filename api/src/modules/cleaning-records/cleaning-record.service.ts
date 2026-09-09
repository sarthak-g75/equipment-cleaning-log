import type { CleaningRecord } from '@prisma/client';
import { recordInclude, type CleaningRecordDto } from './cleaning-record.types';
import { prisma } from '../../database/prisma';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { diffFields, recordChanges, type Actor } from '../../lib/audit';
import type { PageMeta } from '../../lib/pagination';
import * as repository from './cleaning-record.repository';
import type {
  CreateRecordInput,
  ListRecordsQuery,
  UpdateRecordInput,
} from './cleaning-record.validation';

export const CLEANING_RECORD_TRACKED_FIELDS = [
  'equipmentId',
  'cleanedById',
  'cleanedAt',
  'method',
  'notes',
  'status',
] as const satisfies readonly (keyof CleaningRecord)[];

export async function listRecords(
  equipmentId: string,
  query: ListRecordsQuery,
): Promise<{ data: CleaningRecordDto[]; meta: PageMeta }> {
  // Fail with a 404 for an unknown equipment rather than returning an empty
  // page, which would be indistinguishable from "this equipment is clean".
  const exists = await prisma.equipment.findUnique({
    where: { id: equipmentId },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError('Equipment', equipmentId);

  return repository.listByEquipment({
    equipmentId,
    status: query.status,
    limit: query.limit,
    cursor: query.cursor,
  });
}

export async function getRecord(id: string): Promise<CleaningRecordDto> {
  const record = await prisma.cleaningRecord.findUnique({ where: { id }, include: recordInclude });
  if (!record) throw new NotFoundError('CleaningRecord', id);
  return record;
}

export function createRecord(
  equipmentId: string,
  input: CreateRecordInput,
  actor: Actor,
): Promise<CleaningRecordDto> {
  return prisma.$transaction(async (tx) => {
    const equipment = await tx.equipment.findUnique({ where: { id: equipmentId } });
    if (!equipment) throw new NotFoundError('Equipment', equipmentId);

    if (equipment.status === 'retired') {
      throw new ConflictError(
        'EQUIPMENT_RETIRED',
        'Cleaning records cannot be logged against retired equipment.',
      );
    }

    const created = await tx.cleaningRecord.create({
      data: { ...input, equipmentId },
      include: recordInclude,
    });

    await recordChanges(tx, {
      entityType: 'CleaningRecord',
      entityId: created.id,
      action: 'CREATE',
      actor,
      changes: diffFields(null, created, CLEANING_RECORD_TRACKED_FIELDS),
    });

    return created;
  });
}

export function updateRecord(
  id: string,
  patch: UpdateRecordInput,
  actor: Actor,
): Promise<CleaningRecordDto> {
  return prisma.$transaction(async (tx) => {
    // Lock the row before reading it. Postgres defaults to READ COMMITTED, so
    // without this two concurrent PATCHes both read the same `before` and the
    // trail records A->B and A->C: a forked lineage where an auditor cannot tell
    // what the value actually was immediately before the second edit. The final
    // row state would still be correct; the audit trail would be a lie, which is
    // the one failure this system cannot tolerate.
    await tx.$queryRaw`SELECT id FROM "CleaningRecord" WHERE id = ${id}::uuid FOR UPDATE`;

    const before = await tx.cleaningRecord.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('CleaningRecord', id);

    if (before.status === 'verified') {
      throw new ConflictError(
        'RECORD_VERIFIED',
        'A verified cleaning record cannot be edited. Raise a new record instead.',
      );
    }

    const after = await tx.cleaningRecord.update({
      where: { id },
      data: patch,
      include: recordInclude,
    });

    // Diffed against the row Prisma returned, not against the client's patch, so
    // anything the service computes server-side is audited automatically and a
    // client can never inject a field name into the trail.
    await recordChanges(tx, {
      entityType: 'CleaningRecord',
      entityId: id,
      action: 'UPDATE',
      actor,
      changes: diffFields(before, after, CLEANING_RECORD_TRACKED_FIELDS),
    });

    return after;
  });
}

export function verifyRecord(id: string, actor: Actor): Promise<CleaningRecordDto> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CleaningRecord" WHERE id = ${id}::uuid FOR UPDATE`;

    const before = await tx.cleaningRecord.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('CleaningRecord', id);

    if (before.status === 'verified') {
      throw new ConflictError('ALREADY_VERIFIED', 'This record has already been verified.');
    }

    const after = await tx.cleaningRecord.update({
      where: { id },
      data: { status: 'verified' },
      include: recordInclude,
    });

    await recordChanges(tx, {
      entityType: 'CleaningRecord',
      entityId: id,
      action: 'UPDATE',
      actor,
      changes: diffFields(before, after, CLEANING_RECORD_TRACKED_FIELDS),
    });

    return after;
  });
}
