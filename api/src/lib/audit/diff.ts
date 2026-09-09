import { serializeAuditValue } from './serialize';

export interface FieldChange {
  readonly field: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
}

/**
 * Compares two states of an entity over an explicit whitelist of fields and
 * returns one entry per field that actually changed.
 *
 * Semantics, each of which has a test in `diff.test.ts`:
 *
 *   - `before === null` means creation: every supplied, non-null tracked field
 *     is emitted with `oldValue: null`. Creation and update therefore run the
 *     same code path — one function, one set of tests, and no sentinel rows for
 *     consumers to special-case.
 *   - A field that is not an own key of `after` (a PATCH that omitted it) is
 *     skipped. Omitting `notes` is not a change to `notes`.
 *   - An own key whose value is `undefined` is also skipped: `undefined` means
 *     "not supplied", never "cleared". An explicit `null` DOES mean cleared and
 *     is recorded — clearing a note is a real, auditable act.
 *   - Fields outside `trackedFields` are never inspected. This is a whitelist,
 *     not a blacklist, which is what keeps `updatedAt` out of every change set
 *     and makes it impossible for a caller to inject arbitrary field names.
 */
/** `after` may set any tracked field to null, because clearing one is a change. */
export type AuditableState<T> = { [K in keyof T]?: T[K] | null };

export function diffFields<T extends object>(
  before: Partial<T> | null,
  after: AuditableState<T>,
  trackedFields: readonly Extract<keyof T, string>[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  const afterBag = after as Record<string, unknown>;
  const beforeBag = (before ?? undefined) as Record<string, unknown> | undefined;

  for (const field of trackedFields) {
    if (!Object.prototype.hasOwnProperty.call(afterBag, field)) continue;
    if (afterBag[field] === undefined) continue;

    const oldValue = serializeAuditValue(beforeBag?.[field]);
    const newValue = serializeAuditValue(afterBag[field]);

    if (oldValue === newValue) continue;

    changes.push({ field, oldValue, newValue });
  }

  return changes;
}
