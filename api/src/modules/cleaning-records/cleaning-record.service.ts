import type { CleaningRecord } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { diffFields } from '../../lib/audit/diff';
import type { PageMeta } from '../../lib/pagination';
import type {
  Actor,
  CleaningRecordWithCleaner,
  CreateRecordData,
  Repositories,
  UnitOfWork,
  UpdateRecordData,
} from '../../shared/ports';
import type { ListRecordsQuery } from './cleaning-record.validation';

/**
 * Compile-time checked against the Prisma model: renaming a column breaks the
 * build instead of silently dropping a field out of the audit trail.
 */
export const CLEANING_RECORD_TRACKED_FIELDS = [
  'equipmentId',
  'cleanedById',
  'cleanedAt',
  'method',
  'notes',
  'status',
] as const satisfies readonly (keyof CleaningRecord)[];

export interface CleaningRecordService {
  list(equipmentId: string, query: ListRecordsQuery): Promise<{ data: CleaningRecordWithCleaner[]; meta: PageMeta }>;
  get(id: string): Promise<CleaningRecordWithCleaner>;
  create(equipmentId: string, input: Omit<CreateRecordData, 'equipmentId'>, actor: Actor): Promise<CleaningRecordWithCleaner>;
  update(id: string, patch: UpdateRecordData, actor: Actor): Promise<CleaningRecordWithCleaner>;
  verify(id: string, actor: Actor): Promise<CleaningRecordWithCleaner>;
}

/**
 * Built from a UnitOfWork rather than importing a database client, so the whole
 * service can be unit-tested against in-memory fakes. See
 * `cleaning-record.service.test.ts`, which exercises every rule below with no
 * Postgres running.
 */
export function createCleaningRecordService(uow: UnitOfWork): CleaningRecordService {
  /**
   * Reads the record under a row lock and applies a change, writing the record
   * and its audit entry in one transaction.
   *
   * Both mutating operations funnel through here so the locking, the diffing
   * and the audit write exist exactly once — `update` and `verify` differ only
   * in what they change and which preconditions they enforce.
   */
  async function applyChange(
    id: string,
    actor: Actor,
    guard: (before: CleaningRecord) => void,
    change: UpdateRecordData & { status?: CleaningRecord['status'] },
  ): Promise<CleaningRecordWithCleaner> {
    return uow.transaction(async (repos: Repositories) => {
      // Postgres defaults to READ COMMITTED, so without this lock two
      // concurrent writers both read the same predecessor and the trail records
      // a forked lineage: A->B and A->C, with no way to tell what the value
      // actually was before the second edit. The row state would still be
      // right; the audit trail would be a lie, which is the failure this system
      // cannot tolerate.
      await repos.cleaningRecords.lockForUpdate(id);

      const before = await repos.cleaningRecords.findById(id);
      if (!before) throw new NotFoundError('CleaningRecord', id);

      guard(before);

      const after = await repos.cleaningRecords.update(id, change);

      // Diffed against the row the database returned, not against the caller's
      // patch, so anything computed server-side is audited automatically and a
      // caller can never inject a field name into the trail.
      await repos.audit.record({
        entityType: 'CleaningRecord',
        entityId: id,
        action: 'UPDATE',
        actor,
        changes: diffFields(before, after, CLEANING_RECORD_TRACKED_FIELDS),
      });

      return after;
    });
  }

  return {
    async list(equipmentId, query) {
      // A 404 for unknown equipment rather than an empty page, which would be
      // indistinguishable from "this equipment has never been cleaned".
      const equipment = await uow.repos.equipment.findById(equipmentId);
      if (!equipment) throw new NotFoundError('Equipment', equipmentId);

      return uow.repos.cleaningRecords.listByEquipment({
        equipmentId,
        status: query.status,
        limit: query.limit,
        cursor: query.cursor,
      });
    },

    async get(id) {
      const record = await uow.repos.cleaningRecords.findById(id);
      if (!record) throw new NotFoundError('CleaningRecord', id);
      return record;
    },

    create(equipmentId, input, actor) {
      return uow.transaction(async (repos) => {
        const equipment = await repos.equipment.findById(equipmentId);
        if (!equipment) throw new NotFoundError('Equipment', equipmentId);

        if (equipment.status === 'retired') {
          throw new ConflictError(
            'EQUIPMENT_RETIRED',
            'Cleaning records cannot be logged against retired equipment.',
          );
        }

        const created = await repos.cleaningRecords.create({ ...input, equipmentId });

        // Creation and update share one diff implementation: `before = null`
        // emits every field as null -> value, so the trail can reconstruct the
        // record's whole history with no special case for "created".
        await repos.audit.record({
          entityType: 'CleaningRecord',
          entityId: created.id,
          action: 'CREATE',
          actor,
          changes: diffFields(null, created, CLEANING_RECORD_TRACKED_FIELDS),
        });

        return created;
      });
    },

    update(id, patch, actor) {
      return applyChange(
        id,
        actor,
        (before) => {
          if (before.status === 'verified') {
            throw new ConflictError(
              'RECORD_VERIFIED',
              'A verified cleaning record cannot be edited. Raise a new record instead.',
            );
          }
        },
        patch,
      );
    },

    verify(id, actor) {
      return applyChange(
        id,
        actor,
        (before) => {
          if (before.status === 'verified') {
            throw new ConflictError('ALREADY_VERIFIED', 'This record has already been verified.');
          }
        },
        { status: 'verified' },
      );
    },
  };
}
