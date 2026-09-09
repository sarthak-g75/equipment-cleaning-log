import { http, HttpResponse } from 'msw';
import type { CleaningRecord, UserSummary } from '../types/api';

export const API = 'http://localhost:4000/api/v1';

export const BOB: UserSummary = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Bob Novak',
  email: 'bob@example.com',
  role: 'operator',
};

export const ALICE: UserSummary = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Alice Chen',
  email: 'alice@example.com',
  role: 'qa',
};

export const makeRecord = (overrides: Partial<CleaningRecord> = {}): CleaningRecord => ({
  id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
  equipmentId: 'eq-1',
  cleanedById: BOB.id,
  cleanedBy: BOB,
  cleanedAt: '2026-08-24T08:00:00.000Z',
  method: 'CIP - caustic',
  notes: 'Swab passed',
  status: 'pending',
  createdAt: '2026-08-24T08:05:00.000Z',
  updatedAt: '2026-08-24T08:05:00.000Z',
  ...overrides,
});

export const USERS: UserSummary[] = [BOB, ALICE];

export const handlers = [
  /**
   * Filters server-side, the way the real endpoint does. A handler that ignored
   * `q` would let a client-side-filtering regression pass unnoticed, which is
   * exactly the bug this mirrors: the picker used to fetch the whole (capped)
   * directory once and filter it in the browser.
   */
  http.get(`${API}/users`, ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.toLowerCase() ?? '';
    const limit = Number(url.searchParams.get('limit') ?? 50);

    const matches = USERS.filter(
      (u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    ).slice(0, limit);

    return HttpResponse.json({ data: matches });
  }),

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
