import { useState } from 'react';
import type { CleaningRecord } from '../../../types/api';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { formatTimestamp } from '../../../utils/format';
import { useRecordAudit } from '../hooks/useCleaningRecords';
import { AuditTrail } from './AuditTrail';

interface RecordsTableProps {
  records: CleaningRecord[];
  canVerify: boolean;
  onEdit: (record: CleaningRecord) => void;
  onVerify: (id: string) => void;
  verifyingId: string | null;
}

export function RecordsTable({
  records,
  canVerify,
  onEdit,
  onVerify,
  verifyingId,
}: RecordsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
        <caption className="sr-only">Cleaning records, most recent first</caption>
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-3 py-2 font-medium">Cleaned at</th>
            <th scope="col" className="px-3 py-2 font-medium">Cleaned by</th>
            <th scope="col" className="px-3 py-2 font-medium">Method</th>
            <th scope="col" className="px-3 py-2 font-medium">Notes</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const isExpanded = expandedId === record.id;
            return (
              <RecordRow
                key={record.id}
                record={record}
                isExpanded={isExpanded}
                canVerify={canVerify}
                isVerifying={verifyingId === record.id}
                onToggleAudit={() => setExpandedId(isExpanded ? null : record.id)}
                onEdit={() => onEdit(record)}
                onVerify={() => onVerify(record.id)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface RecordRowProps {
  record: CleaningRecord;
  isExpanded: boolean;
  canVerify: boolean;
  isVerifying: boolean;
  onToggleAudit: () => void;
  onEdit: () => void;
  onVerify: () => void;
}

function RecordRow({
  record,
  isExpanded,
  canVerify,
  isVerifying,
  onToggleAudit,
  onEdit,
  onVerify,
}: RecordRowProps) {
  // The audit query is only issued once the row is actually expanded, so opening
  // a list of 10 records does not fire 10 history requests nobody asked for.
  const audit = useRecordAudit(record.id, isExpanded);
  const isVerified = record.status === 'verified';

  return (
    <>
      <tr className="border-b border-slate-100 align-top">
        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-slate-700">
          {formatTimestamp(record.cleanedAt)}
        </td>
        <td className="px-3 py-2.5 text-slate-700">{record.cleanedBy}</td>
        <td className="px-3 py-2.5 text-slate-700">{record.method}</td>
        <td className="max-w-[16rem] px-3 py-2.5 text-slate-500">
          {record.notes ?? <span className="text-slate-400">—</span>}
        </td>
        <td className="px-3 py-2.5">
          <Badge tone={isVerified ? 'verified' : 'pending'}>{record.status}</Badge>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleAudit}
              aria-expanded={isExpanded}
              aria-controls={`audit-${record.id}`}
            >
              {isExpanded ? 'Hide history' : 'History'}
            </Button>
            {/* A verified record is a signed-off document: the API rejects edits
                to it, so the UI must not offer one. */}
            {!isVerified && (
              <Button variant="secondary" size="sm" onClick={onEdit}>
                Edit
              </Button>
            )}
            {!isVerified && canVerify && (
              <Button size="sm" onClick={onVerify} disabled={isVerifying}>
                {isVerifying ? 'Verifying…' : 'Verify'}
              </Button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr id={`audit-${record.id}`}>
          <td colSpan={6} className="bg-slate-50 px-3 py-3">
            <AuditTrail
              changeSets={audit.data}
              isLoading={audit.isLoading}
              error={audit.error}
              onRetry={() => void audit.refetch()}
            />
          </td>
        </tr>
      )}
    </>
  );
}
