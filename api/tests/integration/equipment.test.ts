import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Equipment, User } from '@prisma/client';
import { createApp } from '../../src/app';
import { prisma } from '../../src/database/prisma';
import { hasDatabase, useCleanDatabase } from '../helpers/db';
import { makeEquipment, makeUser, tokenFor } from '../helpers/factories';

const app = createApp();

describe.skipIf(!hasDatabase)('equipment (integration)', () => {
  useCleanDatabase();

  let qa: User;
  let operator: User;
  let retired: Equipment;
  let qaAuth: string;
  let operatorAuth: string;

  beforeEach(async () => {
    qa = await makeUser({ name: 'Alice Chen', role: 'qa' });
    operator = await makeUser({ name: 'Bob Novak', role: 'operator' });
    qaAuth = `Bearer ${tokenFor(qa)}`;
    operatorAuth = `Bearer ${tokenFor(operator)}`;
    retired = await makeEquipment({ name: 'Old Mixer', status: 'retired' });
  });

  /**
   * The bug these cover: the update body was derived with
   * `createEquipmentBodySchema.partial()`, and `.partial()` does not strip the
   * inner `.default('active')`. So `{}` parsed to `{ status: 'active' }`, which
   * (a) made the "at least one field" guard unreachable and (b) turned every
   * PATCH that merely omitted `status` into a silent status write. Renaming a
   * retired asset re-activated it — and the audit trail dutifully recorded a
   * status change nobody had asked for.
   */
  describe('PATCH must never write a field the caller did not send', () => {
    it('rejects an empty body instead of defaulting status', async () => {
      const res = await request(app)
        .patch(`/api/v1/equipment/${retired.id}`)
        .set('Authorization', qaAuth)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const after = await prisma.equipment.findUniqueOrThrow({ where: { id: retired.id } });
      expect(after.status).toBe('retired');
    });

    it('leaves status alone when only the name is patched', async () => {
      const res = await request(app)
        .patch(`/api/v1/equipment/${retired.id}`)
        .set('Authorization', qaAuth)
        .send({ name: 'Renamed Mixer' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ name: 'Renamed Mixer', status: 'retired' });
    });

    it('writes no status row into the audit trail for a name-only patch', async () => {
      await request(app)
        .patch(`/api/v1/equipment/${retired.id}`)
        .set('Authorization', qaAuth)
        .send({ name: 'Renamed Mixer' })
        .expect(200);

      const fields = await prisma.auditEntry.findMany({
        where: { entityId: retired.id },
        select: { field: true },
      });

      expect(fields.map((f) => f.field)).toEqual(['name']);
    });

    it('still writes status when the caller actually sends it', async () => {
      await request(app)
        .patch(`/api/v1/equipment/${retired.id}`)
        .set('Authorization', qaAuth)
        .send({ status: 'active' })
        .expect(200);

      const after = await prisma.equipment.findUniqueOrThrow({ where: { id: retired.id } });
      expect(after.status).toBe('active');
    });
  });

  describe('code normalisation', () => {
    it('accepts a lowercase code and stores it uppercase', async () => {
      const res = await request(app)
        .post('/api/v1/equipment')
        .set('Authorization', qaAuth)
        .send({ name: 'Bioreactor 900', code: 'br-900' });

      expect(res.status).toBe(201);
      expect(res.body.data.code).toBe('BR-900');
    });

    it('still rejects a code with illegal characters', async () => {
      const res = await request(app)
        .post('/api/v1/equipment')
        .set('Authorization', qaAuth)
        .send({ name: 'Bad', code: 'BR 900!' });

      expect(res.status).toBe(400);
    });
  });

  /**
   * Managing the asset register decides what the whole plant is allowed to log
   * against, so it is a QA action. Reading it is not — an operator has to pick
   * equipment to log a cleaning against.
   */
  describe('only QA may change the asset register', () => {
    it('lets an operator read equipment', async () => {
      await request(app).get('/api/v1/equipment').set('Authorization', operatorAuth).expect(200);
      await request(app)
        .get(`/api/v1/equipment/${retired.id}`)
        .set('Authorization', operatorAuth)
        .expect(200);
    });

    it('forbids an operator from creating, patching or deleting it', async () => {
      const create = await request(app)
        .post('/api/v1/equipment')
        .set('Authorization', operatorAuth)
        .send({ name: 'Sneaky', code: 'SN-001' });
      expect(create.status).toBe(403);
      expect(create.body.error.code).toBe('FORBIDDEN');

      await request(app)
        .patch(`/api/v1/equipment/${retired.id}`)
        .set('Authorization', operatorAuth)
        .send({ status: 'active' })
        .expect(403);

      await request(app)
        .delete(`/api/v1/equipment/${retired.id}`)
        .set('Authorization', operatorAuth)
        .expect(403);

      // And nothing leaked through the refusal.
      const after = await prisma.equipment.findUniqueOrThrow({ where: { id: retired.id } });
      expect(after.status).toBe('retired');
    });
  });

  /**
   * A destructive operation that leaves no trace is the one gap a system built
   * around an audit trail cannot have: the asset used to just vanish, with no
   * actor and no timestamp.
   */
  describe('deletion is audited', () => {
    it('records a DELETE change set attributed to the acting user', async () => {
      const unused = await makeEquipment({ name: 'Spare Pump', code: 'SP-777' });

      await request(app)
        .delete(`/api/v1/equipment/${unused.id}`)
        .set('Authorization', qaAuth)
        .expect(204);

      const rows = await prisma.auditEntry.findMany({
        where: { entityId: unused.id, action: 'DELETE' },
        orderBy: { field: 'asc' },
      });

      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.field)).toEqual(['code', 'name', 'status']);
      // Every tracked field moves to null — that is what a deletion is.
      expect(rows.every((r) => r.newValue === null)).toBe(true);
      expect(rows.find((r) => r.field === 'name')?.oldValue).toBe('Spare Pump');
      expect(rows.every((r) => r.actorId === qa.id && r.actorName === 'Alice Chen')).toBe(true);

      // The row really is gone; the trail is what survives it.
      expect(await prisma.equipment.findUnique({ where: { id: unused.id } })).toBeNull();
    });

    it('leaves neither the row nor an audit entry behind when it refuses', async () => {
      const inUse = await makeEquipment();
      await request(app)
        .post(`/api/v1/equipment/${inUse.id}/cleaning-records`)
        .set('Authorization', operatorAuth)
        .send({
          cleanedById: operator.id,
          cleanedAt: '2026-08-24T08:00:00.000Z',
          method: 'CIP - caustic',
        })
        .expect(201);

      const res = await request(app)
        .delete(`/api/v1/equipment/${inUse.id}`)
        .set('Authorization', qaAuth);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EQUIPMENT_IN_USE');

      expect(await prisma.equipment.findUnique({ where: { id: inUse.id } })).not.toBeNull();
      expect(
        await prisma.auditEntry.count({ where: { entityId: inUse.id, action: 'DELETE' } }),
      ).toBe(0);
    });

    it('returns 404 rather than an empty DELETE change set for an unknown id', async () => {
      const res = await request(app)
        .delete('/api/v1/equipment/00000000-0000-4000-8000-000000000000')
        .set('Authorization', qaAuth);

      expect(res.status).toBe(404);
      expect(await prisma.auditEntry.count({ where: { action: 'DELETE' } })).toBe(0);
    });
  });
});
