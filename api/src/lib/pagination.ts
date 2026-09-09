import { z } from 'zod';
import { BadRequestError } from './errors';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PageMeta {
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/** A decoded cursor: the sort key of the last row on the previous page. */
export interface Cursor {
  readonly sortValue: Date;
  readonly id: string;
}

/**
 * The cursor payload.
 *
 * `s` is a fingerprint of the query the cursor was minted for. Without it a
 * cursor is just "(timestamp, id)", so handing equipment B a cursor obtained
 * from equipment A — or a filtered cursor to an unfiltered list — returns a
 * page that is plausible and wrong. Comparing the fingerprint turns that into
 * a 400 instead of silently bad data.
 *
 * The whole thing stays opaque to clients: the encoding is a server
 * implementation detail and may change without an API version bump.
 */
const cursorPayloadSchema = z.object({
  t: z.iso.datetime(),
  i: z.uuid(),
  s: z.string(),
});

/**
 * A keyset paginator bound to one sort column.
 *
 * Parameterised rather than hardcoded to `cleanedAt`, so the next paginated
 * list (equipment, audit history) reuses this instead of copying it. The sort
 * column and the comparison in `where()` come from the same value, which is
 * what makes it impossible for them to drift apart — the failure that silently
 * drops rows at a page boundary.
 */
export function createKeysetPaginator<K extends string>(sortKey: K) {
  type Row = { id: string } & { [P in K]: Date };

  const orderBy = [{ [sortKey]: 'desc' }, { id: 'desc' }] as const;

  function encode(scope: string, row: Row): string {
    const payload = JSON.stringify({ t: row[sortKey].toISOString(), i: row.id, s: scope });
    return Buffer.from(payload, 'utf8').toString('base64url');
  }

  function decode(raw: string, scope: string): Cursor {
    let parsed: unknown;
    try {
      // Buffer.from does NOT throw on non-base64 input — it silently drops the
      // invalid bytes — so the JSON.parse and the schema below are what
      // actually reject a tampered cursor. Without them this is a 500, not a 400.
      parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestError('INVALID_CURSOR', 'The supplied cursor is malformed.');
    }

    const result = cursorPayloadSchema.safeParse(parsed);
    if (!result.success) {
      throw new BadRequestError('INVALID_CURSOR', 'The supplied cursor is malformed.');
    }

    if (result.data.s !== scope) {
      throw new BadRequestError(
        'CURSOR_SCOPE_MISMATCH',
        'That cursor belongs to a different query. Start from the first page.',
      );
    }

    return { sortValue: new Date(result.data.t), id: result.data.i };
  }

  /**
   * The keyset predicate. The sort column is not unique — a shift's worth of
   * cleanings routinely share a timestamp — so comparing on it alone silently
   * drops every row tying with the page boundary. `id` breaks the tie.
   *
   * Stays in lockstep with `orderBy` above by construction.
   */
  function where(cursor: Cursor | undefined): Record<string, unknown> {
    if (!cursor) return {};
    return {
      OR: [
        { [sortKey]: { lt: cursor.sortValue } },
        { [sortKey]: cursor.sortValue, id: { lt: cursor.id } },
      ],
    };
  }

  /**
   * Splits an over-fetched result set (`take: limit + 1`) into the page plus
   * the metadata describing whether another page exists.
   *
   * Over-fetching by one is how `hasMore` is answered without a COUNT(*): if
   * the extra row came back, there is more to read.
   */
  function toPage<T extends Row>(rows: T[], limit: number, scope: string): { data: T[]; meta: PageMeta } {
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const last = data.at(-1);

    return {
      data,
      meta: {
        limit,
        hasMore,
        nextCursor: hasMore && last ? encode(scope, last) : null,
      },
    };
  }

  return { orderBy, encode, decode, where, toPage };
}

/** The paginator for cleaning records, sorted by when the cleaning happened. */
export const recordPaginator = createKeysetPaginator('cleanedAt');

/**
 * The cursor scope for a cleaning-record listing.
 *
 * Defined once and shared by the Prisma adapter and the in-memory fake, so the
 * two cannot disagree about what a cursor is bound to. Every filter that
 * changes which rows the keyset walks has to appear here.
 */
export function recordListScope(params: {
  readonly equipmentId: string;
  readonly status?: string | undefined;
}): string {
  return ['eq', params.equipmentId, 'st', params.status ?? 'all'].join(':');
}

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().min(1).optional(),
});
