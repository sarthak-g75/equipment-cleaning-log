import type { AuditAction, AuditEntity, AuditEntry } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { NotFoundError } from '../../lib/errors';
import type { AuditHistoryQuery } from './audit.validation';

export interface AuditFieldChange {
  readonly field: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  /**
   * Human-readable renderings of the raw values, present only for fields that
   * hold a reference to another row. The stored value stays the id — that is
   * what actually changed — but an auditor reading "cleanedById: 3f1a… -> 8c2b…"
   * learns nothing, so the label is resolved for display.
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

/** Audit fields whose value is a foreign key, and the table it points at. */
const REFERENCE_FIELDS: Record<string, 'user' | 'equipment'> = {
  cleanedById: 'user',
  equipmentId: 'equipment',
};

/**
 * Resolves every referenced id in one round trip per table, rather than a lookup
 * per change row — the classic N+1 this endpoint would otherwise have.
 */
async function resolveLabels(rows: readonly AuditEntry[]): Promise<Map<string, string>> {
  const userIds = new Set<string>();
  const equipmentIds = new Set<string>();

  for (const row of rows) {
    const target = REFERENCE_FIELDS[row.field];
    if (!target) continue;
    const bucket = target === 'user' ? userIds : equipmentIds;
    if (row.oldValue) bucket.add(row.oldValue);
    if (row.newValue) bucket.add(row.newValue);
  }

  const labels = new Map<string, string>();
  if (userIds.size === 0 && equipmentIds.size === 0) return labels;

  const [users, equipment] = await Promise.all([
    userIds.size
      ? prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    equipmentIds.size
      ? prisma.equipment.findMany({
          where: { id: { in: [...equipmentIds] } },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve([]),
  ]);

  for (const user of users) labels.set(user.id, user.name);
  for (const item of equipment) labels.set(item.id, `${item.name} (${item.code})`);

  return labels;
}

/**
 * The audit table stores one row per changed field. This regroups those rows
 * into the events a human actually reads: "QA Lead verified this record, and
 * here are the three values that moved."
 *
 * Grouping is done in application code rather than SQL because the row count per
 * record is small (a record is edited a handful of times) and a hand-rolled
 * GROUP BY with array aggregation would be far harder to read for no measurable
 * gain at this scale.
 */
function groupByChangeSet(
  rows: readonly AuditEntry[],
  labels: Map<string, string>,
): AuditChangeSet[] {
  const sets = new Map<string, AuditChangeSet & { changes: AuditFieldChange[] }>();

  // A referenced row that has since been deleted resolves to nothing; fall back
  // to the raw id rather than rendering a blank, so the trail stays complete.
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
      ...(REFERENCE_FIELDS[row.field]
        ? { oldLabel: label(row.oldValue), newLabel: label(row.newValue) }
        : {}),
    });
  }

  return [...sets.values()];
}

async function getHistory(
  entityType: AuditEntity,
  entityId: string,
  query: AuditHistoryQuery,
): Promise<AuditChangeSet[]> {
  const rows = await prisma.auditEntry.findMany({
    where: { entityType, entityId },
    // Newest change set first; `field` ascending keeps the lines within one set
    // in a stable order rather than whatever the planner happens to return.
    orderBy: [{ changedAt: 'desc' }, { changeSetId: 'desc' }, { field: 'asc' }],
    take: query.limit,
  });

  return groupByChangeSet(rows, await resolveLabels(rows));
}

export async function getRecordHistory(
  recordId: string,
  query: AuditHistoryQuery,
): Promise<AuditChangeSet[]> {
  const exists = await prisma.cleaningRecord.findUnique({
    where: { id: recordId },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError('CleaningRecord', recordId);

  return getHistory('CleaningRecord', recordId, query);
}

export async function getEquipmentHistory(
  equipmentId: string,
  query: AuditHistoryQuery,
): Promise<AuditChangeSet[]> {
  const exists = await prisma.equipment.findUnique({
    where: { id: equipmentId },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError('Equipment', equipmentId);

  return getHistory('Equipment', equipmentId, query);
}
