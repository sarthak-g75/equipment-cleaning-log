import { useEffect, useState } from 'react';

/**
 * Trails `value` by `delayMs`.
 *
 * Used to keep the people picker's server query off the keystroke path: typing
 * "alexandra" should cost one request, not nine.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
