import { beforeAll } from 'vitest';

/**
 * Point every module that reads DATABASE_URL at the test database *before* any
 * application module is imported, so the singleton Prisma client is constructed
 * against the right connection string.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-chars';

beforeAll(() => {
  // Placeholder for symmetry; per-suite cleanup lives in tests/helpers/db.ts so
  // that pure unit specs never pull in Prisma at all.
});
