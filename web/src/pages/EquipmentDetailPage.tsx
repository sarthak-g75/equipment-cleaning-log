import { useCallback, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { CleaningRecord, RecordStatus } from '../types/api';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, LoadingRows } from '../components/States';
import { useAuth } from '../features/auth/AuthContext';
import { useEquipmentDetail } from '../features/equipment/hooks/useEquipment';
import {
  useCleaningRecords,
  useCreateRecord,
  useUpdateRecord,
  useVerifyRecord,
} from '../features/cleaning-records/hooks/useCleaningRecords';
import { RecordsTable } from '../features/cleaning-records/components/RecordsTable';
import { RecordFormDialog } from '../features/cleaning-records/components/RecordFormDialog';

const STATUS_FILTERS = [
  { value: undefined, label: 'All' },
  { value: 'pending' as const, label: 'Pending' },
  { value: 'verified' as const, label: 'Verified' },
];

export function EquipmentDetailPage() {
  const { equipmentId = '' } = useParams();
  const { user } = useAuth();

  // The filter lives in the URL, not in useState: a filtered view is then
  // shareable, bookmarkable and survives a refresh, which is what a user
  // expects from something the back button should reach.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawStatus = searchParams.get('status');
  const status: RecordStatus | undefined =
    rawStatus === 'pending' || rawStatus === 'verified' ? rawStatus : undefined;

  const [editing, setEditing] = useState<CleaningRecord | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const equipment = useEquipmentDetail(equipmentId);
  const records = useCleaningRecords(equipmentId, status);
  const createRecord = useCreateRecord(equipmentId);
  const updateRecord = useUpdateRecord(equipmentId);
  const verifyRecord = useVerifyRecord(equipmentId);

  const setStatus = (next: RecordStatus | undefined) => {
    setSearchParams(next ? { status: next } : {}, { replace: true });
  };

  const openCreate = () => {
    setEditing(null);
    setIsFormOpen(true);
  };

  // Stable, because RecordsTable memoises its rows on these references.
  const openEdit = useCallback((record: CleaningRecord) => {
    setEditing(record);
    setIsFormOpen(true);
  }, []);

  const handleVerify = useCallback((id: string) => verifyRecord.mutate(id), [verifyRecord]);

  const rows = records.data?.pages.flatMap((page) => page.data) ?? [];
  const isRetired = equipment.data?.status === 'retired';

  return (
    <div className="space-y-5">
      <div>
        <Link to="/equipment" className="text-xs text-brand-600 hover:underline">
          &larr; All equipment
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">
            {equipment.data?.name ?? 'Equipment'}
          </h1>
          {equipment.data && (
            <>
              <code className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {equipment.data.code}
              </code>
              {isRetired && <Badge tone="retired">retired</Badge>}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter by status" className="flex gap-1">
          {STATUS_FILTERS.map((filter) => (
            <Button
              key={filter.label}
              size="sm"
              variant={status === filter.value ? 'primary' : 'secondary'}
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        <Button
          onClick={openCreate}
          disabled={isRetired}
          title={isRetired ? 'Retired equipment cannot be cleaned' : undefined}
        >
          Log a cleaning
        </Button>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white">
        {records.isPending ? (
          <LoadingRows rows={5} label="Loading cleaning records" />
        ) : records.isError ? (
          <div className="p-4">
            <ErrorState
              message="Could not load cleaning records."
              onRetry={() => void records.refetch()}
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={status ? `No ${status} records` : 'No cleaning records yet'}
              description={
                status
                  ? 'Try clearing the filter to see all records for this equipment.'
                  : 'Log the first cleaning for this equipment.'
              }
              action={
                status ? (
                  <Button variant="secondary" size="sm" onClick={() => setStatus(undefined)}>
                    Clear filter
                  </Button>
                ) : (
                  <Button size="sm" onClick={openCreate} disabled={isRetired}>
                    Log a cleaning
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <>
            <RecordsTable
              records={rows}
              canVerify={user?.role === 'qa'}
              onEdit={openEdit}
              onVerify={handleVerify}
              verifyingId={verifyRecord.isPending ? verifyRecord.variables : null}
            />
            <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2.5">
              <p className="text-xs text-slate-500">
                Showing {rows.length} record{rows.length === 1 ? '' : 's'}
              </p>
              {/* Keyset pagination is forward-only, so this is a "load more"
                  chain rather than numbered pages. See NOTES.md. */}
              {records.hasNextPage && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void records.fetchNextPage()}
                  disabled={records.isFetchingNextPage}
                >
                  {records.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </div>
          </>
        )}
      </section>

      <RecordFormDialog
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        record={editing ?? undefined}
        defaultCleanedById={user?.id ?? ''}
        onSubmit={(values) =>
          editing
            ? updateRecord.mutateAsync({ id: editing.id, values })
            : createRecord.mutateAsync(values)
        }
      />
    </div>
  );
}
