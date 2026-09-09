import type { AuditAction, AuditHistoryMeta, AuditChangeSet } from '../../../types/api';
import { displayAuditValue, fieldLabel, formatTimestamp } from '../../../utils/format';
import { EmptyState, ErrorState, LoadingRows } from '../../../components/States';

interface AuditTrailProps {
  changeSets: AuditChangeSet[] | undefined;
  meta: AuditHistoryMeta | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

const ACTION_TEXT: Record<AuditAction, string> = {
  CREATE: 'created this record',
  UPDATE: 'updated this record',
  DELETE: 'deleted this record',
};

export function AuditTrail({ changeSets, meta, isLoading, error, onRetry }: AuditTrailProps) {
  if (isLoading) return <LoadingRows rows={2} label="Loading audit trail" />;
  if (error) return <ErrorState message="Could not load the audit trail." onRetry={onRetry} />;
  if (!changeSets?.length) {
    return <EmptyState title="No audit history" description="This record has not been changed." />;
  }

  return (
    <>
      <ol className="space-y-3">
        {changeSets.map((set) => (
          <li key={set.changeSetId} className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-slate-900">{set.actor.name}</span>
              <span className="text-xs text-slate-500">{ACTION_TEXT[set.action]}</span>
              <time dateTime={set.changedAt} className="ml-auto text-xs tabular-nums text-slate-500">
                {formatTimestamp(set.changedAt)}
              </time>
            </div>

            <dl className="mt-2 space-y-1">
              {set.changes.map((change) => (
                <div
                  key={change.field}
                  className="grid grid-cols-1 gap-x-2 text-xs sm:grid-cols-[9rem_1fr]"
                >
                  <dt className="font-medium text-slate-600">{fieldLabel(change.field)}</dt>
                  <dd className="flex flex-wrap items-center gap-1.5">
                    {/* An explicit em-dash for null, so "cleared the notes" is
                        visually distinct from "did not touch the notes". */}
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-800 line-through decoration-red-300">
                      {displayAuditValue(change.oldValue, change.field, change.oldLabel)}
                    </span>
                    <span aria-hidden="true" className="text-slate-400">
                      &rarr;
                    </span>
                    <span className="sr-only">changed to</span>
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-900">
                      {displayAuditValue(change.newValue, change.field, change.newLabel)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>

      {/*
        The endpoint is capped, not paginated. Saying so is the difference
        between "this is the history" and "this is the newest part of it" — an
        auditor reading a silently truncated trail as a complete one is exactly
        the failure this whole feature exists to prevent.
      */}
      {meta?.hasMore && (
        <p className="mt-3 text-xs text-slate-500">
          Showing the {meta.limit} most recent changes. Older changes are not shown.
        </p>
      )}
    </>
  );
}
