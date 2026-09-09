import type { ReactNode } from 'react';
import { Button } from './Button';

/**
 * Loading, error and empty are three different things and each gets its own
 * component. Collapsing "empty" into "loading" is how a list ends up silently
 * showing nothing when a request actually failed.
 */
export function LoadingRows({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2 p-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
      <p className="text-sm font-medium text-red-900">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
