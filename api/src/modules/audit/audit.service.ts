import type { AuditAction, AuditEntity, AuditEntry } from '@prisma/client';
import { NotFoundError } from '../../lib/errors';
import type { Repositories, UnitOfWork } from '../../shared/ports';
import type { AuditHistoryQuery } from './audit.validation';

export interface AuditFieldChange {
  readonly field: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  /**
   * Human-readable renderings of the raw values, present only for fields that
   * hold a reference to another row. The stored value stays the id — that is
   * what actually changed — but an auditor reading
   * "cleanedById: 3f1a… -> 8c2b…" learns nothing.
   */
  readonly oldLabel?: string | null;
  readonly newLabel?: string | null;
}

export interface AuditChangeSet {
  readonly changeSetId: string;
  readonly action: AuditAction;
  readonly changedAt: Date;
  readonly actor: { readonly id: string; readonly name: string };
  readonly changes: readonly AuditFieldChange[];
}

/**
 * Describes how to turn the ids held by one audit field into display labels.
 *
 * A registry rather than a switch: adding a new referenced entity means adding
 * an entry here, not editing the resolver's logic. The resolver is closed for
 * modification and open for extension, and each resolver receives *all* the ids
 * for its field at once so lookups stay batched.
 */
export interface ReferenceResolver {
  readonly field: string;
  resolve(ids: readonly string[], repos: Repositories): Promise<ReadonlyMap<string, string>>;
}

export const DEFAULT_REFERENCE_RESOLVERS: readonly ReferenceResolver[] = [
  {
    field: 'cleanedById',
    async resolve(ids, repos) {
      const users = await repos.users.findManyByIds(ids);
      return new Map(users.map((user) => [user.id, user.name]));
    },
  },
  {
    field: 'equipmentId',
    async resolve(ids, repos) {
      const all = await repos.equipment.list();
      return new Map(
        all.filter((item) => ids.includes(item.id)).map((item) => [item.id, `${item.name} (${item.code})`]),
      );
    },
  },
];

export interface AuditService {
  getRecordHistory(recordId: string, query: AuditHistoryQuery): Promise<AuditChangeSet[]>;
  getEquipmentHistory(equipmentId: string, query: AuditHistoryQuery): Promise<AuditChangeSet[]>;
}

export function createAuditService(
  uow: UnitOfWork,
  resolvers: readonly ReferenceResolver[] = DEFAULT_REFERENCE_RESOLVERS,
): AuditService {
  const byField = new Map(resolvers.map((resolver) => [resolver.field, resolver]));

  /**
   * Resolves every referenced id with one lookup per field, rather than a
   * lookup per change row — the N+1 this endpoint would otherwise have.
   */
  async function resolveLabels(rows: readonly AuditEntry[]): Promise<Map<string, string>> {
    const idsByField = new Map<string, Set<string>>();

    for (const row of rows) {
      if (!byField.has(row.field)) continue;
      const bucket = idsByField.get(row.field) ?? new Set<string>();
      if (row.oldValue) bucket.add(row.oldValue);
      if (row.newValue) bucket.add(row.newValue);
      idsByField.set(row.field, bucket);
    }

    const labels = new Map<string, string>();
    if (idsByField.size === 0) return labels;

    const resolved = await Promise.all(
      [...idsByField].map(([field, ids]) => byField.get(field)!.resolve([...ids], uow.repos)),
    );

    for (const map of resolved) {
      for (const [id, label] of map) labels.set(id, label);
    }

    return labels;
  }

  /**
   * The table stores one row per changed field. This regroups those rows into
   * the events a human reads: "QA Lead verified this record, and here are the
   * values that moved."
   *
   * Grouped in application code rather than SQL because the row count per
   * record is small, and a GROUP BY with array aggregation would be far harder
   * to read for no measurable gain at this scale.
   */
  function groupByChangeSet(
    rows: readonly AuditEntry[],
    labels: Map<string, string>,
  ): AuditChangeSet[] {
    const sets = new Map<string, AuditChangeSet & { changes: AuditFieldChange[] }>();

    // A referenced row that has since been deleted resolves to nothing; fall
    // back to the raw id rather than rendering a blank, so the trail stays
    // complete and truthful.
    const label = (value: string | null): string | null =>
      value === null ? null : (labels.get(value) ?? value);

    for (const row of rows) {
      let set = sets.get(row.changeSetId);
      if (!set) {
        set = {
          changeSetId: row.changeSetId,
          action: row.action,
          changedAt: row.changedAt,
          actor: { id: row.actorId, name: row.actorName },
          changes: [],
        };
        sets.set(row.changeSetId, set);
      }
      set.changes.push({
        field: row.field,
        oldValue: row.oldValue,
        newValue: row.newValue,
        ...(byField.has(row.field)
          ? { oldLabel: label(row.oldValue), newLabel: label(row.newValue) }
          : {}),
      });
    }

    return [...sets.values()];
  }

  async function history(
    entityType: AuditEntity,
    entityId: string,
    query: AuditHistoryQuery,
  ): Promise<AuditChangeSet[]> {
    const rows = await uow.repos.audit.findByEntity(entityType, entityId, query.limit);
    return groupByChangeSet(rows, await resolveLabels(rows));
  }

  return {
    async getRecordHistory(recordId, query) {
      const record = await uow.repos.cleaningRecords.findById(recordId);
      if (!record) throw new NotFoundError('CleaningRecord', recordId);
      return history('CleaningRecord', recordId, query);
    },

    async getEquipmentHistory(equipmentId, query) {
      const equipment = await uow.repos.equipment.findById(equipmentId);
      if (!equipment) throw new NotFoundError('Equipment', equipmentId);
      return history('Equipment', equipmentId, query);
    },
  };
}
