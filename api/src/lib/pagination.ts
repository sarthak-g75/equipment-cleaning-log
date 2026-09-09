import { z } from 'zod';
import { BadRequestError } from './errors';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface RecordCursor {
  readonly cleanedAt: Date;
  readonly id: string;
}

export interface PageMeta {
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/**
 * The cursor is an opaque, URL-safe encoding of the last row's sort key.
 *
 * It is deliberately opaque: the encoding is a server implementation detail, so
 * it can change without a breaking API version. Clients must treat it as a
 * token, never parse it.
 */
const cursorPayloadSchema = z.object({
  t: z.iso.datetime(),
  i: z.uuid(),
});

export function encodeCursor(row: { cleanedAt: Date; id: string }): string {
  const payload = JSON.stringify({ t: row.cleanedAt.toISOString(), i: row.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): RecordCursor {
  let parsed: unknown;
  try {
    // Buffer.from does NOT throw on non-base64 input — it silently drops the
    // invalid bytes — so the JSON.parse and the schema below are what actually
    // reject a tampered cursor. Without them this is a 500, not a 400.
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestError('INVALID_CURSOR', 'The supplied cursor is malformed.');
  }

  const result = cursorPayloadSchema.safeParse(parsed);
  if (!result.success) {
    throw new BadRequestError('INVALID_CURSOR', 'The supplied cursor is malformed.');
  }

  return { cleanedAt: new Date(result.data.t), id: result.data.i };
}

/**
 * Splits an over-fetched result set (`take: limit + 1`) into the page plus the
 * metadata describing whether another page exists.
 *
 * Over-fetching by one is how `hasMore` is answered without a COUNT(*): if the
 * extra row came back, there is more to read.
 */
export function toPage<T extends { cleanedAt: Date; id: string }>(
  rows: T[],
  limit: number,
): { data: T[]; meta: PageMeta } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);

  return {
    data,
    meta: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    },
  };
}

/**
 * The keyset predicate. `cleanedAt` is not unique — a shift's worth of cleanings
 * routinely share a timestamp — so comparing on it alone silently drops every
 * row tying with the page boundary. `id` breaks the tie.
 *
 * This MUST stay in lockstep with the `orderBy` used by the caller:
 * ORDER BY cleanedAt DESC, id DESC.
 */
export function keysetWhere(cursor: RecordCursor | undefined) {
  if (!cursor) return {};
  return {
    OR: [
      { cleanedAt: { lt: cursor.cleanedAt } },
      { cleanedAt: cursor.cleanedAt, id: { lt: cursor.id } },
    ],
  };
}

export const KEYSET_ORDER_BY = [{ cleanedAt: 'desc' }, { id: 'desc' }] as const;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().min(1).optional(),
});
