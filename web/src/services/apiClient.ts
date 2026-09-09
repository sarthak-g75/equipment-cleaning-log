import axios, { AxiosError, type AxiosInstance } from 'axios';

export interface ApiErrorDetail {
  field: string;
  message: string;
}

/**
 * One normalised error shape for the whole app, so components and hooks never
 * have to know they are talking to Axios.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages keyed by the form field they belong to. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(
      this.details.map((detail) => [detail.field.replace(/^body\./, ''), detail.message]),
    );
  }
}

/**
 * Held in memory rather than localStorage: a token in localStorage is readable
 * by any injected script. The cost is that a refresh requires logging in again,
 * which is an accepted trade-off here (see NOTES.md).
 */
let accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const getAccessToken = (): string | null => accessToken;

let onUnauthenticated: (() => void) | null = null;

export const setUnauthenticatedHandler = (handler: (() => void) | null): void => {
  onUnauthenticated = handler;
};

export const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1',
  timeout: 15_000,
});

apiClient.interceptors.request.use((request) => {
  if (accessToken) {
    request.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return request;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: { code: string; message: string; details?: ApiErrorDetail[] } }>) => {
    if (!error.response) {
      return Promise.reject(
        new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Is the API running?'),
      );
    }

    const { status, data } = error.response;
    const body = data?.error;

    // A 401 means the token is gone or expired: drop it and let the auth layer
    // send the user back to the login screen, rather than leaving every
    // subsequent query to fail individually.
    if (status === 401) {
      accessToken = null;
      onUnauthenticated?.();
    }

    return Promise.reject(
      new ApiError(
        status,
        body?.code ?? 'UNKNOWN_ERROR',
        body?.message ?? 'Something went wrong.',
        body?.details ?? [],
      ),
    );
  },
);
