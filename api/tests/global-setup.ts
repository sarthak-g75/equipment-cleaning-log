import 'dotenv/config';
import { execFileSync } from 'node:child_process';

/**
 * Runs once for the whole suite: applies migrations to the dedicated test
 * database so DB-backed specs start from a known schema.
 *
 * If TEST_DATABASE_URL is absent this does nothing and the DB-backed specs skip
 * themselves — the pure unit tests must stay runnable with no Postgres at all.
 */
export default function globalSetup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn(
      '\n[tests] TEST_DATABASE_URL is not set — integration and e2e specs will be SKIPPED.\n' +
        '        Run `docker compose up -d db` and copy api/.env.example to api/.env.\n',
    );
    return;
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
}
