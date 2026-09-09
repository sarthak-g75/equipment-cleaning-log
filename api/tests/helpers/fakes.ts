import { randomUUID } from 'node:crypto';
import type { AuditEntity, AuditEntry, CleaningRecord, Equipment } from '@prisma/client';
import { recordListScope, recordPaginator } from '../../src/lib/pagination';
import type {
  AuditRowPage,
  CleaningRecordWithCleaner,
  Repositories,
  UnitOfWork,
  UserSummary,
} from '../../src/shared/ports';

/**
 * In-memory implementations of the ports, for unit-testing services with no
 * database.
 *
 * These are deliberately simple — rows in arrays — but they are *faithful*
 * about behaviour the services can observe. That distinction matters: a fake
 * that quietly ignores a parameter (an earlier version of this file dropped
 * `cursor` entirely and sorted without the id tie-break) makes a broken test
 * pass, which is worse than not having the test. Where faithfully imitating
 * Postgres is not worth it, the fake throws instead of pretending.
 *
 * What is still proven only against real Postgres, because only a real database
 * can prove it: the row lock's exclusion, and transactional rollback.
 */
export interface InMemoryUnitOfWork extends UnitOfWork {
  seedEquipment(equipment: Partial<Equipment> & Pick<Equipment, 'id' | 'code'>): void;
  seedUser(user: Pick<UserSummary, 'id' | 'name'> & Partial<UserSummary>): void;
  allRecords(): CleaningRecordWithCleaner[];
  allEquipment(): Equipment[];
  allAudit(): AuditEntry[];
  auditFor(entityId: string): AuditEntry[];
  clearAudit(): void;
  /** Ordered log of repository calls, so ordering guarantees can be asserted. */
  readonly calls: string[];
}

export function createInMemoryUnitOfWork(): InMemoryUnitOfWork {
  const equipment: Equipment[] = [];
  const users: UserSummary[] = [];
  const records: CleaningRecordWithCleaner[] = [];
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
      /**
       * A real keyset walk, including the `id` tie-break and the cursor scope
       * check, so a unit test that pages through results is testing something.
       */
      async listByEquipment(params) {
        const scope = recordListScope(params);
        const cursor = params.cursor ? recordPaginator.decode(params.cursor, scope) : undefined;

        const matching = records
          .filter((r) => r.equipmentId === params.equipmentId)
          .filter((r) => (params.status ? r.status === params.status : true))
          // ORDER BY cleanedAt DESC, id DESC — the same total order the index
          // gives, tie-break included.
          .sort(
            (a, b) =>
              b.cleanedAt.getTime() - a.cleanedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
          )
          .filter((r) => {
            if (!cursor) return true;
            const t = r.cleanedAt.getTime();
            const c = cursor.sortValue.getTime();
            return t < c || (t === c && r.id < cursor.id);
          });

        return recordPaginator.toPage(matching.slice(0, params.limit + 1), params.limit, scope);
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
      async findManyByIds(ids) {
        return equipment
          .filter((e) => ids.includes(e.id))
          .map((e) => ({ id: e.id, name: e.name, code: e.code }));
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
        const index = equipment.findIndex((e) => e.id === id);
        if (index === -1) return null;
        const [removed] = equipment.splice(index, 1);
        return removed ?? null;
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
          // Name OR email, matching the real repository. Searching only one of
          // them here would green-light a test the database would fail.
          .filter((u) =>
            needle
              ? u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)
              : true,
          )
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, params.limit);
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
      /**
       * Limits CHANGE SETS, not rows, and orders newest-first — the same
       * contract the Prisma adapter implements with groupBy. Slicing rows here
       * would hide the truncation bug this contract exists to prevent.
       */
      async findByEntity(entityType: AuditEntity, entityId, limit): Promise<AuditRowPage> {
        const mine = audit.filter((a) => a.entityType === entityType && a.entityId === entityId);

        const order: string[] = [];
        for (const row of [...mine].sort(
          (a, b) =>
            b.changedAt.getTime() - a.changedAt.getTime() ||
            (a.changeSetId < b.changeSetId ? 1 : a.changeSetId > b.changeSetId ? -1 : 0),
        )) {
          if (!order.includes(row.changeSetId)) order.push(row.changeSetId);
        }

        const kept = order.slice(0, limit);
        const data = kept.flatMap((changeSetId) =>
          mine
            .filter((a) => a.changeSetId === changeSetId)
            .sort((a, b) => a.field.localeCompare(b.field)),
        );

        return { data, hasMore: order.length > limit };
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
      });
    },
    seedUser(user) {
      users.push({
        email: `${user.id}@example.com`,
        role: 'operator',
        ...user,
      });
    },
    allRecords: () => [...records],
    allEquipment: () => [...equipment],
    allAudit: () => [...audit],
    auditFor: (entityId) => audit.filter((a) => a.entityId === entityId),
    clearAudit: () => {
      audit = [];
    },
  };
}
