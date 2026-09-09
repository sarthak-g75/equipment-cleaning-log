import { Link, Outlet } from 'react-router-dom';
import { Button } from '../components/Button';
import { useAuth } from '../features/auth/AuthContext';

export function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/equipment" className="text-sm font-semibold text-slate-900">
            Equipment Cleaning Log
          </Link>
          <div className="ml-auto flex items-center gap-3">
            {user && (
              <span className="text-xs text-slate-500">
                {user.name} · <span className="uppercase">{user.role}</span>
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
