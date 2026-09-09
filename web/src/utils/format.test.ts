import { describe, expect, it } from 'vitest';
import {
  displayAuditValue,
  fieldLabel,
  formatTimestamp,
  isValidUtcDateTimeLocal,
  toUtcDateTimeLocal,
  utcDateTimeLocalToIso,
  utcDateTimeLocalToMillis,
} from './format';

/**
 * These assertions are deliberately absolute rather than relative, and that is
 * the point: both helpers are zone-independent by construction, so the expected
 * values below are correct on every machine.
 *
 * That also makes this a real regression test. The previous implementation
 * built the field value from UTC getters but read it back with
 * `new Date(value)`, which the language interprets as local time — so
 * `utcDateTimeLocalToIso` would return the wrong instant on any runner not set
 * to UTC, while passing in CI if CI happened to be UTC. No `TZ` pinning is
 * needed to catch it now; the arithmetic is fixed either way.
 */
describe('cleanedAt round trip', () => {
  const ISO = '2026-08-24T08:00:00.000Z';
  const FIELD = '2026-08-24T08:00';

  it('renders an instant as a UTC wall clock', () => {
    expect(toUtcDateTimeLocal(ISO)).toBe(FIELD);
  });

  it('reads a field value back as UTC, not as the viewer local time', () => {
    expect(utcDateTimeLocalToIso(FIELD)).toBe(ISO);
  });

  it('is an exact inverse, so saving an untouched form changes nothing', () => {
    for (const iso of [
      '2026-01-01T00:00:00.000Z',
      '2026-06-15T12:34:00.000Z',
      '2026-08-24T08:00:00.000Z',
      '2026-12-31T23:59:00.000Z',
    ]) {
      expect(utcDateTimeLocalToIso(toUtcDateTimeLocal(iso))).toBe(iso);
    }
  });

  it('keeps a midnight boundary on the same calendar day', () => {
    // A local-time reading would slide this across a date boundary in any zone
    // with a non-zero offset, which is how an audit trail ends up claiming a
    // cleaning happened on a different day.
    expect(toUtcDateTimeLocal('2026-03-01T00:30:00.000Z')).toBe('2026-03-01T00:30');
    expect(utcDateTimeLocalToIso('2026-03-01T00:30')).toBe('2026-03-01T00:30:00.000Z');
  });

  it('agrees with the millis helper the future check uses', () => {
    expect(utcDateTimeLocalToMillis(FIELD)).toBe(Date.parse(ISO));
  });

  /**
   * The create dialog prefills "now". Under the old convention that value was
   * `now - offset`, which is in the future everywhere west of UTC — so the
   * form's own "cannot be logged in the future" rule rejected it on open.
   */
  it('prefills a "now" that is never in the future', () => {
    const prefilled = toUtcDateTimeLocal(new Date().toISOString());

    // Within the minute, and never ahead of the clock.
    expect(utcDateTimeLocalToMillis(prefilled)).toBeLessThanOrEqual(Date.now());
    expect(Date.now() - utcDateTimeLocalToMillis(prefilled)).toBeLessThan(60_000);
  });

  it('rejects an unparseable field value', () => {
    expect(isValidUtcDateTimeLocal(FIELD)).toBe(true);
    expect(isValidUtcDateTimeLocal('not-a-date')).toBe(false);
    expect(isValidUtcDateTimeLocal('')).toBe(false);
  });
});

describe('display helpers', () => {
  it('formats a timestamp in UTC regardless of where it renders', () => {
    expect(formatTimestamp('2026-08-24T08:00:00.000Z')).toBe('24 Aug 2026, 08:00 UTC');
  });

  it('labels known audit fields and passes unknown ones through', () => {
    expect(fieldLabel('cleanedById')).toBe('Cleaned by');
    expect(fieldLabel('somethingNew')).toBe('somethingNew');
  });

  it('keeps "no value" visually distinct from a blank', () => {
    expect(displayAuditValue(null, 'notes')).toBe('—');
    expect(displayAuditValue('', 'notes')).toBe('');
  });

  it('prefers a server-resolved label over a raw id', () => {
    expect(displayAuditValue('some-uuid', 'cleanedById', 'Bob Novak')).toBe('Bob Novak');
    expect(displayAuditValue('some-uuid', 'cleanedById', null)).toBe('some-uuid');
  });

  it('renders an audit timestamp through the UTC formatter', () => {
    expect(displayAuditValue('2026-08-24T08:00:00.000Z', 'cleanedAt')).toBe(
      '24 Aug 2026, 08:00 UTC',
    );
  });
});
