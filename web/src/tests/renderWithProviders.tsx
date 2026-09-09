import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../features/auth/AuthContext';

interface Options {
  route?: string;
  path?: string;
}

/**
 * Renders through the same providers the real app uses, so tests exercise the
 * actual query/router/auth wiring rather than a simplified stand-in.
 */
export function renderWithProviders(ui: ReactElement, { route = '/', path }: Options = {}) {
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
        <AuthProvider>
          {path ? <Routes><Route path={path} element={children} /></Routes> : children}
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return render(ui, { wrapper: Wrapper });
}
