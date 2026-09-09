import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Equipment, EquipmentStatus } from '../types/api';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, ErrorState, LoadingRows } from '../components/States';
import { ApiError } from '../services/apiClient';
import { useAuth } from '../features/auth/AuthContext';
import {
  useCreateEquipment,
  useDeleteEquipment,
  useEquipmentList,
  useUpdateEquipment,
} from '../features/equipment/hooks/useEquipment';
import { EquipmentFormDialog } from '../features/equipment/components/EquipmentFormDialog';

const STATUS_FILTERS: ReadonlyArray<{ value: EquipmentStatus | undefined; label: string }> = [
  { value: undefined, label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'retired', label: 'Retired' },
];

export function EquipmentListPage() {
  // Managing the asset register is a QA action server-side, so the UI must not
  // offer buttons that can only come back as a 403. Reading it stays open.
  const { user } = useAuth();
  const canManage = user?.role === 'qa';

  // Filter in the URL so a filtered view is shareable and survives a refresh.
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('status');
  const status: EquipmentStatus | undefined =
    raw === 'active' || raw === 'retired' ? raw : undefined;

  const [editing, setEditing] = useState<Equipment | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Equipment | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const equipment = useEquipmentList(status);
  const createEquipment = useCreateEquipment();
  const updateEquipment = useUpdateEquipment();
  const deleteEquipment = useDeleteEquipment();

  const setStatus = (next: EquipmentStatus | undefined) =>
    setSearchParams(next ? { status: next } : {}, { replace: true });

  const openCreate = () => {
    setEditing(null);
    setIsFormOpen(true);
  };

  const openEdit = (item: Equipment) => {
    setEditing(item);
    setIsFormOpen(true);
  };

  const openDelete = (item: Equipment) => {
    setDeleteError(null);
    setDeleting(item);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleteEquipment.mutate(deleting.id, {
      onSuccess: () => setDeleting(null),
      onError: (error) => {
        // A 409 here is expected, not exceptional: the equipment has cleaning
        // records and deleting it would orphan their audit trail. Show the
        // server's explanation in place rather than as a generic failure.
        setDeleteError(
          error instanceof ApiError ? error.message : 'Could not delete this equipment.',
        );
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Equipment</h1>
        {canManage && <Button onClick={openCreate}>Add equipment</Button>}
      </div>

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

      <EquipmentBody
        isPending={equipment.isPending}
        isError={equipment.isError}
        items={equipment.data}
        status={status}
        canManage={canManage}
        onRetry={() => void equipment.refetch()}
        onCreate={openCreate}
        onClearFilter={() => setStatus(undefined)}
        onEdit={openEdit}
        onDelete={openDelete}
      />

      <EquipmentFormDialog
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        equipment={editing ?? undefined}
        onSubmit={(values) =>
          editing
            ? updateEquipment.mutateAsync({ id: editing.id, values })
            : createEquipment.mutateAsync(values)
        }
      />

      <ConfirmDialog
        isOpen={deleting !== null}
        title="Delete equipment"
        message={`Delete ${deleting?.name ?? ''} (${deleting?.code ?? ''})? This cannot be undone.`}
        isPending={deleteEquipment.isPending}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

interface EquipmentBodyProps {
  isPending: boolean;
  isError: boolean;
  items: Equipment[] | undefined;
  status: EquipmentStatus | undefined;
  canManage: boolean;
  onRetry: () => void;
  onCreate: () => void;
  onClearFilter: () => void;
  onEdit: (item: Equipment) => void;
  onDelete: (item: Equipment) => void;
}

function EquipmentBody({
  isPending,
  isError,
  items,
  status,
  canManage,
  onRetry,
  onCreate,
  onClearFilter,
  onEdit,
  onDelete,
}: EquipmentBodyProps) {
  if (isPending) return <LoadingRows rows={4} label="Loading equipment" />;
  if (isError) return <ErrorState message="Could not load equipment." onRetry={onRetry} />;

  if (!items || items.length === 0) {
    return (
      <EmptyState
        title={status ? `No ${status} equipment` : 'No equipment yet'}
        description={
          status
            ? 'Try clearing the filter.'
            : canManage
              ? 'Add the first piece of equipment to track.'
              : 'Ask a QA user to add equipment.'
        }
        action={
          status ? (
            <Button variant="secondary" size="sm" onClick={onClearFilter}>
              Clear filter
            </Button>
          ) : canManage ? (
            <Button size="sm" onClick={onCreate}>
              Add equipment
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4"
        >
          <div>
            <div className="flex items-start justify-between gap-2">
              {/* The card's primary action is a real link, so it opens in a new
                  tab, shows its target on hover, and works without JS. */}
              <Link
                to={`/equipment/${item.id}`}
                className="font-medium text-slate-900 hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                {item.name}
              </Link>
              {item.status === 'retired' && <Badge tone="retired">retired</Badge>}
            </div>
            <code className="mt-1 block text-xs text-slate-500">{item.code}</code>
          </div>

          {canManage && (
            <div className="mt-4 flex justify-end gap-1 border-t border-slate-100 pt-3">
              <Button variant="secondary" size="sm" onClick={() => onEdit(item)}>
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onDelete(item)}>
                Delete
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
