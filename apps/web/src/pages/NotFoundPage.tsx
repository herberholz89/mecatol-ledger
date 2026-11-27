import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="text-amber-600 underline">
        Back home
      </Link>
    </section>
  );
}
