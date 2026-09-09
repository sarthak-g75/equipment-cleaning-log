import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app';
import { signAccessToken } from '../../src/lib/tokens';
import { createFakeServices } from '../helpers/fake-services';
import type { InMemoryUnitOfWork } from '../helpers/fakes';

/**
 * The whole HTTP stack — middleware, validation, controllers, services — over
 * in-memory repositories, with no Postgres anywhere. Note the absence of a
 * `skipIf(!hasDatabase)`: these run on a laptop with nothing installed.
 *
 * This suite is the concrete payoff of injecting services into `createApp()`
 * rather than importing the container from each controller. Before that, every
 * HTTP-level assertion needed a live database, because reaching the controller
 * meant reaching Prisma.
 */
describe('HTTP stack over in-memory repositories (no database)', () => {
  const EQUIPMENT_ID = '11111111-1111-4111-8111-111111111111';
  const RETIRED_ID = '22222222-2222-4222-8222-222222222222';
  const QA_ID = '33333333-3333-4333-8333-333333333333';
  const OPERATOR_ID = '44444444-4444-4444-8444-444444444444';

  let app: Express;
  let uow: InMemoryUnitOfWork;
  let qaAuth: string;
  let operatorAuth: string;

  beforeEach(() => {
    const fake = createFakeServices();
    uow = fake.uow;
    app = createApp(fake.services);

    uow.seedUser({ id: QA_ID, name: 'Alice Chen', email: 'alice@example.com', role: 'qa' });
    uow.seedUser({
      id: OPERATOR_ID,
      name: 'Bob Novak',
      email: 'bob@example.com',
      role: 'operator',
    });
    uow.seedEquipment({ id: EQUIPMENT_ID, code: 'BR-101', name: 'Bioreactor 101' });
    uow.seedEquipment({ id: RETIRED_ID, code: 'MX-520', name: 'Mixer 520', status: 'retired' });

    qaAuth = `Bearer ${signAccessToken({
      id: QA_ID,
      email: 'alice@example.com',
      name: 'Alice Chen',
      role: 'qa',
    })}`;
    operatorAuth = `Bearer ${signAccessToken({
      id: OPERATOR_ID,
      email: 'bob@example.com',
      name: 'Bob Novak',
      role: 'operator',
    })}`;
  });

  describe('authentication and authorisation', () => {
    it('refuses an unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/equipment');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('refuses a token signed with the wrong key', async () => {
      const res = await request(app)
        .get('/api/v1/equipment')
        .set('Authorization', 'Bearer not.a.token');

      expect(res.status).toBe(401);
    });

    it('lets an operator read equipment but not change it', async () => {
      await request(app).get('/api/v1/equipment').set('Authorization', operatorAuth).expect(200);

      await request(app)
        .post('/api/v1/equipment')
        .set('Authorization', operatorAuth)
        .send({ name: 'Sneaky', code: 'SN-001' })
        .expect(403);
    });

    it('forbids an operator from verifying a record', async () => {
      const created = await request(app)
        .post(`/api/v1/equipment/${EQUIPMENT_ID}/cleaning-records`)
        .set('Authorization', operatorAuth)
        .send({
          cleanedById: OPERATOR_ID,
          cleanedAt: '2026-08-24T08:00:00.000Z',
          method: 'CIP - caustic',
        })
        .expect(201);

      await request(app)
        .post(`/api/v1/cleaning-records/${created.body.data.id}/verify`)
        .set('Authorization', operatorAuth)
        .expect(403);

      await request(app)
        .post(`/api/v1/cleaning-records/${created.body.data.id}/verify`)
        .set('Authorization', qaAuth)
        .expect(200);
    });
  });

  describe('validation at the HTTP boundary', () => {
    it('rejects an empty equipment patch rather than defaulting status', async () => {
      const res = await request(app)
        .patch(`/api/v1/equipment/${RETIRED_ID}`)
        .set('Authorization', qaAuth)
        .send({});

      expect(res.status).toBe(400);
      expect(uow.allEquipment().find((e) => e.id === RETIRED_ID)?.status).toBe('retired');
    });

    it('leaves status untouched when only the name is patched', async () => {
      await request(app)
        .patch(`/api/v1/equipment/${RETIRED_ID}`)
        .set('Authorization', qaAuth)
        .send({ name: 'Renamed' })
        .expect(200);

      expect(uow.allEquipment().find((e) => e.id === RETIRED_ID)?.status).toBe('retired');
    });

    it('refuses a cleaning dated in the future', async () => {
      const res = await request(app)
        .post(`/api/v1/equipment/${EQUIPMENT_ID}/cleaning-records`)
        .set('Authorization', operatorAuth)
        .send({
          cleanedById: OPERATOR_ID,
          cleanedAt: new Date(Date.now() + 86_400_000).toISOString(),
          method: 'CIP - caustic',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('body.cleanedAt');
    });

    it('refuses to log against retired equipment', async () => {
      const res = await request(app)
        .post(`/api/v1/equipment/${RETIRED_ID}/cleaning-records`)
        .set('Authorization', operatorAuth)
        .send({
          cleanedById: OPERATOR_ID,
          cleanedAt: '2026-08-24T08:00:00.000Z',
          method: 'CIP - caustic',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EQUIPMENT_RETIRED');
    });

    it('returns 404 for unknown equipment rather than an empty page', async () => {
      const res = await request(app)
        .get(`/api/v1/equipment/${randomUUID()}/cleaning-records`)
        .set('Authorization', operatorAuth);

      expect(res.status).toBe(404);
    });

    it('reports a route that does not exist as a route error', async () => {
      const res = await request(app).get('/api/v1/nope').set('Authorization', qaAuth);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    });
  });

  describe('attribution', () => {
    it('audits against the token holder, never the request body', async () => {
      const created = await request(app)
        .post(`/api/v1/equipment/${EQUIPMENT_ID}/cleaning-records`)
        .set('Authorization', operatorAuth)
        .send({
          cleanedById: QA_ID,
          cleanedAt: '2026-08-24T08:00:00.000Z',
          method: 'CIP - caustic',
          // A forged actor. It is not part of the schema, so it is stripped —
          // and the trail is attributed to whoever held the token.
          actorId: QA_ID,
          actorName: 'Someone Else',
        })
        .expect(201);

      const rows = uow.auditFor(created.body.data.id);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.actorId === OPERATOR_ID && r.actorName === 'Bob Novak')).toBe(true);

      // `cleanedById` is a real field, so the QA user really is the cleaner —
      // that is distinct from who was authenticated.
      expect(created.body.data.cleanedById).toBe(QA_ID);
    });

    it('echoes a safe correlation id and rejects a hostile one', async () => {
      const clean = await request(app)
        .get('/api/v1/equipment')
        .set('Authorization', qaAuth)
        .set('x-request-id', 'req-abc.123_XYZ');
      expect(clean.headers['x-request-id']).toBe('req-abc.123_XYZ');

      const hostile = await request(app)
        .get('/api/v1/equipment')
        .set('Authorization', qaAuth)
        .set('x-request-id', 'bad id with spaces');
      // Replaced with a generated uuid rather than reflected into the logs.
      expect(hostile.headers['x-request-id']).not.toBe('bad id with spaces');
      expect(hostile.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('the people picker source', () => {
    it('filters by name or email, case-insensitively', async () => {
      const byEmail = await request(app)
        .get('/api/v1/users?q=BOB@example')
        .set('Authorization', operatorAuth)
        .expect(200);
      expect(byEmail.body.data.map((u: { id: string }) => u.id)).toEqual([OPERATOR_ID]);

      const byName = await request(app)
        .get('/api/v1/users?q=alice')
        .set('Authorization', operatorAuth)
        .expect(200);
      expect(byName.body.data.map((u: { id: string }) => u.id)).toEqual([QA_ID]);
    });

    it('honours the limit, so the directory endpoint is never unbounded', async () => {
      const res = await request(app)
        .get('/api/v1/users?limit=1')
        .set('Authorization', operatorAuth)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
    });

    it('rejects a limit above the cap', async () => {
      await request(app)
        .get('/api/v1/users?limit=5000')
        .set('Authorization', operatorAuth)
        .expect(400);
    });
  });
});
