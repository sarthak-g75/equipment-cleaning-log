import { execFileSync } from 'node:child_process';

/**
 * Runs once for the whole suite. Applies migrations to the dedicated test
 * database so integration/e2e specs start from a known schema.
 *
 * If TEST_DATABASE_URL is absent we do nothing and let the DB-backed specs skip
 * themselves (see `requireDatabase` in setup.ts) — the pure unit tests must stay
 * runnable on a machine with no Postgres.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn(
      '\n[tests] TEST_DATABASE_URL is not set — integration and e2e specs will be SKIPPED.\n' +
        '        Start Postgres (docker compose up -d db) and copy api/.env.example to api/.env.\n',
    );
    return;
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}
