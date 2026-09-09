import { describe, expect, it } from 'vitest';
import { diffFields } from './diff';
import { serializeAuditValue } from './serialize';

interface Record {
  cleanedBy: string;
  cleanedAt: Date;
  method: string;
  notes: string | null;
  status: 'pending' | 'verified';
  updatedAt: Date;
}

const TRACKED = ['cleanedBy', 'cleanedAt', 'method', 'notes', 'status'] as const satisfies
  readonly (keyof Record)[];

const base = (): Record => ({
  cleanedBy: 'A. Operator',
  cleanedAt: new Date('2026-03-12T09:00:00.000Z'),
  method: 'CIP',
  notes: 'Swab passed',
  status: 'pending',
  updatedAt: new Date('2026-03-12T09:00:00.000Z'),
});

describe('diffFields', () => {
  it('does not report a change for two Date objects holding the same instant', () => {
    // The bug this guards: `before.cleanedAt !== after.cleanedAt` is ALWAYS true
    // for two distinct Date objects, so a reference comparison would log a
    // spurious cleanedAt change on literally every update.
    const before = base();
    const after = { ...before, cleanedAt: new Date('2026-03-12T09:00:00.000Z') };

    expect(before.cleanedAt).not.toBe(after.cleanedAt); // different objects...
    expect(diffFields(before, after, TRACKED)).toEqual([]); // ...same instant
  });

  it('reports a genuine date change with both sides serialized to ISO-8601', () => {
    const before = base();
    const after = { ...before, cleanedAt: new Date('2026-03-13T14:30:00.000Z') };

    expect(diffFields(before, after, TRACKED)).toEqual([
      {
        field: 'cleanedAt',
        oldValue: '2026-03-12T09:00:00.000Z',
        newValue: '2026-03-13T14:30:00.000Z',
      },
    ]);
  });

  it('ignores a field the caller omitted entirely', () => {
    // A PATCH body that does not mention `notes` is not a change to `notes`.
    const before = base();
    const after: Partial<Record> = { method: 'Manual wipe' };

    expect(diffFields(before, after, TRACKED)).toEqual([
      { field: 'method', oldValue: 'CIP', newValue: 'Manual wipe' },
    ]);
  });

  it('ignores a field explicitly set to undefined', () => {
    const before = base();
    const after: Partial<Record> = { notes: undefined };

    expect(diffFields(before, after, TRACKED)).toEqual([]);
  });

  it('records an explicit null as a real change', () => {
    // The counterpart to the two tests above: clearing a field IS auditable, and
    // must stay distinguishable from omitting it.
    const before = base();
    const after: Partial<Record> = { notes: null };

    expect(diffFields(before, after, TRACKED)).toEqual([
      { field: 'notes', oldValue: 'Swab passed', newValue: null },
    ]);
  });

  it('reports nothing when every supplied value equals the current one', () => {
    const before = base();

    expect(diffFields(before, { ...before }, TRACKED)).toEqual([]);
  });

  it('reports nothing for an unchanged null', () => {
    const before = { ...base(), notes: null };

    expect(diffFields<Record>(before, { notes: null }, TRACKED)).toEqual([]);
  });

  it('reports one entry per changed field and none for the unchanged ones', () => {
    const before = base();
    const after = { ...before, status: 'verified' as const, notes: 'TOC 0.4 ppm' };

    expect(diffFields(before, after, TRACKED)).toEqual([
      { field: 'notes', oldValue: 'Swab passed', newValue: 'TOC 0.4 ppm' },
      { field: 'status', oldValue: 'pending', newValue: 'verified' },
    ]);
  });

  it('treats trackedFields as a whitelist, not a blacklist', () => {
    // `updatedAt` changes on every single write. If the diff walked the object's
    // own keys instead of the whitelist, every change set would be polluted
    // with it — and any sensitive column would leak into the audit trail.
    const before = base();
    const after = { ...before, updatedAt: new Date('2027-01-01T00:00:00.000Z') };

    expect(diffFields(before, after, TRACKED)).toEqual([]);
  });

  describe('creation (before === null)', () => {
    it('emits one entry per supplied non-null field with a null old value', () => {
      const created = base();

      expect(diffFields<Record>(null, created, TRACKED)).toEqual([
        { field: 'cleanedBy', oldValue: null, newValue: 'A. Operator' },
        { field: 'cleanedAt', oldValue: null, newValue: '2026-03-12T09:00:00.000Z' },
        { field: 'method', oldValue: null, newValue: 'CIP' },
        { field: 'notes', oldValue: null, newValue: 'Swab passed' },
        { field: 'status', oldValue: null, newValue: 'pending' },
      ]);
    });

    it('skips fields that are null at creation', () => {
      // null -> null serializes to null === null, so the shared unchanged-check
      // handles this with no creation-specific branch.
      const created = { ...base(), notes: null };

      expect(diffFields<Record>(null, created, TRACKED).map((c) => c.field)).not.toContain(
        'notes',
      );
    });
  });
});

describe('serializeAuditValue', () => {
  it('renders a Date as a stable UTC ISO-8601 string', () => {
    expect(serializeAuditValue(new Date('2026-03-12T09:00:00.000Z'))).toBe(
      '2026-03-12T09:00:00.000Z',
    );
  });

  it('throws rather than silently storing an Invalid Date', () => {
    expect(() => serializeAuditValue(new Date('not a date'))).toThrow(TypeError);
  });

  it('collapses null and undefined to the same "no value" representation', () => {
    expect(serializeAuditValue(null)).toBeNull();
    expect(serializeAuditValue(undefined)).toBeNull();
  });

  it('keeps an empty string distinct from no value', () => {
    // These mean different things: "" is a value the user supplied, null is the
    // absence of one. The Zod layer decides whether "" should become null; the
    // serializer must not make that decision on its behalf.
    expect(serializeAuditValue('')).toBe('');
    expect(serializeAuditValue('')).not.toBe(serializeAuditValue(null));
  });

  it('renders scalars by value', () => {
    expect(serializeAuditValue(42)).toBe('42');
    expect(serializeAuditValue(true)).toBe('true');
  });
});
