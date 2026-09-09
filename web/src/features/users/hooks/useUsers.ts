import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../services/apiClient';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import type { Envelope, UserSummary } from '../../../types/api';

export const userKeys = {
  all: ['users'] as const,
  list: (q: string) => ['users', 'list', q] as const,
};

/**
 * The staff directory, filtered by the server.
 *
 * The endpoint caps its result set (50 rows) — an unbounded directory endpoint
 * is a latent scaling problem — so filtering has to happen server-side. This
 * hook used to request `/users` with no query at all and let the combobox filter
 * the response in memory, which meant the picker could only ever see the first
 * 50 people by name: user 51 existed, was a perfectly valid `cleanedById`, and
 * was unreachable through the UI.
 *
 * The query is debounced so typing costs one request rather than one per key.
 */
export function useUsers(search = '') {
  const debounced = useDebouncedValue(search.trim(), 250);

  return useQuery({
    queryKey: userKeys.list(debounced),
    queryFn: async ({ signal }) => {
      const response = await apiClient.get<Envelope<UserSummary[]>>('/users', {
        params: debounced ? { q: debounced } : undefined,
        signal,
      });
      return response.data.data;
    },
    // Keep the previous page of results on screen while the next query is in
    // flight, so the list does not flicker to empty on every keystroke.
    placeholderData: (previous) => previous,
    // A staff directory changes rarely.
    staleTime: 5 * 60 * 1000,
  });
}
