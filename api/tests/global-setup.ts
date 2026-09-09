import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/**
 * Creates the test database if it does not exist yet.
 *
 * Connecting to the maintenance `postgres` database on the same server lets us
 * issue CREATE DATABASE, which cannot run inside a transaction or against the
 * database being created. This is only so `npm test` works straight after
 * `docker compose up -d db`, without a documented manual step.
 */
async function ensureDatabaseExists(url: string): Promise<void> {
  const parsed = new URL(url);
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (!databaseName) throw new Error('TEST_DATABASE_URL has no database name');

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    const existing = await admin.$queryRawUnsafe<unknown[]>(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      databaseName,
    );
    if (existing.length === 0) {
      // The name comes from our own env var, not from user input, and identifiers
      // cannot be parameterised in CREATE DATABASE — quote it defensively anyway.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
      console.log(`[tests] created test database "${databaseName}"`);
    }
  } finally {
    await admin.$disconnect();
  }
}

/**
 * Runs once for the whole suite: ensures the dedicated test database exists and
 * is migrated, so DB-backed specs start from a known schema.
 *
 * If TEST_DATABASE_URL is absent this does nothing and the DB-backed specs skip
 * themselves — the pure unit tests must stay runnable with no Postgres at all.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn(
      '\n[tests] TEST_DATABASE_URL is not set — integration and e2e specs will be SKIPPED.\n' +
        '        Run `docker compose up -d db` and copy api/.env.example to api/.env.\n',
    );
    return;
  }

  try {
    await ensureDatabaseExists(url);
  } catch (error) {
    // Not fatal on its own: the database may already exist while the connecting
    // role simply lacks CREATE DATABASE. Let migrate deploy be the real check.
    console.warn(`[tests] could not verify the test database exists: ${String(error)}`);
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
}
