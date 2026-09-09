import { randomUUID } from 'node:crypto';
import type { AuditAction, AuditEntity, Prisma } from '@prisma/client';
import type { FieldChange } from './diff';

export interface Actor {
  readonly id: string;
  readonly name: string;
}

export interface RecordChangesInput {
  readonly entityType: AuditEntity;
  readonly entityId: string;
  readonly action: AuditAction;
  readonly actor: Actor;
  readonly changes: readonly FieldChange[];
}

/**
 * Writes one audit row per changed field.
 *
 * The parameter type is `Prisma.TransactionClient`, NOT `PrismaClient`. That is
 * deliberate and load-bearing: it makes it a compile error to write an audit
 * entry outside a transaction, so the entity write and its audit trail can never
 * be committed independently of one another.
 *
 * Every row in one call shares a `changeSetId` and a single `changedAt`, so the
 * rows regroup into exactly one displayable event and order deterministically.
 * Taking `new Date()` once (rather than letting each row default to now())
 * is what makes that grouping stable.
 */
export async function recordChanges(
  tx: Prisma.TransactionClient,
  input: RecordChangesInput,
): Promise<void> {
  if (input.changes.length === 0) return;

  const changeSetId = randomUUID();
  const changedAt = new Date();

  await tx.auditEntry.createMany({
    data: input.changes.map((change) => ({
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
    })),
  });
}
