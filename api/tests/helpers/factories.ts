import bcrypt from 'bcryptjs';
import type { CleaningRecord, Equipment, Role, User } from '@prisma/client';
import { prisma } from '../../src/database/prisma';
import { signAccessToken } from '../../src/middleware/auth';
import type { Actor } from '../../src/lib/audit';

let counter = 0;
const next = () => (counter += 1);

export const TEST_PASSWORD = 'password123';

export async function makeUser(overrides: Partial<Pick<User, 'name' | 'role'>> = {}): Promise<User> {
  const n = next();
  return prisma.user.create({
    data: {
      email: `user${n}@example.com`,
      name: overrides.name ?? `User ${n}`,
      role: (overrides.role ?? 'operator') as Role,
      // Cost 4 in tests: at the production cost of 12 the login specs alone would
      // dominate the suite runtime hashing a constant we are not testing.
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
    },
  });
}

export function tokenFor(user: User): string {
  return signAccessToken({ id: user.id, email: user.email, name: user.name, role: user.role });
}

export function actorFor(user: User): Actor {
  return { id: user.id, name: user.name };
}

export function makeEquipment(overrides: Partial<Equipment> = {}): Promise<Equipment> {
  const n = next();
  return prisma.equipment.create({
    data: {
      name: overrides.name ?? `Bioreactor ${n}`,
      code: overrides.code ?? `EQ-${String(n).padStart(4, '0')}`,
      status: overrides.status ?? 'active',
    },
  });
}

/**
 * Creates records directly (bypassing the service) so a pagination fixture can
 * control `cleanedAt` exactly — including deliberate ties.
 */
export function makeRecords(
  equipmentId: string,
  cleanedById: string,
  rows: ReadonlyArray<Partial<CleaningRecord> & { cleanedAt: Date }>,
): Promise<{ count: number }> {
  return prisma.cleaningRecord.createMany({
    data: rows.map((row) => ({
      equipmentId,
      cleanedById: row.cleanedById ?? cleanedById,
      cleanedAt: row.cleanedAt,
      method: row.method ?? 'CIP - caustic',
      notes: row.notes ?? null,
      status: row.status ?? 'pending',
    })),
  });
}
