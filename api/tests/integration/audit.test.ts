import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { CleaningRecord, Equipment, User } from '@prisma/client';
import { prisma } from '../../src/database/prisma';
import {
  createRecord,
  updateRecord,
  verifyRecord,
} from '../../src/modules/cleaning-records/cleaning-record.service';
import { hasDatabase, useCleanDatabase } from '../helpers/db';
import { actorFor, makeEquipment, makeUser } from '../helpers/factories';

describe.skipIf(!hasDatabase)('audit trail (integration)', () => {
  useCleanDatabase();

  let equipment: Equipment;
  let user: User;
  let record: CleaningRecord;

  const CLEANED_AT = new Date('2026-08-24T08:00:00.000Z');

  beforeEach(async () => {
    equipment = await makeEquipment();
    user = await makeUser({ name: 'Alice Chen', role: 'qa' });
    record = await createRecord(
      equipment.id,
      {
        cleanedBy: 'B. Novak',
        cleanedAt: CLEANED_AT,
        method: 'CIP - caustic',
        notes: 'Swab passed',
      },
      actorFor(user),
    );
  });

  const auditRows = (entityId: string) =>
    prisma.auditEntry.findMany({ where: { entityId }, orderBy: { field: 'asc' } });

  describe('on create', () => {
    it('writes one CREATE row per supplied field, all with a null old value', async () => {
      const rows = await auditRows(record.id);

      expect(rows.map((r) => r.field)).toEqual([
        'cleanedAt',
        'cleanedBy',
        'equipmentId',
        'method',
        'notes',
        'status',
      ]);
      expect(rows.every((r) => r.action === 'CREATE')).toBe(true);
      expect(rows.every((r) => r.oldValue === null)).toBe(true);
      // A record's full state is therefore reconstructable from the trail alone.
      expect(rows.find((r) => r.field === 'cleanedAt')?.newValue).toBe(CLEANED_AT.toISOString());
      expect(rows.find((r) => r.field === 'status')?.newValue).toBe('pending');
    });

    it('groups every row of the creation into one change set with one timestamp', async () => {
      const rows = await auditRows(record.id);

      expect(new Set(rows.map((r) => r.changeSetId)).size).toBe(1);
      expect(new Set(rows.map((r) => r.changedAt.getTime())).size).toBe(1);
    });
  });

  describe('on update', () => {
    it('writes exactly one row per changed field, attributed to the acting user', async () => {
      await updateRecord(
        record.id,
        { method: 'Manual wipe (IPA 70%)', notes: 'TOC 0.4 ppm' },
        actorFor(user),
      );

      const updates = (await auditRows(record.id)).filter((r) => r.action === 'UPDATE');

      expect(updates).toHaveLength(2);
      expect(updates.map((r) => [r.field, r.oldValue, r.newValue])).toEqual([
        ['method', 'CIP - caustic', 'Manual wipe (IPA 70%)'],
        ['notes', 'Swab passed', 'TOC 0.4 ppm'],
      ]);
      expect(new Set(updates.map((r) => r.changeSetId)).size).toBe(1);
      expect(updates.every((r) => r.actorId === user.id)).toBe(true);
      // Snapshotted, not joined: renaming the user later must not rewrite history.
      expect(updates.every((r) => r.actorName === 'Alice Chen')).toBe(true);
    });

    it('writes nothing at all when the patch changes no values', async () => {
      const before = await auditRows(record.id);

      await updateRecord(
        record.id,
        { method: 'CIP - caustic', cleanedBy: 'B. Novak' },
        actorFor(user),
      );

      expect(await auditRows(record.id)).toHaveLength(before.length);
    });

    it('does not record a field the patch omitted', async () => {
      await updateRecord(record.id, { method: 'SIP' }, actorFor(user));

      const updates = (await auditRows(record.id)).filter((r) => r.action === 'UPDATE');

      expect(updates.map((r) => r.field)).toEqual(['method']);
    });

    it('records clearing a field as an explicit change to null', async () => {
      await updateRecord(record.id, { notes: null }, actorFor(user));

      const updates = (await auditRows(record.id)).filter((r) => r.action === 'UPDATE');

      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({ field: 'notes', oldValue: 'Swab passed', newValue: null });
    });

    it('never records updatedAt, which changes on every write', async () => {
      await updateRecord(record.id, { method: 'SIP' }, actorFor(user));

      const rows = await auditRows(record.id);

      expect(rows.map((r) => r.field)).not.toContain('updatedAt');
    });
  });

  describe('transaction boundary', () => {
    it('rolls the record update back when the audit write fails', async () => {
      // The audit row's actorId is a foreign key to User. Passing an id that does
      // not exist makes the audit insert fail *after* the record update has been
      // issued inside the same transaction. If the two writes were not atomic,
      // the record would be left modified with no trail — the exact divergence
      // this design exists to make impossible.
      const ghost = { id: randomUUID(), name: 'Ghost' };

      await expect(updateRecord(record.id, { method: 'SIP' }, ghost)).rejects.toThrow();

      const after = await prisma.cleaningRecord.findUniqueOrThrow({ where: { id: record.id } });
      expect(after.method).toBe('CIP - caustic');

      const rows = await auditRows(record.id);
      expect(rows.every((r) => r.action === 'CREATE')).toBe(true);
    });
  });

  describe('verification', () => {
    it('records the status transition and then refuses further edits', async () => {
      await verifyRecord(record.id, actorFor(user));

      const updates = (await auditRows(record.id)).filter((r) => r.action === 'UPDATE');
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({
        field: 'status',
        oldValue: 'pending',
        newValue: 'verified',
      });

      // A verified record is a signed-off quality document; editing it in place
      // would destroy the meaning of the signature.
      await expect(updateRecord(record.id, { method: 'SIP' }, actorFor(user))).rejects.toThrow(
        /verified/i,
      );
    });
  });
});
