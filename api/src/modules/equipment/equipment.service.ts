import type { Equipment } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { diffFields } from '../../lib/audit/diff';
import type {
  Actor,
  CreateEquipmentData,
  UnitOfWork,
  UpdateEquipmentData,
} from '../../shared/ports';
import type { ListEquipmentQuery } from './equipment.validation';

export const EQUIPMENT_TRACKED_FIELDS = [
  'name',
  'code',
  'status',
] as const satisfies readonly (keyof Equipment)[];

export interface EquipmentService {
  list(query: ListEquipmentQuery): Promise<Equipment[]>;
  get(id: string): Promise<Equipment>;
  create(input: CreateEquipmentData, actor: Actor): Promise<Equipment>;
  update(id: string, patch: UpdateEquipmentData, actor: Actor): Promise<Equipment>;
  remove(id: string): Promise<void>;
}

export function createEquipmentService(uow: UnitOfWork): EquipmentService {
  return {
    // Equipment is a small, bounded reference list (tens of rows, not millions),
    // so it is returned whole. The interesting pagination is on cleaning records.
    list: (query) => uow.repos.equipment.list(query.status),

    async get(id) {
      const equipment = await uow.repos.equipment.findById(id);
      if (!equipment) throw new NotFoundError('Equipment', id);
      return equipment;
    },

    create(input, actor) {
      return uow.transaction(async (repos) => {
        const created = await repos.equipment.create(input);

        await repos.audit.record({
          entityType: 'Equipment',
          entityId: created.id,
          action: 'CREATE',
          actor,
          changes: diffFields(null, created, EQUIPMENT_TRACKED_FIELDS),
        });

        return created;
      });
    },

    update(id, patch, actor) {
      return uow.transaction(async (repos) => {
        await repos.equipment.lockForUpdate(id);

        const before = await repos.equipment.findById(id);
        if (!before) throw new NotFoundError('Equipment', id);

        const after = await repos.equipment.update(id, patch);

        await repos.audit.record({
          entityType: 'Equipment',
          entityId: id,
          action: 'UPDATE',
          actor,
          changes: diffFields(before, after, EQUIPMENT_TRACKED_FIELDS),
        });

        return after;
      });
    },

    async remove(id) {
      const recordCount = await uow.repos.cleaningRecords.countByEquipment(id);

      // Deleting equipment that has cleaning records would orphan an audit
      // trail, which is the one thing this system exists to prevent. Retirement
      // is the correct operation for equipment that has been used.
      if (recordCount > 0) {
        throw new ConflictError(
          'EQUIPMENT_IN_USE',
          `This equipment has ${recordCount} cleaning record(s) and cannot be deleted. Set its status to 'retired' instead.`,
        );
      }

      const deleted = await uow.repos.equipment.deleteById(id);
      if (deleted === 0) throw new NotFoundError('Equipment', id);
    },
  };
}
