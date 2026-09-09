/**
 * `instanceof Date` returns false for a Date created in another realm (a vm
 * context, a worker thread, some test harnesses). The internal-tag check does
 * not have that failure mode, and it costs one extra comparison.
 */
const isDate = (value: unknown): value is Date =>
  value instanceof Date || Object.prototype.toString.call(value) === '[object Date]';

/**
 * The canonical string form of an auditable value.
 *
 * The governing rule of this module: **the audit trail stores strings, and if
 * two values serialize identically there is no auditable difference.** Comparing
 * serialized forms rather than raw values collapses three separate bugs at once:
 *
 *   1. Two Date objects holding the same instant are `!==` (reference equality),
 *      so a naive comparison would log a spurious change on every single update.
 *   2. `null` and `undefined` mean the same thing here — "no value" — and both
 *      must map to SQL NULL.
 *   3. An enum or number can never accidentally fail a strict check against its
 *      own string form.
 *
 * It also means the value we store and the value we compare are the same thing,
 * which is what makes the diff easy to reason about.
 */
export function serializeAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (isDate(value)) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError('Cannot audit an Invalid Date');
    }
    return value.toISOString(); // UTC, millisecond precision, stable across runs
  }

  if (typeof value === 'string') return value;

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  // Defensive: no tracked field is currently a structured value. If one ever is,
  // this keeps the trail lossless rather than storing "[object Object]".
  return JSON.stringify(value);
}
