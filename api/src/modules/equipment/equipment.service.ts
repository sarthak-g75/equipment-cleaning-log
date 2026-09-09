import type { Equipment } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { diffFields, recordChanges, type Actor } from '../../lib/audit';
import type {
  CreateEquipmentInput,
  ListEquipmentQuery,
  UpdateEquipmentInput,
} from './equipment.validation';

/**
 * Compile-time checked against the Prisma model: renaming a column breaks the
 * build instead of silently dropping a field out of the audit trail.
 */
export const EQUIPMENT_TRACKED_FIELDS = [
  'name',
  'code',
  'status',
] as const satisfies readonly (keyof Equipment)[];

export function listEquipment(query: ListEquipmentQuery): Promise<Equipment[]> {
  // Equipment is a small, bounded reference list (tens of rows, not millions),
  // so it is returned whole. The interesting pagination is on cleaning records.
  return prisma.equipment.findMany({
    where: query.status ? { status: query.status } : {},
    orderBy: [{ status: 'asc' }, { code: 'asc' }],
  });
}

export async function getEquipment(id: string): Promise<Equipment> {
  const equipment = await prisma.equipment.findUnique({ where: { id } });
  if (!equipment) throw new NotFoundError('Equipment', id);
  return equipment;
}

export function createEquipment(input: CreateEquipmentInput, actor: Actor): Promise<Equipment> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.equipment.create({ data: input });

    // Creation and update share one diff implementation: `before = null` emits
    // every field as null -> value, so the trail can reconstruct the row's
    // entire history without a special case for "created".
    await recordChanges(tx, {
      entityType: 'Equipment',
      entityId: created.id,
      action: 'CREATE',
      actor,
      changes: diffFields(null, created, EQUIPMENT_TRACKED_FIELDS),
    });

    return created;
  });
}

export function updateEquipment(
  id: string,
  patch: UpdateEquipmentInput,
  actor: Actor,
): Promise<Equipment> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Equipment" WHERE id = ${id}::uuid FOR UPDATE`;

    const before = await tx.equipment.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('Equipment', id);

    const after = await tx.equipment.update({ where: { id }, data: patch });

    await recordChanges(tx, {
      entityType: 'Equipment',
      entityId: id,
      action: 'UPDATE',
      actor,
      changes: diffFields(before, after, EQUIPMENT_TRACKED_FIELDS),
    });

    return after;
  });
}

export async function deleteEquipment(id: string): Promise<void> {
  const recordCount = await prisma.cleaningRecord.count({ where: { equipmentId: id } });

  // Deleting equipment that has cleaning records would orphan an audit trail,
  // which is the one thing this system exists to prevent. Retirement is the
  // correct operation for equipment that has been used.
  if (recordCount > 0) {
    throw new ConflictError(
      'EQUIPMENT_IN_USE',
      `This equipment has ${recordCount} cleaning record(s) and cannot be deleted. Set its status to 'retired' instead.`,
    );
  }

  const deleted = await prisma.equipment.deleteMany({ where: { id } });
  if (deleted.count === 0) throw new NotFoundError('Equipment', id);
}
