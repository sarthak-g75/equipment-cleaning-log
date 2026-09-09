import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../features/auth/AuthContext';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { AppLayout } from '../layouts/AppLayout';
import { LoginPage } from '../pages/LoginPage';
import { EquipmentListPage } from '../pages/EquipmentListPage';
import { EquipmentDetailPage } from '../pages/EquipmentDetailPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { ErrorBoundary } from './ErrorBoundary';
import { ApiError } from '../services/apiClient';

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
                  <Route path="/equipment" element={<EquipmentListPage />} />
                  <Route path="/equipment/:equipmentId" element={<EquipmentDetailPage />} />
                  <Route path="*" element={<NotFoundPage />} />
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
