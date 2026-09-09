import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiClient } from '../../../services/apiClient';
import type {
  AuditChangeSet,
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
    queryFn: async () => {
      const response = await apiClient.get<Envelope<AuditChangeSet[]>>(
        `/cleaning-records/${recordId}/audit`,
      );
      return response.data.data;
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
    mutationFn: async ({ id, values }: { id: string; values: RecordFormValues }) => {
      const response = await apiClient.patch<Envelope<CleaningRecord>>(
        `/cleaning-records/${id}`,
        toPayload(values),
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
 * ("2026-08-24T08:00"), which carries no timezone. The API requires an offset,
 * so it is converted here — in the one place that knows about the wire format.
 */
function toPayload(values: RecordFormValues) {
  return {
    cleanedBy: values.cleanedBy,
    cleanedAt: new Date(values.cleanedAt).toISOString(),
    method: values.method,
    notes: values.notes?.trim() ? values.notes.trim() : null,
  };
}
