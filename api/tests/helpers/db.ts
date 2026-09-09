import { beforeEach } from 'vitest';
import { prisma } from '../../src/database/prisma';

export const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);

/**
 * Truncate between tests rather than wrapping each test in a transaction that
 * gets rolled back. The service layer opens its own interactive transaction, and
 * nesting a test transaction around it fights that — savepoint semantics make
 * "did the audit write roll back?" untestable, which is precisely the behaviour
 * we most need to prove.
 */
export function useCleanDatabase(): void {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "AuditEntry", "CleaningRecord", "Equipment", "User" RESTART IDENTITY CASCADE',
    );
  });
}
