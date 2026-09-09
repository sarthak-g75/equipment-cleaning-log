// dotenv first: TEST_DATABASE_URL lives in api/.env, and the override below has
// to happen before any application module constructs the Prisma singleton.
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
