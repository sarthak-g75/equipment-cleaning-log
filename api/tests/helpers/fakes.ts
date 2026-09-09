import { randomUUID } from 'node:crypto';
import type { AuditEntity, AuditEntry, CleaningRecord, Equipment } from '@prisma/client';
import { toPage } from '../../src/lib/pagination';
import type {
  CleaningRecordWithCleaner,
  Repositories,
  UnitOfWork,
  UserSummary,
} from '../../src/shared/ports';

/**
 * In-memory implementations of the ports, for unit-testing services with no
 * database.
 *
 * These are deliberately simple: they store rows in arrays and implement only
 * the behaviour the services actually rely on. A fake that reimplements the
 * database faithfully is a second database to maintain, and its bugs look
 * exactly like passing tests — which is why the keyset query, the row lock and
 * transactional rollback are proven against real Postgres in the integration
 * suite instead of being simulated here.
 */
export interface InMemoryUnitOfWork extends UnitOfWork {
  seedEquipment(equipment: Partial<Equipment> & Pick<Equipment, 'id' | 'code'>): void;
  seedUser(user: Pick<UserSummary, 'id' | 'name'> & Partial<UserSummary>): void;
  allRecords(): CleaningRecordWithCleaner[];
  allAudit(): AuditEntry[];
  auditFor(entityId: string): AuditEntry[];
  clearAudit(): void;
  /** Ordered log of repository calls, so ordering guarantees can be asserted. */
  readonly calls: string[];
}

export function createInMemoryUnitOfWork(): InMemoryUnitOfWork {
  const equipment: Equipment[] = [];
  const users: UserSummary[] = [];
  let records: CleaningRecordWithCleaner[] = [];
  let audit: AuditEntry[] = [];
  const calls: string[] = [];

  const cleanerFor = (id: string): CleaningRecordWithCleaner['cleanedBy'] => {
    const user = users.find((u) => u.id === id);
    return {
      id,
      name: user?.name ?? 'Unknown',
      email: user?.email ?? `${id}@example.com`,
      role: user?.role ?? 'operator',
    };
  };

  const repos: Repositories = {
    cleaningRecords: {
      async listByEquipment(params) {
        const matching = records
          .filter((r) => r.equipmentId === params.equipmentId)
          .filter((r) => (params.status ? r.status === params.status : true))
          .sort((a, b) => b.cleanedAt.getTime() - a.cleanedAt.getTime());
        return toPage(matching.slice(0, params.limit + 1), params.limit);
      },
      async findById(id) {
        calls.push(`findById:${id}`);
        return records.find((r) => r.id === id) ?? null;
      },
      async countByEquipment(equipmentId) {
        return records.filter((r) => r.equipmentId === equipmentId).length;
      },
      async create(data) {
        const now = new Date();
        const created: CleaningRecordWithCleaner = {
          id: randomUUID(),
          equipmentId: data.equipmentId,
          cleanedById: data.cleanedById,
          cleanedAt: data.cleanedAt,
          method: data.method,
          notes: data.notes ?? null,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          cleanedBy: cleanerFor(data.cleanedById),
        };
        records.push(created);
        return created;
      },
      async update(id, data) {
        const index = records.findIndex((r) => r.id === id);
        if (index === -1) throw new Error(`no such record ${id}`);
        const current = records[index]!;
        // Mirror Prisma: an undefined key means "leave alone", not "set null".
        const patch = Object.fromEntries(
          Object.entries(data).filter(([, value]) => value !== undefined),
        ) as Partial<CleaningRecord>;
        const updated: CleaningRecordWithCleaner = {
          ...current,
          ...patch,
          updatedAt: new Date(),
          cleanedBy: cleanerFor(patch.cleanedById ?? current.cleanedById),
        };
        records[index] = updated;
        return updated;
      },
      async lockForUpdate(id) {
        calls.push(`lockForUpdate:${id}`);
      },
    },

    equipment: {
      async list(status) {
        return status ? equipment.filter((e) => e.status === status) : [...equipment];
      },
      async findById(id) {
        return equipment.find((e) => e.id === id) ?? null;
      },
      async create(data) {
        const now = new Date();
        const created: Equipment = {
          id: randomUUID(),
          name: data.name,
          code: data.code,
          status: data.status ?? 'active',
          createdAt: now,
          updatedAt: now,
        };
        equipment.push(created);
        return created;
      },
      async update(id, data) {
        const index = equipment.findIndex((e) => e.id === id);
        if (index === -1) throw new Error(`no such equipment ${id}`);
        const updated = { ...equipment[index]!, ...data, updatedAt: new Date() };
        equipment[index] = updated;
        return updated;
      },
      async deleteById(id) {
        const before = equipment.length;
        const index = equipment.findIndex((e) => e.id === id);
        if (index >= 0) equipment.splice(index, 1);
        return before - equipment.length;
      },
      async lockForUpdate(id) {
        calls.push(`lockForUpdate:${id}`);
      },
    },

    users: {
      async list(params) {
        const needle = params.q?.toLowerCase();
        return users
          .filter((u) => (params.role ? u.role === params.role : true))
          .filter((u) => (needle ? u.name.toLowerCase().includes(needle) : true));
      },
      async findByEmail() {
        return null;
      },
      async findManyByIds(ids) {
        return users.filter((u) => ids.includes(u.id)).map((u) => ({ id: u.id, name: u.name }));
      },
    },

    audit: {
      async record(input) {
        const changeSetId = randomUUID();
        const changedAt = new Date();
        for (const change of input.changes) {
          audit.push({
            id: randomUUID(),
            changeSetId,
            entityType: input.entityType,
            entityId: input.entityId,
            action: input.action,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            actorId: input.actor.id,
            actorName: input.actor.name,
            changedAt,
          });
        }
      },
      async findByEntity(entityType: AuditEntity, entityId, limit) {
        return audit
          .filter((a) => a.entityType === entityType && a.entityId === entityId)
          .slice(0, limit);
      },
    },
  };

  return {
    repos,
    // Not a real transaction: rollback is proven against Postgres in the
    // integration suite, because only a real database can prove it.
    transaction: (work) => work(repos),
    calls,
    seedEquipment(item) {
      const now = new Date();
      equipment.push({
        name: item.name ?? 'Seeded equipment',
        status: item.status ?? 'active',
        createdAt: now,
        updatedAt: now,
        ...item,
      } as Equipment);
    },
    seedUser(user) {
      users.push({
        email: `${user.id}@example.com`,
        role: 'operator',
        ...user,
      } as UserSummary);
    },
    allRecords: () => [...records],
    allAudit: () => [...audit],
    auditFor: (entityId) => audit.filter((a) => a.entityId === entityId),
    clearAudit: () => {
      audit = [];
    },
  };
}
