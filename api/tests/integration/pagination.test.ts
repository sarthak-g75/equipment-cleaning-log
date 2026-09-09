import { beforeEach, describe, expect, it } from 'vitest';
import type { Equipment } from '@prisma/client';
import { prisma } from '../../src/database/prisma';
import { listRecords } from '../../src/modules/cleaning-records/cleaning-record.service';
import { hasDatabase, useCleanDatabase } from '../helpers/db';
import { makeEquipment, makeRecords } from '../helpers/factories';

describe.skipIf(!hasDatabase)('keyset pagination (integration)', () => {
  useCleanDatabase();

  let equipment: Equipment;

  const BASE = Date.UTC(2026, 7, 24, 8, 0, 0);

  beforeEach(async () => {
    equipment = await makeEquipment();

    // 25 records. Five of them share one identical `cleanedAt`, which is the
    // realistic case (a shift changeover logs several cleanings at once) and the
    // case a single-column cursor silently drops rows on.
    const rows = Array.from({ length: 25 }, (_, i) => ({
      cleanedAt: i < 5 ? new Date(BASE) : new Date(BASE + i * 60_000),
      status: (i % 3 === 0 ? 'verified' : 'pending') as 'verified' | 'pending',
      method: `Method ${i}`,
    }));
    await makeRecords(equipment.id, rows);
  });

  /** Walks every page via nextCursor and returns the ids in the order seen. */
  async function walkAllPages(limit: number, status?: 'pending' | 'verified') {
    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const page = await listRecords(equipment.id, { limit, cursor, status });
      ids.push(...page.data.map((r) => r.id));
      pages += 1;

      if (!page.meta.hasMore) {
        expect(page.meta.nextCursor).toBeNull();
        break;
      }
      cursor = page.meta.nextCursor!;
      expect(cursor).toBeTruthy();
      // Guard against a cursor that fails to advance, which would otherwise
      // spin forever rather than failing the test.
      expect(pages).toBeLessThan(20);
    }

    return { ids, pages };
  }

  it('returns every record exactly once, with no duplicates and no gaps', async () => {
    const { ids, pages } = await walkAllPages(10);

    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect(pages).toBe(3);
  });

  it('paginates in exactly the order a single unpaginated query returns', async () => {
    // This is the assertion that fails the moment `orderBy` and the cursor
    // predicate disagree, or the id tie-breaker is dropped.
    const unpaginated = await prisma.cleaningRecord.findMany({
      where: { equipmentId: equipment.id },
      orderBy: [{ cleanedAt: 'desc' }, { id: 'desc' }],
    });

    const { ids } = await walkAllPages(10);

    expect(ids).toEqual(unpaginated.map((r) => r.id));
  });

  it('does not skip records that share an identical cleanedAt across a page boundary', async () => {
    // limit=3 forces the five tied rows to straddle two page boundaries. A
    // cursor of `WHERE cleanedAt < :t` alone would drop the remaining ties.
    const { ids } = await walkAllPages(3);
    const tied = await prisma.cleaningRecord.findMany({
      where: { equipmentId: equipment.id, cleanedAt: new Date(BASE) },
      select: { id: true },
    });

    expect(tied).toHaveLength(5);
    for (const row of tied) {
      expect(ids).toContain(row.id);
    }
    expect(new Set(ids).size).toBe(25);
  });

  it('is unaffected by a record inserted between fetching two pages', async () => {
    // The concrete failure that OFFSET has and keyset does not: with OFFSET, an
    // insert shifts every subsequent row and the reader sees a duplicate.
    const first = await listRecords(equipment.id, { limit: 10 });

    await makeRecords(equipment.id, [{ cleanedAt: new Date(BASE + 10_000_000) }]);

    const second = await listRecords(equipment.id, {
      limit: 10,
      cursor: first.meta.nextCursor!,
    });

    const firstIds = first.data.map((r) => r.id);
    const secondIds = second.data.map((r) => r.id);

    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(20);
  });

  it('composes the status filter with the cursor and never leaks a filtered-out row', async () => {
    const { ids } = await walkAllPages(3, 'verified');

    const verified = await prisma.cleaningRecord.findMany({
      where: { equipmentId: equipment.id, status: 'verified' },
      orderBy: [{ cleanedAt: 'desc' }, { id: 'desc' }],
    });

    expect(ids).toEqual(verified.map((r) => r.id));

    const fetched = await prisma.cleaningRecord.findMany({ where: { id: { in: ids } } });
    expect(fetched.every((r) => r.status === 'verified')).toBe(true);
  });

  it('reports the end of the list without a next cursor', async () => {
    const page = await listRecords(equipment.id, { limit: 100 });

    expect(page.data).toHaveLength(25);
    expect(page.meta.hasMore).toBe(false);
    expect(page.meta.nextCursor).toBeNull();
  });

  it('scopes results to the requested equipment', async () => {
    const other = await makeEquipment();
    await makeRecords(other.id, [{ cleanedAt: new Date(BASE) }]);

    const page = await listRecords(equipment.id, { limit: 100 });

    expect(page.data).toHaveLength(25);
    expect(page.data.every((r) => r.equipmentId === equipment.id)).toBe(true);
  });
});
