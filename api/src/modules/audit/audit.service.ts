import type { AuditAction, AuditEntity, AuditEntry } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { NotFoundError } from '../../lib/errors';
import type { AuditHistoryQuery } from './audit.validation';

export interface AuditChangeSet {
  readonly changeSetId: string;
  readonly action: AuditAction;
  readonly changedAt: Date;
  readonly actor: { readonly id: string; readonly name: string };
  readonly changes: ReadonlyArray<{
    readonly field: string;
    readonly oldValue: string | null;
    readonly newValue: string | null;
  }>;
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
function groupByChangeSet(rows: readonly AuditEntry[]): AuditChangeSet[] {
  const sets = new Map<string, AuditChangeSet & { changes: AuditChangeSet['changes'][number][] }>();

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

  return groupByChangeSet(rows);
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
