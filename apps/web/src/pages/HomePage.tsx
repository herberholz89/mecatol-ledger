import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../api.js';

export function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Mecatol Ledger</h1>
      <p className="text-slate-600 dark:text-slate-400">
        Log your Twilight Imperium games and see win rates by player and faction. Coming soon.
      </p>
      <div className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-800">
        <h2 className="mb-2 font-medium">System status</h2>
        {health.isPending && <p>Checking…</p>}
        {health.isError && <p className="text-red-600">API unreachable.</p>}
        {health.data && (
          <ul className="space-y-1">
            <li>API: {health.data.status}</li>
            <li>Database: {health.data.database}</li>
            {health.data.factionCount !== null && <li>Factions loaded: {health.data.factionCount}</li>}
          </ul>
        )}
      </div>
    </section>
  );
}
