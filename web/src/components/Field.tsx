import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}

/**
 * Associates a label, an error and a hint with an input the way a screen reader
 * needs: the error is referenced by aria-describedby, not merely rendered near
 * the field. A placeholder is never a substitute for a label.
 */
export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;

  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export const fieldIds = (name: string) => ({
  id: name,
  errorId: `${name}-error`,
  hintId: `${name}-hint`,
});

export const inputClass =
  'block w-full rounded-md border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 aria-[invalid=true]:ring-red-500';
