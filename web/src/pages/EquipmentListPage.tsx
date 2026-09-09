import { Link } from 'react-router-dom';
import { Badge } from '../components/Badge';
import { EmptyState, ErrorState, LoadingRows } from '../components/States';
import { useEquipmentList } from '../features/equipment/hooks/useEquipment';

export function EquipmentListPage() {
  const { data, isPending, isError, refetch } = useEquipmentList();

  if (isPending) return <LoadingRows rows={5} label="Loading equipment" />;
  if (isError) {
    return <ErrorState message="Could not load equipment." onRetry={() => void refetch()} />;
  }
  if (data.length === 0) {
    return <EmptyState title="No equipment" description="Seed the database to get started." />;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Equipment</h1>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((item) => (
          <li key={item.id}>
            <Link
              to={`/equipment/${item.id}`}
              className="block rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-slate-900">{item.name}</span>
                {item.status === 'retired' && <Badge tone="retired">retired</Badge>}
              </div>
              <code className="mt-1 block text-xs text-slate-500">{item.code}</code>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
