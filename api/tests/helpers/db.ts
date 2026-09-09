import { beforeEach } from 'vitest';
import { prisma } from '../../src/database/prisma';

export const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);

/**
 * Truncate between tests rather than wrapping each test in a transaction that is
 * rolled back afterwards.
 *
 * The service layer opens its own interactive transaction; nesting a test
 * transaction around it turns those into savepoints, which makes "does the
 * record update roll back when the audit write fails?" untestable — and that is
 * precisely the behaviour most worth proving here.
 */
export function useCleanDatabase(): void {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "AuditEntry", "CleaningRecord", "Equipment", "User" RESTART IDENTITY CASCADE',
    );
  });
}
