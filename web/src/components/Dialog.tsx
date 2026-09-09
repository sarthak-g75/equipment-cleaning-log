import { useCallback, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

interface DialogProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog, written by hand rather than pulled from a component library so
 * every behaviour here is explainable. The four things that make a dialog
 * actually usable — and that are easy to leave out:
 *
 *   1. Focus moves into the dialog when it opens.
 *   2. Tab is trapped inside it while open.
 *   3. Escape closes it.
 *   4. Focus returns to whatever opened it on close.
 *
 * A production system would still be better served by a well-tested primitive
 * (Radix, React Aria) — there are more edge cases here than are worth
 * re-implementing. See NOTES.md.
 */
export function Dialog({ isOpen, title, onClose, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  /**
   * `onClose` is held in a ref, and deliberately NOT an effect dependency.
   *
   * Every call site passes an inline arrow (`onClose={() => setOpen(false)}`),
   * so its identity changes on every parent render. With it in the dependency
   * array the whole effect tore down and re-ran whenever the parent re-rendered
   * for any unrelated reason — a background refetch settling, a mutation
   * changing state. Each teardown ran the cleanup, which focuses the trigger
   * *behind* the dialog, and each re-run then focused the first field again. The
   * visible symptom was focus jumping out of whatever the user was typing in,
   * mid-keystroke. The ref keeps the handler current without making the effect
   * depend on its identity.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const focusables = useCallback(
    () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    if (!isOpen) return;

    triggerRef.current = document.activeElement as HTMLElement | null;
    // Defer one frame so the panel's children have mounted and are focusable.
    const frame = requestAnimationFrame(() => (focusables()[0] ?? panelRef.current)?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;

      // Wrap in both directions, so focus can never escape to the page behind.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      triggerRef.current?.focus();
    };
    // Runs once per open/close, not once per parent render. `focusables` is
    // stable; `onClose` is read through the ref above.
  }, [isOpen, focusables]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      {/* Presentational: the dialog itself is the labelled, focusable surface. */}
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-t-xl bg-white shadow-xl outline-none sm:rounded-xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
          >
            <span aria-hidden="true">&times;</span>
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
