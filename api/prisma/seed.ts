import bcrypt from 'bcryptjs';
import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/** Matches config.bcryptRounds; the seed runs standalone so it reads env itself. */
const ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;

const USERS = [
  { email: 'alice@example.com', name: 'Alice Chen', role: 'qa' as const, password: 'password123' },
  { email: 'bob@example.com', name: 'Bob Novak', role: 'operator' as const, password: 'password123' },
  { email: 'carol@example.com', name: 'Carol Diaz', role: 'operator' as const, password: 'password123' },
  { email: 'david@example.com', name: 'David Osei', role: 'operator' as const, password: 'password123' },
  { email: 'erin@example.com', name: 'Erin Fischer', role: 'operator' as const, password: 'password123' },
  { email: 'farah@example.com', name: 'Farah Haddad', role: 'qa' as const, password: 'password123' },
  { email: 'george@example.com', name: 'George Miller', role: 'operator' as const, password: 'password123' },
  { email: 'hana@example.com', name: 'Hana Suzuki', role: 'operator' as const, password: 'password123' },
];

const EQUIPMENT = [
  { code: 'BR-101', name: 'Bioreactor 101' },
  { code: 'BR-102', name: 'Bioreactor 102' },
  { code: 'CF-200', name: 'Centrifuge 200' },
  { code: 'TT-310', name: 'Transfer Tank 310' },
  { code: 'FD-410', name: 'Freeze Dryer 410' },
  { code: 'MX-520', name: 'Mixer 520', status: 'retired' as const },
];

const METHODS = ['CIP - caustic', 'CIP - acid rinse', 'Manual wipe (IPA 70%)', 'SIP', 'COP soak'];

async function main(): Promise<void> {
  // The container runs this on every start, and this seed TRUNCATES. Without
  // the guard, restarting the API would silently destroy whatever had been
  // entered since — a genuinely dangerous default. `npm run db:seed` still
  // forces a full refresh, which is what a developer wants locally.
  if (process.env.SEED_MODE === 'if-empty') {
    const existing = await prisma.user.count();
    if (existing > 0) {
      console.log(`Database already has ${existing} users; skipping seed.`);
      return;
    }
  }

  // Idempotent: a re-run should refresh the dataset, not append a second copy.
  await prisma.auditEntry.deleteMany();
  await prisma.cleaningRecord.deleteMany();
  await prisma.equipment.deleteMany();
  await prisma.user.deleteMany();

  const users = await Promise.all(
    USERS.map(async ({ password, ...user }) =>
      prisma.user.create({
        data: { ...user, passwordHash: await bcrypt.hash(password, ROUNDS) },
      }),
    ),
  );
  const qaUser = users.find((u) => u.role === 'qa')!;
  // Anyone can perform a cleaning, including QA staff — the relation is to the
  // person who did the work, not to a role.
  const cleaners = users;

  const equipment = await Promise.all(
    EQUIPMENT.map((item) => prisma.equipment.create({ data: item })),
  );
  const activeEquipment = equipment.filter((e) => e.status === 'active');

  const records: Prisma.CleaningRecordCreateManyInput[] = [];
  const baseDay = Date.UTC(2026, 7, 24); // Mon 24 Aug 2026
  let index = 0;

  for (const item of activeEquipment) {
    for (let day = 0; day < 4; day += 1) {
      for (let slot = 0; slot < 3; slot += 1) {
        // Deliberate timestamp collisions: the 08:00 shift changeover logs several
        // cleanings at exactly the same instant. Seeding everything at a unique
        // now() would hide keyset tie-break bugs in both the demo and the tests.
        const sharesShiftStart = slot === 0;
        const cleanedAt = new Date(
          baseDay + day * 86_400_000 + (sharesShiftStart ? 8 * 3_600_000 : (8 + slot * 5) * 3_600_000),
        );

        records.push({
          equipmentId: item.id,
          cleanedById: cleaners[index % cleaners.length]!.id,
          cleanedAt,
          method: METHODS[index % METHODS.length]!,
          notes: index % 3 === 0 ? null : `Swab test passed, TOC ${(index % 9) / 10 + 0.2} ppm`,
          status: index % 4 === 0 ? 'verified' : 'pending',
        });
        index += 1;
      }
    }
  }

  await prisma.cleaningRecord.createMany({ data: records });

  // Give every seeded record a CREATE change set, so the demo data looks like it
  // was produced by the application rather than injected behind its back.
  const created = await prisma.cleaningRecord.findMany();
  const auditRows: Prisma.AuditEntryCreateManyInput[] = [];

  for (const record of created) {
    const changeSetId = crypto.randomUUID();
    const common = {
      changeSetId,
      entityType: 'CleaningRecord' as const,
      entityId: record.id,
      action: 'CREATE' as const,
      actorId: qaUser.id,
      actorName: qaUser.name,
      changedAt: record.createdAt,
    };
    auditRows.push(
      { ...common, field: 'equipmentId', oldValue: null, newValue: record.equipmentId },
      { ...common, field: 'cleanedById', oldValue: null, newValue: record.cleanedById },
      { ...common, field: 'cleanedAt', oldValue: null, newValue: record.cleanedAt.toISOString() },
      { ...common, field: 'method', oldValue: null, newValue: record.method },
      { ...common, field: 'status', oldValue: null, newValue: record.status },
    );
    if (record.notes !== null) {
      auditRows.push({ ...common, field: 'notes', oldValue: null, newValue: record.notes });
    }
  }

  await prisma.auditEntry.createMany({ data: auditRows });

  console.log(
    `Seeded ${users.length} users, ${equipment.length} equipment, ` +
      `${records.length} cleaning records, ${auditRows.length} audit rows.`,
  );
  console.log('Log in with alice@example.com / password123 (QA) or bob@example.com (operator).');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
