import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, toPage } from './pagination';
import { BadRequestError } from './errors';

const row = {
  cleanedAt: new Date('2026-03-12T09:00:00.000Z'),
  id: '3f1a8c2e-0d4b-4a1f-9c7e-5b2d8e6a1c30',
};

describe('cursor encoding', () => {
  it('round-trips a sort key', () => {
    const decoded = decodeCursor(encodeCursor(row));

    expect(decoded.id).toBe(row.id);
    expect(decoded.cleanedAt.toISOString()).toBe(row.cleanedAt.toISOString());
  });

  it('produces a URL-safe token', () => {
    const cursor = encodeCursor(row);

    // base64url, not base64: no '+', '/' or '=' to percent-escape in a query string.
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects a malformed cursor as a client error, not a crash', () => {
    // Buffer.from silently discards invalid base64 rather than throwing, so this
    // decodes to garbage and must be caught by the schema.
    expect(() => decodeCursor('not-a-cursor')).toThrow(BadRequestError);
    expect(() => decodeCursor('')).toThrow(BadRequestError);
  });

  it('rejects a well-formed token carrying an invalid payload', () => {
    const tampered = Buffer.from(JSON.stringify({ t: 'yesterday', i: 'nope' })).toString(
      'base64url',
    );

    expect(() => decodeCursor(tampered)).toThrow(BadRequestError);
  });
});

describe('toPage', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `0000000${i}-0000-4000-8000-000000000000`.slice(-36),
      cleanedAt: new Date(Date.UTC(2026, 2, 12, 9, 0, n - i)),
    }));

  it('reports hasMore and trims the probe row when the extra row came back', () => {
    const { data, meta } = toPage(rows(11), 10);

    expect(data).toHaveLength(10);
    expect(meta.hasMore).toBe(true);
    expect(meta.nextCursor).not.toBeNull();
  });

  it('reports the end of the list when fewer than limit+1 rows came back', () => {
    const { data, meta } = toPage(rows(7), 10);

    expect(data).toHaveLength(7);
    expect(meta.hasMore).toBe(false);
    expect(meta.nextCursor).toBeNull();
  });

  it('anchors nextCursor to the last row of the returned page, not the probe row', () => {
    const all = rows(11);
    const { data, meta } = toPage(all, 10);

    expect(decodeCursor(meta.nextCursor!).id).toBe(data[9]!.id);
    expect(decodeCursor(meta.nextCursor!).id).not.toBe(all[10]!.id);
  });

  it('handles an empty result set', () => {
    const { data, meta } = toPage(rows(0), 10);

    expect(data).toEqual([]);
    expect(meta).toEqual({ limit: 10, hasMore: false, nextCursor: null });
  });
});
