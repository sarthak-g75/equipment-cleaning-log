import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '../components/Button';
import { Field, inputClass } from '../components/Field';
import { useAuth } from '../features/auth/AuthContext';
import { ApiError } from '../services/apiClient';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('alice@example.com');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/equipment';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      // Return the user to wherever they were headed before the redirect.
      navigate(from, { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not sign in. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-4">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Equipment Cleaning Log</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue.</p>
        </div>

        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            autoComplete="username"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Field label="Password" htmlFor="password">
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 p-2 text-xs font-medium text-red-800">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>

        <p className="text-center text-xs text-slate-500">
          Seeded users: <code>alice@example.com</code> (QA) or <code>bob@example.com</code>{' '}
          (operator) — password <code>password123</code>.
        </p>
      </form>
    </main>
  );
}
