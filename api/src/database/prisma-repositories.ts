import { randomUUID } from 'node:crypto';
import type { AuditEntity, Prisma, PrismaClient } from '@prisma/client';
import {
  KEYSET_ORDER_BY,
  decodeCursor,
  keysetWhere,
  toPage,
} from '../lib/pagination';
import type {
  AuditRepository,
  CleaningRecordRepository,
  CreateEquipmentData,
  CreateRecordData,
  EquipmentRepository,
  ListRecordsParams,
  ListUsersParams,
  RecordChangesInput,
  Repositories,
  UnitOfWork,
  UpdateEquipmentData,
  UpdateRecordData,
  UserRepository,
} from '../shared/ports';

/**
 * Everything Prisma-specific lives in this file.
 *
 * `DbClient` covers both the root client and a transaction client, which is
 * what lets one repository implementation serve both the plain and the
 * transactional case without duplication.
 */
type DbClient = PrismaClient | Prisma.TransactionClient;

/** Selected explicitly so a password hash cannot escape by construction. */
const cleanerSelect = {
  cleanedBy: { select: { id: true, name: true, email: true, role: true } },
} as const satisfies Prisma.CleaningRecordInclude;

const userSummarySelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const satisfies Prisma.UserSelect;

class PrismaCleaningRecordRepository implements CleaningRecordRepository {
  constructor(private readonly db: DbClient) {}

  async listByEquipment(params: ListRecordsParams) {
    const cursor = params.cursor ? decodeCursor(params.cursor) : undefined;

    const rows = await this.db.cleaningRecord.findMany({
      where: {
        equipmentId: params.equipmentId,
        ...(params.status ? { status: params.status } : {}),
        // Sibling keys are ANDed, so the keyset predicate composes with the
        // status filter with no special casing.
        ...keysetWhere(cursor),
      },
      // Must stay in lockstep with the comparison in keysetWhere().
      orderBy: [...KEYSET_ORDER_BY],
      take: params.limit + 1,
      include: cleanerSelect,
    });

    return toPage(rows, params.limit);
  }

  findById(id: string) {
    return this.db.cleaningRecord.findUnique({ where: { id }, include: cleanerSelect });
  }

  countByEquipment(equipmentId: string) {
    return this.db.cleaningRecord.count({ where: { equipmentId } });
  }

  create(data: CreateRecordData) {
    return this.db.cleaningRecord.create({
      data: { ...data, notes: data.notes ?? null },
      include: cleanerSelect,
    });
  }

  update(id: string, data: UpdateRecordData) {
    return this.db.cleaningRecord.update({ where: { id }, data, include: cleanerSelect });
  }

  async lockForUpdate(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM "CleaningRecord" WHERE id = ${id}::uuid FOR UPDATE`;
  }
}

class PrismaEquipmentRepository implements EquipmentRepository {
  constructor(private readonly db: DbClient) {}

  list(status?: CreateEquipmentData['status']) {
    return this.db.equipment.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
    });
  }

  findById(id: string) {
    return this.db.equipment.findUnique({ where: { id } });
  }

  create(data: CreateEquipmentData) {
    return this.db.equipment.create({ data });
  }

  update(id: string, data: UpdateEquipmentData) {
    return this.db.equipment.update({ where: { id }, data });
  }

  async deleteById(id: string) {
    const { count } = await this.db.equipment.deleteMany({ where: { id } });
    return count;
  }

  async lockForUpdate(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM "Equipment" WHERE id = ${id}::uuid FOR UPDATE`;
  }
}

class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: DbClient) {}

  list(params: ListUsersParams) {
    const search = params.q;
    return this.db.user.findMany({
      where: {
        ...(params.role ? { role: params.role } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: userSummarySelect,
      orderBy: { name: 'asc' },
      // A hard cap: the picker filters server-side, so it never needs the whole
      // table, and an unbounded directory endpoint is a latent scaling problem.
      take: 50,
    });
  }

  findByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }

  findManyByIds(ids: readonly string[]) {
    return this.db.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
  }
}

class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * One row per changed field, all sharing a `changeSetId` and a single
   * `changedAt` so they regroup into exactly one displayable event and order
   * deterministically.
   */
  async record(input: RecordChangesInput): Promise<void> {
    if (input.changes.length === 0) return;

    const changeSetId = randomUUID();
    const changedAt = new Date();

    await this.db.auditEntry.createMany({
      data: input.changes.map((change) => ({
        changeSetId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        actorId: input.actor.id,
        actorName: input.actor.name,
        changedAt,
      })),
    });
  }

  findByEntity(entityType: AuditEntity, entityId: string, limit: number) {
    return this.db.auditEntry.findMany({
      where: { entityType, entityId },
      // Newest change set first; `field` ascending keeps lines within one set in
      // a stable order rather than whatever the planner returns.
      orderBy: [{ changedAt: 'desc' }, { changeSetId: 'desc' }, { field: 'asc' }],
      take: limit,
    });
  }
}

function buildRepositories(db: DbClient): Repositories {
  return {
    cleaningRecords: new PrismaCleaningRecordRepository(db),
    equipment: new PrismaEquipmentRepository(db),
    users: new PrismaUserRepository(db),
    audit: new PrismaAuditRepository(db),
  };
}

export class PrismaUnitOfWork implements UnitOfWork {
  readonly repos: Repositories;

  constructor(private readonly client: PrismaClient) {
    this.repos = buildRepositories(client);
  }

  /**
   * The repositories handed to `work` are bound to the transaction, so it is
   * structurally impossible to perform half an operation outside it — which is
   * the property the audit trail depends on.
   */
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.client.$transaction((tx) => work(buildRepositories(tx)));
  }
}
