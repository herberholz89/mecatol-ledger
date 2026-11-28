import type { GameSummary } from '@mecatol/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { fetchGames, type GamesFilter } from '../api.js';
import { formatDate } from '../format.js';
import { queryKeys } from '../queries.js';
import { FormError } from './form.js';

/** Date, winner, winning faction, player count, score and spread; each date links to the game. */
export function GamesTable({ games }: { games: readonly GameSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800">
          <tr>
            <th className="py-2 pr-3 font-medium">Date</th>
            <th className="py-2 pr-3 font-medium">Winner</th>
            <th className="py-2 pr-3 font-medium">Faction</th>
            <th className="py-2 pr-3 text-right font-medium">Players</th>
            <th className="py-2 pr-3 text-right font-medium">Score</th>
            <th className="py-2 text-right font-medium">Spread</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr key={g.id} className="border-b border-slate-100 hover:bg-slate-100 dark:border-slate-900 dark:hover:bg-slate-900">
              <td className="py-2 pr-3 whitespace-nowrap">
                <Link to={`/games/${g.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {formatDate(g.playedOn)}
                </Link>
              </td>
              <td className="py-2 pr-3">{g.winner.player.name}</td>
              <td className="py-2 pr-3">{g.winner.faction.name}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{g.playerCount}</td>
              <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                {g.winner.points}/{g.vpTarget}
                {g.endedEarly && <span title="Ended early"> *</span>}
              </td>
              <td className="py-2 text-right tabular-nums">{g.pointSpread}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {games.some((g) => g.endedEarly) && <p className="mt-2 text-xs text-slate-500">* ended early</p>}
    </div>
  );
}

/** The newest few games matching a filter, with a link to the full filtered list. */
export function RecentGames({ filter, limit = 5, enabled = true }: { filter: GamesFilter; limit?: number; enabled?: boolean }) {
  const games = useQuery({
    queryKey: [...queryKeys.games, 'recent', filter, limit],
    queryFn: () => fetchGames(filter, 0, limit),
    enabled,
  });
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(filter) as [string, unknown][]) if (v !== undefined && v !== false) search.set(k, String(v));

  if (games.isError) return <FormError message={games.error.message} />;
  if (!games.data) return <p className="text-sm text-slate-500">Loading…</p>;
  if (games.data.games.length === 0) return <p className="text-sm text-slate-500">No games yet.</p>;
  return (
    <div className="space-y-2">
      <GamesTable games={games.data.games} />
      {games.data.nextOffset !== null && (
        <Link to={`/games${search.size ? `?${search}` : ''}`} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          All games →
        </Link>
      )}
    </div>
  );
}
