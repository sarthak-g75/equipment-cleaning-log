import { Suspense, lazy } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../features/auth/AuthContext';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { AppLayout } from '../layouts/AppLayout';
import { LoginPage } from '../pages/LoginPage';
import { LoadingRows } from '../components/States';
import { ErrorBoundary } from './ErrorBoundary';
import { ApiError } from '../services/apiClient';

/**
 * Split at the route boundary. The login page is eager because it is the first
 * thing an unauthenticated visitor needs; everything behind the auth gate is
 * fetched only once the user actually navigates there, so the initial download
 * is not carrying the whole application.
 */
const EquipmentListPage = lazy(() =>
  import('../pages/EquipmentListPage').then((m) => ({ default: m.EquipmentListPage })),
);
const EquipmentDetailPage = lazy(() =>
  import('../pages/EquipmentDetailPage').then((m) => ({ default: m.EquipmentDetailPage })),
);
const NotFoundPage = lazy(() =>
  import('../pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retrying a 4xx just delays the error the user needs to see; only
      // transient failures are worth a second attempt.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  {/* A skeleton rather than a spinner: it holds the layout, so
                      arriving content does not shift the page. */}
                  <Route
                    path="/equipment"
                    element={
                      <Suspense fallback={<LoadingRows rows={4} label="Loading page" />}>
                        <EquipmentListPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/equipment/:equipmentId"
                    element={
                      <Suspense fallback={<LoadingRows rows={5} label="Loading page" />}>
                        <EquipmentDetailPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="*"
                    element={
                      <Suspense fallback={null}>
                        <NotFoundPage />
                      </Suspense>
                    }
                  />
                </Route>
              </Route>
              <Route path="/" element={<Navigate to="/equipment" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
