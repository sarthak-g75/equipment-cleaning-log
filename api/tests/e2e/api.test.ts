import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Equipment, User } from '@prisma/client';
import { createApp } from '../../src/app';
import { hasDatabase, useCleanDatabase } from '../helpers/db';
import { TEST_PASSWORD, makeEquipment, makeUser, tokenFor } from '../helpers/factories';

const app = createApp();

describe.skipIf(!hasDatabase)('API (e2e)', () => {
  useCleanDatabase();

  let qa: User;
  let operator: User;
  let equipment: Equipment;
  let qaToken: string;
  let operatorToken: string;

  const newRecord = {
    cleanedBy: 'B. Novak',
    cleanedAt: '2026-08-24T08:00:00.000Z',
    method: 'CIP - caustic',
    notes: 'Swab passed',
  };

  beforeEach(async () => {
    qa = await makeUser({ name: 'Alice Chen', role: 'qa' });
    operator = await makeUser({ name: 'Bob Novak', role: 'operator' });
    equipment = await makeEquipment();
    qaToken = tokenFor(qa);
    operatorToken = tokenFor(operator);
  });

  const createRecord = () =>
    request(app)
      .post(`/api/v1/equipment/${equipment.id}/cleaning-records`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send(newRecord);

  describe('authentication', () => {
    it('issues a token for correct credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: qa.email, password: TEST_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toEqual(expect.any(String));
      expect(res.body.data.user).toMatchObject({ email: qa.email, role: 'qa' });
      expect(res.body.data.user).not.toHaveProperty('passwordHash');
    });

    it('rejects a wrong password without leaking whether the account exists', async () => {
      const wrongPassword = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: qa.email, password: 'nope' });
      const noSuchUser = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'nope' });

      expect(wrongPassword.status).toBe(401);
      expect(noSuchUser.status).toBe(401);
      expect(wrongPassword.body.error.message).toBe(noSuchUser.body.error.message);
      expect(wrongPassword.body.data).toBeUndefined();
    });

    it('refuses an unauthenticated request to a protected route', async () => {
      const res = await request(app).get(`/api/v1/equipment/${equipment.id}/cleaning-records`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('authorisation', () => {
    it('lets QA verify a record but forbids an operator from self-verifying', async () => {
      const created = await createRecord();
      const id = created.body.data.id;

      const asOperator = await request(app)
        .post(`/api/v1/cleaning-records/${id}/verify`)
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(asOperator.status).toBe(403);
      expect(asOperator.body.error.code).toBe('FORBIDDEN');

      const asQa = await request(app)
        .post(`/api/v1/cleaning-records/${id}/verify`)
        .set('Authorization', `Bearer ${qaToken}`);
      expect(asQa.status).toBe(200);
      expect(asQa.body.data.status).toBe('verified');
    });
  });

  describe('cleaning record lifecycle and its audit trail', () => {
    it('attributes the audit entry to the token holder, never to the request body', async () => {
      const created = await request(app)
        .post(`/api/v1/equipment/${equipment.id}/cleaning-records`)
        .set('Authorization', `Bearer ${operatorToken}`)
        // A caller trying to forge attribution. The validator whitelists fields
        // so this is stripped, and the actor comes from the verified token.
        .send({ ...newRecord, actorId: qa.id, actorName: 'Someone Else' });

      expect(created.status).toBe(201);

      const audit = await request(app)
        .get(`/api/v1/cleaning-records/${created.body.data.id}/audit`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(audit.body.data[0].actor).toEqual({ id: operator.id, name: 'Bob Novak' });
    });

    it('records create, edit and verify as three distinct change sets', async () => {
      const created = await createRecord();
      const id = created.body.data.id;

      await request(app)
        .patch(`/api/v1/cleaning-records/${id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ method: 'SIP', notes: 'Re-cleaned after deviation' })
        .expect(200);

      // A second, identical PATCH must add nothing to the trail.
      await request(app)
        .patch(`/api/v1/cleaning-records/${id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ method: 'SIP', notes: 'Re-cleaned after deviation' })
        .expect(200);

      await request(app)
        .post(`/api/v1/cleaning-records/${id}/verify`)
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(200);

      const audit = await request(app)
        .get(`/api/v1/cleaning-records/${id}/audit`)
        .set('Authorization', `Bearer ${qaToken}`);

      expect(audit.status).toBe(200);
      expect(audit.body.data).toHaveLength(3);

      // Newest first.
      const [verify, edit, create] = audit.body.data;
      expect(verify.changes).toEqual([
        { field: 'status', oldValue: 'pending', newValue: 'verified' },
      ]);
      expect(edit.changes).toEqual([
        { field: 'method', oldValue: 'CIP - caustic', newValue: 'SIP' },
        { field: 'notes', oldValue: 'Swab passed', newValue: 'Re-cleaned after deviation' },
      ]);
      expect(create.action).toBe('CREATE');
      expect(create.changes.every((c: { oldValue: string | null }) => c.oldValue === null)).toBe(
        true,
      );
    });

    it('refuses to log a record against retired equipment', async () => {
      const retired = await makeEquipment({ status: 'retired' });

      const res = await request(app)
        .post(`/api/v1/equipment/${retired.id}/cleaning-records`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(newRecord);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EQUIPMENT_RETIRED');
    });
  });

  describe('validation and error responses', () => {
    it('returns field-level details for an invalid body', async () => {
      const res = await request(app)
        .post(`/api/v1/equipment/${equipment.id}/cleaning-records`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ ...newRecord, cleanedAt: 'yesterday', method: '' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(
        expect.arrayContaining(['body.cleanedAt', 'body.method']),
      );
    });

    it('rejects a malformed cursor and an oversized limit as client errors', async () => {
      const base = `/api/v1/equipment/${equipment.id}/cleaning-records`;

      const badCursor = await request(app)
        .get(`${base}?cursor=not-a-cursor`)
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(badCursor.status).toBe(400);
      expect(badCursor.body.error.code).toBe('INVALID_CURSOR');

      const badLimit = await request(app)
        .get(`${base}?limit=1000`)
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(badLimit.status).toBe(400);
      expect(badLimit.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 for an unknown equipment rather than an empty page', async () => {
      const res = await request(app)
        .get(`/api/v1/equipment/${randomUUID()}/cleaning-records`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('equipment', () => {
    it('refuses to delete equipment that has cleaning records', async () => {
      await createRecord();

      const res = await request(app)
        .delete(`/api/v1/equipment/${equipment.id}`)
        .set('Authorization', `Bearer ${qaToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EQUIPMENT_IN_USE');
    });

    it('deletes unused equipment', async () => {
      const unused = await makeEquipment();

      await request(app)
        .delete(`/api/v1/equipment/${unused.id}`)
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(204);

      await request(app)
        .get(`/api/v1/equipment/${unused.id}`)
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(404);
    });

    it('rejects a duplicate equipment code with a conflict, not a 500', async () => {
      const res = await request(app)
        .post('/api/v1/equipment')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({ name: 'Duplicate', code: equipment.code });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_VALUE');
    });
  });
});
