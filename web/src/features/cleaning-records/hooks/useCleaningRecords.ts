import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiClient } from '../../../services/apiClient';
import { utcDateTimeLocalToIso } from '../../../utils/format';
import type {
  AuditHistoryPage,
  CleaningRecord,
  Envelope,
  Page,
  RecordStatus,
} from '../../../types/api';
import type { RecordFormValues } from '../validators/recordSchema';

export const recordKeys = {
  all: ['cleaning-records'] as const,
  list: (equipmentId: string, status?: RecordStatus) =>
    ['cleaning-records', 'list', equipmentId, status ?? 'all'] as const,
  audit: (recordId: string) => ['cleaning-records', 'audit', recordId] as const,
};

const PAGE_SIZE = 10;

/**
 * Forward-only keyset pagination, so useInfiniteQuery is the natural fit: it
 * owns the cursor chain and keeps previously loaded pages in cache, which means
 * there is no cursor state to hand-manage in the component and "back" is free.
 */
export function useCleaningRecords(equipmentId: string, status?: RecordStatus) {
  return useInfiniteQuery({
    queryKey: recordKeys.list(equipmentId, status),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const response = await apiClient.get<Page<CleaningRecord>>(
        `/equipment/${equipmentId}/cleaning-records`,
        {
          params: { limit: PAGE_SIZE, ...(status ? { status } : {}), ...(pageParam ? { cursor: pageParam } : {}) },
          signal,
        },
      );
      return response.data;
    },
    // `nextCursor` is null on the last page, which is what stops the chain.
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
  });
}

export function useRecordAudit(recordId: string, enabled: boolean) {
  return useQuery({
    queryKey: recordKeys.audit(recordId),
    queryFn: async ({ signal }) => {
      // Returns `{ data, meta }`, not a bare array: `meta.hasMore` is how the
      // UI can say "older changes are not shown" instead of implying the trail
      // it rendered is the whole trail.
      const response = await apiClient.get<AuditHistoryPage>(
        `/cleaning-records/${recordId}/audit`,
        { signal },
      );
      return response.data;
    },
    // Only fetched when the user actually opens the trail.
    enabled,
  });
}

function useInvalidateRecords(equipmentId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: recordKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['equipment', 'detail', equipmentId] });
  };
}

export function useCreateRecord(equipmentId: string) {
  const invalidate = useInvalidateRecords(equipmentId);
  return useMutation({
    mutationFn: async (values: RecordFormValues) => {
      const response = await apiClient.post<Envelope<CleaningRecord>>(
        `/equipment/${equipmentId}/cleaning-records`,
        toPayload(values),
      );
      return response.data.data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateRecord(equipmentId: string) {
  const invalidate = useInvalidateRecords(equipmentId);
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<RecordFormValues> }) => {
      const response = await apiClient.patch<Envelope<CleaningRecord>>(
        `/cleaning-records/${id}`,
        toPatchPayload(values),
      );
      return response.data.data;
    },
    onSuccess: invalidate,
  });
}

export function useVerifyRecord(equipmentId: string) {
  const invalidate = useInvalidateRecords(equipmentId);
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.post<Envelope<CleaningRecord>>(
        `/cleaning-records/${id}/verify`,
      );
      return response.data.data;
    },
    onSuccess: invalidate,
  });
}

/**
 * The form holds `cleanedAt` as the value a datetime-local input produces
 * ("2026-08-24T08:00"), which carries no timezone. The API requires an offset.
 *
 * `utcDateTimeLocalToIso` is the exact inverse of the `toUtcDateTimeLocal` that
 * filled the field. Using `new Date(value)` here instead — as this did — reads
 * the wall clock as LOCAL while the field was written as UTC, which shifted
 * every saved timestamp by the browser's offset.
 */
function toPayload(values: RecordFormValues) {
  return {
    cleanedById: values.cleanedById,
    cleanedAt: utcDateTimeLocalToIso(values.cleanedAt),
    method: values.method,
    notes: values.notes?.trim() ? values.notes.trim() : null,
  };
}

/**
 * A genuine PATCH: only the keys present in `values` reach the wire.
 *
 * The API distinguishes "omitted" from "explicitly null" — omitting `notes` is
 * not a change to `notes`, while sending `null` clears it — and the audit trail
 * depends on that distinction. Sending the whole form on every save collapsed
 * it, so an edit re-submitted every field whether or not the user touched it.
 */
function toPatchPayload(values: Partial<RecordFormValues>) {
  const payload: Record<string, unknown> = {};

  if (values.cleanedById !== undefined) payload.cleanedById = values.cleanedById;
  if (values.cleanedAt !== undefined) payload.cleanedAt = utcDateTimeLocalToIso(values.cleanedAt);
  if (values.method !== undefined) payload.method = values.method;
  // An emptied notes box is an explicit null — "the user cleared this" is a
  // real, auditable act, distinct from never having touched the field.
  if (values.notes !== undefined) payload.notes = values.notes.trim() ? values.notes.trim() : null;

  return payload;
}
