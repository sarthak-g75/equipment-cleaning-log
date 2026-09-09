import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-lg font-semibold text-slate-900">Page not found</h1>
      <Link to="/equipment" className="mt-2 inline-block text-sm text-brand-600 hover:underline">
        Back to equipment
      </Link>
    </div>
  );
}
