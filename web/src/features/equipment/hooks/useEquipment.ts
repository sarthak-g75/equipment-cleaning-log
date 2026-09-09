import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/apiClient';
import type { Envelope, Equipment, EquipmentStatus } from '../../../types/api';
import type { EquipmentFormValues } from '../validators/equipmentSchema';

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
    mutationFn: async (input: EquipmentFormValues) => {
      const response = await apiClient.post<Envelope<Equipment>>('/equipment', input);
      return response.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: equipmentKeys.all }),
  });
}

export function useUpdateEquipment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: EquipmentFormValues }) => {
      const response = await apiClient.patch<Envelope<Equipment>>(`/equipment/${id}`, values);
      return response.data.data;
    },
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: equipmentKeys.all });
      queryClient.setQueryData(equipmentKeys.detail(updated.id), updated);
    },
  });
}

export function useDeleteEquipment() {
  const queryClient = useQueryClient();
  return useMutation({
    // The API refuses (409 EQUIPMENT_IN_USE) when the equipment has cleaning
    // records, because deleting it would orphan an audit trail. The caller
    // surfaces that message rather than treating it as an unexpected failure.
    mutationFn: async (id: string) => {
      await apiClient.delete(`/equipment/${id}`);
      return id;
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: equipmentKeys.all });
      queryClient.removeQueries({ queryKey: equipmentKeys.detail(id) });
    },
  });
}
