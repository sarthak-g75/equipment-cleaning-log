import { randomUUID } from 'node:crypto';
import type { AuditEntity, Prisma, PrismaClient } from '@prisma/client';
import { recordListScope, recordPaginator } from '../lib/pagination';
import type {
  AuditRepository,
  AuditRowPage,
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
    const scope = recordListScope(params);
    const cursor = params.cursor ? recordPaginator.decode(params.cursor, scope) : undefined;

    const rows = await this.db.cleaningRecord.findMany({
      where: {
        equipmentId: params.equipmentId,
        ...(params.status ? { status: params.status } : {}),
        // Sibling keys are ANDed, so the keyset predicate composes with the
        // status filter with no special casing.
        ...recordPaginator.where(cursor),
      },
      // From the same paginator as the predicate above, so the two cannot drift.
      orderBy: [...recordPaginator.orderBy],
      take: params.limit + 1,
      include: cleanerSelect,
    });

    return recordPaginator.toPage(rows, params.limit, scope);
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

  findManyByIds(ids: readonly string[]) {
    return this.db.equipment.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true, code: true },
    });
  }

  create(data: CreateEquipmentData) {
    return this.db.equipment.create({ data });
  }

  update(id: string, data: UpdateEquipmentData) {
    return this.db.equipment.update({ where: { id }, data });
  }

  /**
   * Returns the row as it stood before deletion, because the caller has to
   * audit what was destroyed and those values are unrecoverable afterwards.
   * Null means there was nothing to delete, which the caller turns into a 404.
   */
  async deleteById(id: string) {
    const existing = await this.db.equipment.findUnique({ where: { id } });
    if (!existing) return null;
    await this.db.equipment.delete({ where: { id } });
    return existing;
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
      // A hard cap. The picker now sends its query to the server as the user
      // types, so it never needs the whole table, and an unbounded directory
      // endpoint is a latent scaling problem.
      take: params.limit,
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

  /**
   * Two queries, deliberately.
   *
   * The first picks the newest `limit` CHANGE SETS; the second fetches every
   * row belonging to them. Applying the limit to rows instead — which is what
   * a bare `take: limit` does — cuts through the middle of an event and
   * returns, say, three of a creation's six fields with nothing marking the
   * result as partial.
   *
   * `groupBy` rather than `distinct`: groupBy is a real SQL GROUP BY, whereas
   * Prisma may apply `distinct` after the fact, and therefore after `take`.
   */
  async findByEntity(
    entityType: AuditEntity,
    entityId: string,
    limit: number,
  ): Promise<AuditRowPage> {
    const groups = await this.db.auditEntry.groupBy({
      by: ['changeSetId'],
      where: { entityType, entityId },
      _max: { changedAt: true },
      orderBy: [{ _max: { changedAt: 'desc' } }, { changeSetId: 'desc' }],
      // Over-fetch by one to answer "were older change sets withheld?" without
      // a second COUNT.
      take: limit + 1,
    });

    const hasMore = groups.length > limit;
    const ids = groups.slice(0, limit).map((group) => group.changeSetId);
    if (ids.length === 0) return { data: [], hasMore: false };

    const data = await this.db.auditEntry.findMany({
      where: { entityType, entityId, changeSetId: { in: ids } },
      // Newest change set first. `changeSetId` is the tie-break between two
      // sets sharing a millisecond: arbitrary, but stable across queries, so
      // the same history cannot render in a different order on refresh.
      // `field` ascending keeps the lines within one set stable too, rather
      // than whatever order the planner happens to return.
      orderBy: [{ changedAt: 'desc' }, { changeSetId: 'desc' }, { field: 'asc' }],
    });

    return { data, hasMore };
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
