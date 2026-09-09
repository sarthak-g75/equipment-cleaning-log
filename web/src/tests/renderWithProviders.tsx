import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../features/auth/AuthContext';
import type { AuthUser } from '../types/api';

/** The seeded QA user, for pages whose controls are role-gated. */
export const QA_USER: AuthUser = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Alice Chen',
  email: 'alice@example.com',
  role: 'qa',
};

/** The seeded operator, who may log cleanings but not manage equipment. */
export const OPERATOR_USER: AuthUser = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Bob Novak',
  email: 'bob@example.com',
  role: 'operator',
};

interface Options {
  route?: string;
  path?: string;
  /** Renders as this identity, so role-gated UI can be exercised. */
  user?: AuthUser | null;
}

/**
 * Renders through the same providers the real app uses, so tests exercise the
 * actual query/router/auth wiring rather than a simplified stand-in.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', path, user = null }: Options = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      // Retries turn an asserted failure into a multi-second timeout.
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider initialUser={user}>
          {path ? <Routes><Route path={path} element={children} /></Routes> : children}
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return render(ui, { wrapper: Wrapper });
}
