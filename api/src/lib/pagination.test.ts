import { describe, expect, it } from 'vitest';
import { createKeysetPaginator, recordListScope, recordPaginator } from './pagination';
import { BadRequestError } from './errors';

const SCOPE = 'eq:3f1a8c2e-0d4b-4a1f-9c7e-5b2d8e6a1c30:st:all';
const OTHER_SCOPE = 'eq:3f1a8c2e-0d4b-4a1f-9c7e-5b2d8e6a1c30:st:verified';

const row = {
  cleanedAt: new Date('2026-03-12T09:00:00.000Z'),
  id: '3f1a8c2e-0d4b-4a1f-9c7e-5b2d8e6a1c30',
};

describe('cursor encoding', () => {
  it('round-trips a sort key', () => {
    const decoded = recordPaginator.decode(recordPaginator.encode(SCOPE, row), SCOPE);

    expect(decoded.id).toBe(row.id);
    expect(decoded.sortValue.toISOString()).toBe(row.cleanedAt.toISOString());
  });

  it('produces a URL-safe token', () => {
    const cursor = recordPaginator.encode(SCOPE, row);

    // base64url, not base64: no '+', '/' or '=' to percent-escape in a query string.
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects a malformed cursor as a client error, not a crash', () => {
    // Buffer.from silently discards invalid base64 rather than throwing, so this
    // decodes to garbage and must be caught by the schema.
    expect(() => recordPaginator.decode('not-a-cursor', SCOPE)).toThrow(BadRequestError);
    expect(() => recordPaginator.decode('', SCOPE)).toThrow(BadRequestError);
  });

  it('rejects a well-formed token carrying an invalid payload', () => {
    const tampered = Buffer.from(
      JSON.stringify({ t: 'yesterday', i: 'nope', s: SCOPE }),
    ).toString('base64url');

    expect(() => recordPaginator.decode(tampered, SCOPE)).toThrow(BadRequestError);
  });

  /**
   * Without the scope check, a cursor is just "(timestamp, id)" and any list
   * will happily continue from it — so paging equipment A and then reusing the
   * cursor against equipment B, or against a different status filter, returned
   * a page that looked right and was wrong.
   */
  it('refuses a cursor minted for a different query', () => {
    const cursor = recordPaginator.encode(SCOPE, row);

    expect(() => recordPaginator.decode(cursor, OTHER_SCOPE)).toThrow(BadRequestError);
    expect(() => recordPaginator.decode(cursor, OTHER_SCOPE)).toThrow(/different query/i);
  });

  it('builds a scope that changes with every filter that changes the result set', () => {
    const base = recordListScope({ equipmentId: 'a' });

    expect(recordListScope({ equipmentId: 'a', status: undefined })).toBe(base);
    expect(recordListScope({ equipmentId: 'b' })).not.toBe(base);
    expect(recordListScope({ equipmentId: 'a', status: 'verified' })).not.toBe(base);
  });
});

describe('toPage', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `0000000${i}-0000-4000-8000-000000000000`.slice(-36),
      cleanedAt: new Date(Date.UTC(2026, 2, 12, 9, 0, n - i)),
    }));

  it('reports hasMore and trims the probe row when the extra row came back', () => {
    const { data, meta } = recordPaginator.toPage(rows(11), 10, SCOPE);

    expect(data).toHaveLength(10);
    expect(meta.hasMore).toBe(true);
    expect(meta.nextCursor).not.toBeNull();
  });

  it('reports the end of the list when fewer than limit+1 rows came back', () => {
    const { data, meta } = recordPaginator.toPage(rows(7), 10, SCOPE);

    expect(data).toHaveLength(7);
    expect(meta.hasMore).toBe(false);
    expect(meta.nextCursor).toBeNull();
  });

  it('anchors nextCursor to the last row of the returned page, not the probe row', () => {
    const all = rows(11);
    const { data, meta } = recordPaginator.toPage(all, 10, SCOPE);

    expect(recordPaginator.decode(meta.nextCursor!, SCOPE).id).toBe(data[9]!.id);
    expect(recordPaginator.decode(meta.nextCursor!, SCOPE).id).not.toBe(all[10]!.id);
  });

  it('handles an empty result set', () => {
    const { data, meta } = recordPaginator.toPage(rows(0), 10, SCOPE);

    expect(data).toEqual([]);
    expect(meta).toEqual({ limit: 10, hasMore: false, nextCursor: null });
  });
});

/**
 * The helper used to hardcode `cleanedAt`, which meant the "reuse this for the
 * next paginated list" plan required a rewrite. These assert it is genuinely
 * parameterised over its sort column.
 */
describe('createKeysetPaginator', () => {
  const byCreatedAt = createKeysetPaginator('createdAt');

  it('orders and compares on the column it was built for', () => {
    expect(byCreatedAt.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);

    const at = new Date('2026-03-12T09:00:00.000Z');
    expect(byCreatedAt.where({ sortValue: at, id: 'x' })).toEqual({
      OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: 'x' } }],
    });
  });

  it('returns an empty predicate with no cursor, so the first page is unfiltered', () => {
    expect(byCreatedAt.where(undefined)).toEqual({});
  });
});
