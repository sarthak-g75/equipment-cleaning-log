import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { createInMemoryUnitOfWork, type InMemoryUnitOfWork } from '../../../tests/helpers/fakes';
import { createCleaningRecordService, type CleaningRecordService } from './cleaning-record.service';

/**
 * The whole service, exercised with no database and no HTTP.
 *
 * This is the return on inverting the dependency: the business rules below are
 * verified in milliseconds against in-memory fakes, so the integration suite is
 * free to concentrate on what only a real Postgres can prove — the keyset
 * query, the row lock and transactional rollback.
 */
describe('CleaningRecordService (unit, in-memory)', () => {
  let uow: InMemoryUnitOfWork;
  let service: CleaningRecordService;

  const actor = { id: 'actor-1', name: 'Alice Chen' };
  const cleanedAt = new Date('2026-08-24T08:00:00.000Z');

  const input = {
    cleanedById: 'user-1',
    cleanedAt,
    method: 'CIP - caustic',
    notes: 'Swab passed',
  };

  beforeEach(() => {
    uow = createInMemoryUnitOfWork();
    uow.seedEquipment({ id: 'eq-1', name: 'Bioreactor 101', code: 'BR-101', status: 'active' });
    uow.seedEquipment({ id: 'eq-retired', name: 'Mixer 520', code: 'MX-520', status: 'retired' });
    uow.seedUser({ id: 'user-1', name: 'Bob Novak' });
    uow.seedUser({ id: 'user-2', name: 'Hana Suzuki' });
    service = createCleaningRecordService(uow);
  });

  describe('create', () => {
    it('writes a CREATE change set covering every supplied field', async () => {
      const created = await service.create('eq-1', input, actor);

      const entries = uow.auditFor(created.id);
      expect(entries.map((e) => e.field).sort()).toEqual([
        'cleanedAt',
        'cleanedById',
        'equipmentId',
        'method',
        'notes',
        'status',
      ]);
      expect(entries.every((e) => e.action === 'CREATE' && e.oldValue === null)).toBe(true);
      expect(entries.every((e) => e.actorId === actor.id)).toBe(true);
    });

    it('refuses unknown equipment', async () => {
      await expect(service.create('nope', input, actor)).rejects.toThrow(NotFoundError);
    });

    it('refuses retired equipment', async () => {
      await expect(service.create('eq-retired', input, actor)).rejects.toThrow(ConflictError);
    });

    it('leaves nothing behind when the guard rejects', async () => {
      await expect(service.create('eq-retired', input, actor)).rejects.toThrow();

      expect(uow.allRecords()).toHaveLength(0);
      expect(uow.allAudit()).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('records only the fields that actually changed', async () => {
      const created = await service.create('eq-1', input, actor);
      uow.clearAudit();

      await service.update(created.id, { method: 'SIP', notes: 'Swab passed' }, actor);

      // `notes` was resubmitted unchanged, so it is not a change.
      const entries = uow.auditFor(created.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        field: 'method',
        oldValue: 'CIP - caustic',
        newValue: 'SIP',
      });
    });

    it('writes no audit entry for a no-op patch', async () => {
      const created = await service.create('eq-1', input, actor);
      uow.clearAudit();

      await service.update(created.id, { method: 'CIP - caustic' }, actor);

      expect(uow.auditFor(created.id)).toHaveLength(0);
    });

    it('records clearing a field as an explicit change to null', async () => {
      const created = await service.create('eq-1', input, actor);
      uow.clearAudit();

      await service.update(created.id, { notes: null }, actor);

      expect(uow.auditFor(created.id)[0]).toMatchObject({
        field: 'notes',
        oldValue: 'Swab passed',
        newValue: null,
      });
    });

    it('takes a row lock before reading the record it is about to diff', async () => {
      const created = await service.create('eq-1', input, actor);

      await service.update(created.id, { method: 'SIP' }, actor);

      // Without the lock, a concurrent writer reads the same predecessor and
      // the trail records a forked lineage. Asserting the ordering here is what
      // stops the lock being dropped in a later refactor.
      expect(uow.calls).toContain(`lockForUpdate:${created.id}`);
      expect(uow.calls.indexOf(`lockForUpdate:${created.id}`)).toBeLessThan(
        uow.calls.lastIndexOf(`findById:${created.id}`),
      );
    });

    it('refuses to edit a verified record', async () => {
      const created = await service.create('eq-1', input, actor);
      await service.verify(created.id, actor);

      await expect(service.update(created.id, { method: 'SIP' }, actor)).rejects.toThrow(
        ConflictError,
      );
    });

    it('refuses an unknown record', async () => {
      await expect(service.update('nope', { method: 'SIP' }, actor)).rejects.toThrow(NotFoundError);
    });
  });

  describe('verify', () => {
    it('records the status transition attributed to the verifying user', async () => {
      const created = await service.create('eq-1', input, actor);
      uow.clearAudit();

      const qa = { id: 'actor-2', name: 'Farah Haddad' };
      const verified = await service.verify(created.id, qa);

      expect(verified.status).toBe('verified');
      expect(uow.auditFor(created.id)).toEqual([
        expect.objectContaining({
          field: 'status',
          oldValue: 'pending',
          newValue: 'verified',
          actorId: qa.id,
          actorName: 'Farah Haddad',
        }),
      ]);
    });

    it('refuses to verify twice', async () => {
      const created = await service.create('eq-1', input, actor);
      await service.verify(created.id, actor);

      await expect(service.verify(created.id, actor)).rejects.toThrow(ConflictError);
    });
  });

  describe('list', () => {
    it('refuses unknown equipment rather than returning an empty page', async () => {
      // An empty page would be indistinguishable from "never cleaned".
      await expect(service.list('nope', { limit: 20 })).rejects.toThrow(NotFoundError);
    });

    it('returns the records for the requested equipment', async () => {
      await service.create('eq-1', input, actor);
      await service.create('eq-1', { ...input, method: 'SIP' }, actor);

      const page = await service.list('eq-1', { limit: 20 });

      expect(page.data).toHaveLength(2);
      expect(page.meta.hasMore).toBe(false);
    });
  });
});
