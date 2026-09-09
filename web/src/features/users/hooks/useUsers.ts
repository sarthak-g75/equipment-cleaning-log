import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../services/apiClient';
import type { AuthUser, Envelope } from '../../../types/api';

export const userKeys = {
  all: ['users'] as const,
  list: () => ['users', 'list'] as const,
};

export function useUsers() {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: async () => {
      const response = await apiClient.get<Envelope<AuthUser[]>>('/users');
      return response.data.data;
    },
    // A staff directory changes rarely; refetching it every time a form opens
    // would be noise.
    staleTime: 10 * 60 * 1000,
  });
}
