import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { config } from '../../src/config';
import { resetRateLimiters, setRateLimitEnabledForTests } from '../../src/middleware/rate-limit';
import { hasDatabase, useCleanDatabase } from '../helpers/db';
import { TEST_PASSWORD, makeUser, tokenFor } from '../helpers/factories';

/**
 * The rate limiters were the one security control the suite skipped entirely:
 * `skip: () => config.isTest` switched them off, so nothing anywhere proved
 * they worked. They stay off for the rest of the suite — otherwise it fails on
 * whichever spec happens to run eleventh — and this file switches them on.
 */
const app = createApp();
const MAX = config.rateLimit.authMax;

describe.skipIf(!hasDatabase)('auth rate limiting (integration)', () => {
  useCleanDatabase();

  beforeAll(() => setRateLimitEnabledForTests(true));
  afterAll(() => setRateLimitEnabledForTests(false));

  // The memory store outlives an individual test and every request here comes
  // from the same loopback address, so without this each spec would start with
  // whatever budget the previous one left behind.
  beforeEach(() => resetRateLimiters());

  const login = (email: string, password: string) =>
    request(app).post('/api/v1/auth/login').send({ email, password });

  /**
   * Without this the login endpoint is an offline-speed password oracle:
   * bcrypt slows a single guess, not a million of them across a botnet.
   */
  it('locks out repeated failed logins with a 429, not another 401', async () => {
    const user = await makeUser();

    for (let attempt = 0; attempt < MAX; attempt += 1) {
      expect((await login(user.email, 'wrong-password')).status).toBe(401);
    }

    const blocked = await login(user.email, 'wrong-password');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    // The 429 travels the same error pipeline as everything else, so the body
    // shape a client parses does not change under load.
    expect(blocked.body.error.message).toMatch(/too many requests/i);
  });

  it('counts attempts against an unknown account too, not just a real one', async () => {
    for (let attempt = 0; attempt < MAX; attempt += 1) {
      expect((await login('nobody@example.com', 'guess')).status).toBe(401);
    }

    expect((await login('nobody@example.com', 'guess')).status).toBe(429);
  });

  /**
   * `skipSuccessfulRequests` is what stops a busy legitimate user locking
   * themselves out by simply working. Worth proving rather than assuming.
   */
  it('does not spend the budget on successful logins', async () => {
    const user = await makeUser();

    for (let attempt = 0; attempt < MAX + 2; attempt += 1) {
      await login(user.email, TEST_PASSWORD).expect(200);
    }
  });

  it('reports the limit in standard draft-7 headers, not the legacy ones', async () => {
    const user = await makeUser();
    const res = await login(user.email, 'wrong-password');

    expect(res.headers['ratelimit-policy']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('leaves the rest of the API reachable when a login is locked out', async () => {
    const user = await makeUser({ role: 'qa' });

    for (let attempt = 0; attempt < MAX + 1; attempt += 1) {
      await login(user.email, 'wrong-password');
    }

    // The auth limiter is scoped to the auth router, so a locked-out login must
    // not take everything else down with it.
    await request(app)
      .get('/api/v1/equipment')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .expect(200);
  });
});
