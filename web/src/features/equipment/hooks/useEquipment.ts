import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/apiClient';
import type { Envelope, Equipment, EquipmentStatus } from '../../../types/api';

export const equipmentKeys = {
  all: ['equipment'] as const,
  list: (status?: EquipmentStatus) => ['equipment', 'list', status ?? 'all'] as const,
  detail: (id: string) => ['equipment', 'detail', id] as const,
};

async function fetchEquipment(status?: EquipmentStatus): Promise<Equipment[]> {
  const response = await apiClient.get<Envelope<Equipment[]>>('/equipment', {
    params: status ? { status } : undefined,
  });
  return response.data.data;
}

export function useEquipmentList(status?: EquipmentStatus) {
  return useQuery({
    queryKey: equipmentKeys.list(status),
    queryFn: () => fetchEquipment(status),
    // Equipment is reference data that changes rarely; refetching it on every
    // focus would be pure noise.
    staleTime: 5 * 60 * 1000,
  });
}

export function useEquipmentDetail(id: string) {
  return useQuery({
    queryKey: equipmentKeys.detail(id),
    queryFn: async () => {
      const response = await apiClient.get<Envelope<Equipment>>(`/equipment/${id}`);
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateEquipment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; code: string }) => {
      const response = await apiClient.post<Envelope<Equipment>>('/equipment', input);
      return response.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: equipmentKeys.all }),
  });
}
