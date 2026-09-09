import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient, setAccessToken, setUnauthenticatedHandler } from '../../services/apiClient';
import type { AuthUser, Envelope } from '../../types/api';

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const queryClient = useQueryClient();

  const logout = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    // Drop every cached server response, so the next user to log in on this
    // browser cannot see the previous one's data flash on screen.
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setUnauthenticatedHandler(logout);
    return () => setUnauthenticatedHandler(null);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.post<Envelope<{ token: string; user: AuthUser }>>(
      '/auth/login',
      { email, password },
    );
    setAccessToken(response.data.data.token);
    setUser(response.data.data.user);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthenticated: user !== null, login, logout }),
    [user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
