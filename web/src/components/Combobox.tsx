import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  /** Secondary line, e.g. an email or a role. Also matched when filtering. */
  readonly hint?: string;
}

interface ComboboxProps {
  id: string;
  options: readonly ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  emptyMessage?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string | undefined;
}

/**
 * A searchable single-select, following the ARIA combobox pattern
 * (`role="combobox"` on the input, `aria-controls` to a `role="listbox"`,
 * `aria-activedescendant` tracking the highlighted option).
 *
 * Written by hand rather than pulled from a library so every behaviour is
 * explainable. The parts that are easy to leave out and that make it usable
 * without a mouse:
 *
 *   - Arrow keys move an *active* option without moving DOM focus, which is why
 *     `aria-activedescendant` exists — focus has to stay on the input so typing
 *     keeps working.
 *   - Enter commits the active option; Escape closes without committing and
 *     restores the previously selected label.
 *   - Blurring without committing reverts the query, so the visible text can
 *     never disagree with the value actually held.
 *
 * Filtering is client-side over an already-fetched page. The list is capped
 * server-side, so a directory larger than that page should switch to a
 * debounced server-side query — noted in NOTES.md.
 */
export function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder = 'Search…',
  disabled = false,
  isLoading = false,
  emptyMessage = 'No matches',
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: ComboboxProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [storedActiveIndex, setActiveIndex] = useState(0);

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  // While closed the input mirrors the selection; while open it holds the query.
  const displayValue = isOpen ? query : (selected?.label ?? '');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.hint?.toLowerCase().includes(needle),
    );
  }, [options, query]);

  // Filtering can shrink the list below the stored index. Clamping during render
  // rather than resyncing in an effect means the value can never be momentarily
  // out of range, and avoids a cascading re-render on every keystroke.
  const activeIndex = storedActiveIndex < filtered.length ? storedActiveIndex : 0;

  // Keep the highlighted option visible when navigating by keyboard. Scrolling
  // is a nicety, not behaviour anything depends on, so the call is guarded —
  // scrollIntoView is absent in jsdom and in some embedded webviews, and this
  // must not throw there.
  useEffect(() => {
    if (!isOpen) return;
    const active = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  const open = () => {
    if (disabled) return;
    setQuery('');
    setActiveIndex(Math.max(0, filtered.findIndex((o) => o.value === value)));
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  const commit = (option: ComboboxOption | undefined) => {
    if (!option) return;
    onChange(option.value);
    close();
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!isOpen) {
          open();
          return;
        }
        if (filtered.length === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        // Wrap, so a long list is reachable from either end.
        setActiveIndex((activeIndex + step + filtered.length) % filtered.length);
        return;
      }
      case 'Home':
        if (isOpen) {
          event.preventDefault();
          setActiveIndex(0);
        }
        return;
      case 'End':
        if (isOpen) {
          event.preventDefault();
          setActiveIndex(filtered.length - 1);
        }
        return;
      case 'Enter':
        if (isOpen) {
          // Don't let Enter reach the surrounding form while the list is open.
          event.preventDefault();
          commit(filtered[activeIndex]);
        }
        return;
      case 'Escape':
        if (isOpen) {
          // Stop the parent dialog from closing too — Escape here means
          // "abandon this dropdown", not "abandon the form".
          event.stopPropagation();
          close();
        }
        return;
      case 'Tab':
        if (isOpen) close();
        return;
      default:
    }
  };

  const activeId = isOpen && filtered[activeIndex] ? `${listboxId}-${activeIndex}` : undefined;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        placeholder={isLoading ? 'Loading…' : placeholder}
        value={displayValue}
        onChange={(event) => {
          if (!isOpen) setIsOpen(true);
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onFocus={open}
        // A click outside commits nothing and reverts the text, so what is shown
        // always matches the value actually selected.
        onBlur={() => window.setTimeout(close, 120)}
        onKeyDown={handleKeyDown}
        className="block w-full rounded-md border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-slate-50 disabled:text-slate-400 aria-[invalid=true]:ring-red-500"
      />

      {isOpen && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-slate-500">{emptyMessage}</li>
          ) : (
            filtered.map((option, index) => {
              const isActive = index === activeIndex;
              const isSelected = option.value === value;
              return (
                <li
                  key={option.value}
                  id={`${listboxId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  // onMouseDown, not onClick: the input's blur fires first and
                  // would close the list before a click could land.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(option);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`cursor-pointer px-3 py-2 ${isActive ? 'bg-brand-50' : ''}`}
                >
                  <span
                    className={`block ${isSelected ? 'font-semibold text-brand-700' : 'text-slate-900'}`}
                  >
                    {option.label}
                  </span>
                  {option.hint && <span className="block text-xs text-slate-500">{option.hint}</span>}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
