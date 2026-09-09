import type {
  AuditEntry,
  CleaningRecord,
  Equipment,
  EquipmentStatus,
  RecordStatus,
  User,
} from '@prisma/client';
import type { AuditAction, AuditEntity } from '@prisma/client';
import type { FieldChange } from '../lib/audit/diff';
import type { PageMeta } from '../lib/pagination';

/**
 * The ports the service layer depends on.
 *
 * These interfaces are the *abstractions* in "depend on abstractions, not
 * concretions": nothing below imports the Prisma client, so a service can be
 * unit-tested against an in-memory fake with no database, and the persistence
 * technology can change without touching a business rule.
 *
 * One pragmatic concession, stated rather than hidden: the entity *types* are
 * Prisma's generated model types. Re-declaring a parallel set of domain
 * interfaces would be pure duplication at this size — the generated types are
 * already plain data with no behaviour or driver coupling. The dependency that
 * actually matters, on the client and its query API, is what these ports break.
 */

export interface CleaningRecordWithCleaner extends CleaningRecord {
  cleanedBy: Pick<User, 'id' | 'name' | 'email' | 'role'>;
}

export interface ListRecordsParams {
  readonly equipmentId: string;
  readonly status?: RecordStatus | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface CreateRecordData {
  readonly equipmentId: string;
  readonly cleanedById: string;
  readonly cleanedAt: Date;
  readonly method: string;
  readonly notes?: string | null | undefined;
}

export type UpdateRecordData = Partial<Omit<CreateRecordData, 'equipmentId'>>;

export interface CleaningRecordRepository {
  listByEquipment(params: ListRecordsParams): Promise<{ data: CleaningRecordWithCleaner[]; meta: PageMeta }>;
  findById(id: string): Promise<CleaningRecordWithCleaner | null>;
  countByEquipment(equipmentId: string): Promise<number>;
  create(data: CreateRecordData): Promise<CleaningRecordWithCleaner>;
  update(id: string, data: UpdateRecordData & { status?: RecordStatus }): Promise<CleaningRecordWithCleaner>;
  /**
   * Takes a row lock so a concurrent writer cannot read the same predecessor.
   * Only meaningful inside a transaction, which is why it lives on the
   * transaction-scoped repository rather than on a free function.
   */
  lockForUpdate(id: string): Promise<void>;
}

export interface CreateEquipmentData {
  readonly name: string;
  readonly code: string;
  readonly status?: EquipmentStatus | undefined;
}

export type UpdateEquipmentData = Partial<CreateEquipmentData>;

export interface EquipmentRepository {
  list(status?: EquipmentStatus): Promise<Equipment[]>;
  findById(id: string): Promise<Equipment | null>;
  /**
   * Batched lookup for the audit trail's reference resolver. Without it the
   * resolver has to read the whole table and filter in memory, which is an
   * unbounded read on every audit request.
   */
  findManyByIds(ids: readonly string[]): Promise<Pick<Equipment, 'id' | 'name' | 'code'>[]>;
  create(data: CreateEquipmentData): Promise<Equipment>;
  update(id: string, data: UpdateEquipmentData): Promise<Equipment>;
  /**
   * Returns the row as it stood immediately before deletion, or null if there
   * was nothing to delete. The caller needs those values to write the DELETE
   * change set — after the row is gone they cannot be recovered.
   */
  deleteById(id: string): Promise<Equipment | null>;
  lockForUpdate(id: string): Promise<void>;
}

export type UserSummary = Pick<User, 'id' | 'name' | 'email' | 'role'>;

export interface ListUsersParams {
  readonly role?: User['role'] | undefined;
  readonly q?: string | undefined;
  /** Hard cap on rows returned. The directory endpoint is never unbounded. */
  readonly limit: number;
}

export interface UserRepository {
  list(params: ListUsersParams): Promise<UserSummary[]>;
  findByEmail(email: string): Promise<User | null>;
  findManyByIds(ids: readonly string[]): Promise<Pick<User, 'id' | 'name'>[]>;
}

export interface Actor {
  readonly id: string;
  readonly name: string;
}

export interface RecordChangesInput {
  readonly entityType: AuditEntity;
  readonly entityId: string;
  readonly action: AuditAction;
  readonly actor: Actor;
  readonly changes: readonly FieldChange[];
}

/**
 * A page of audit rows, already grouped-safe: `data` never contains a partial
 * change set, and `hasMore` says whether older change sets were withheld.
 */
export interface AuditRowPage {
  readonly data: AuditEntry[];
  readonly hasMore: boolean;
}

export interface AuditRepository {
  record(input: RecordChangesInput): Promise<void>;
  /**
   * `limit` counts CHANGE SETS, not rows.
   *
   * The table holds one row per changed field, so a row limit cuts through the
   * middle of an event and hands back a CREATE missing half its fields, with
   * nothing to say it was truncated. For an audit trail that is worse than
   * returning less: it is a complete-looking lie.
   */
  findByEntity(entityType: AuditEntity, entityId: string, limit: number): Promise<AuditRowPage>;
}

/** Every repository, bound to one database context. */
export interface Repositories {
  readonly cleaningRecords: CleaningRecordRepository;
  readonly equipment: EquipmentRepository;
  readonly users: UserRepository;
  readonly audit: AuditRepository;
}

/**
 * Runs work atomically.
 *
 * This is the abstraction that lets a service say "the record write and its
 * audit write happen together" without knowing what a transaction *is*. The
 * repositories handed to the callback are bound to that transaction, so it is
 * not possible to accidentally perform half the work outside it.
 */
export interface UnitOfWork {
  /** Repositories bound to the default (non-transactional) connection. */
  readonly repos: Repositories;
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
