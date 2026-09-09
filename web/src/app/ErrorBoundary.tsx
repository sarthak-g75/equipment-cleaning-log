import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Stops one crashing subtree from blanking the whole app. Kept as a class
 * because React still has no hook equivalent for componentDidCatch.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // In production this is where an error-tracking SDK would be called.
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-base font-semibold text-slate-900">Something went wrong</h1>
        <p className="mt-1 text-sm text-slate-500">
          The page hit an unexpected error. Reloading usually clears it.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
        >
          Reload
        </button>
      </div>
    );
  }
}
