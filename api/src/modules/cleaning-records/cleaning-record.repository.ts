import type { CleaningRecord, Prisma, RecordStatus } from '@prisma/client';
import { prisma } from '../../database/prisma';
import {
  KEYSET_ORDER_BY,
  decodeCursor,
  keysetWhere,
  toPage,
  type PageMeta,
} from '../../lib/pagination';

export interface ListRecordsParams {
  readonly equipmentId: string;
  readonly status?: RecordStatus | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export async function listByEquipment(
  params: ListRecordsParams,
): Promise<{ data: CleaningRecord[]; meta: PageMeta }> {
  const cursor = params.cursor ? decodeCursor(params.cursor) : undefined;

  const where: Prisma.CleaningRecordWhereInput = {
    equipmentId: params.equipmentId,
    ...(params.status ? { status: params.status } : {}),
    // Sibling keys are ANDed by Prisma, so the keyset predicate composes with
    // the status filter without any special casing. That is the property that
    // makes keyset pagination pleasant: the cursor names a position in the sort
    // order, not an offset into a particular result set.
    ...keysetWhere(cursor),
  };

  const rows = await prisma.cleaningRecord.findMany({
    where,
    // Must stay in lockstep with the cursor comparison in keysetWhere().
    orderBy: [...KEYSET_ORDER_BY],
    take: params.limit + 1,
  });

  return toPage(rows, params.limit);
}
