import { http, HttpResponse } from 'msw';
import type { CleaningRecord } from '../types/api';

export const API = 'http://localhost:4000/api/v1';

export const makeRecord = (overrides: Partial<CleaningRecord> = {}): CleaningRecord => ({
  id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
  equipmentId: 'eq-1',
  cleanedBy: 'B. Novak',
  cleanedAt: '2026-08-24T08:00:00.000Z',
  method: 'CIP - caustic',
  notes: 'Swab passed',
  status: 'pending',
  createdAt: '2026-08-24T08:05:00.000Z',
  updatedAt: '2026-08-24T08:05:00.000Z',
  ...overrides,
});

export const handlers = [
  http.get(`${API}/equipment/:id`, ({ params }) =>
    HttpResponse.json({
      data: {
        id: params.id,
        name: 'Bioreactor 101',
        code: 'BR-101',
        status: 'active',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    }),
  ),
];
