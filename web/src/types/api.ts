export type Role = 'operator' | 'qa';
export type EquipmentStatus = 'active' | 'retired';
export type RecordStatus = 'pending' | 'verified';
export type AuditAction = 'CREATE' | 'UPDATE';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Equipment {
  id: string;
  name: string;
  code: string;
  status: EquipmentStatus;
  createdAt: string;
  updatedAt: string;
}

/** The subset of a user the API embeds on related records. */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface CleaningRecord {
  id: string;
  equipmentId: string;
  cleanedById: string;
  /** Embedded by the API, so rendering a name needs no second request. */
  cleanedBy: UserSummary;
  cleanedAt: string;
  method: string;
  notes: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  /**
   * Present only for fields holding a reference to another row. The API stores
   * the raw id and resolves these for display.
   */
  oldLabel?: string | null;
  newLabel?: string | null;
}

export interface AuditChangeSet {
  changeSetId: string;
  action: AuditAction;
  changedAt: string;
  actor: { id: string; name: string };
  changes: FieldChange[];
}

/** Mirrors the API's `meta` for a keyset page. There is deliberately no `total`. */
export interface PageMeta {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface Envelope<T> {
  data: T;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}
