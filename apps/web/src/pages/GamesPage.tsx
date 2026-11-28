import { MAX_SEATS, MIN_SEATS } from '@mecatol/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { fetchGames, type GamesFilter } from '../api.js';
import { FormError, inputClass } from '../components/form.js';
import { formatDate, playerLabels } from '../format.js';
import { queryKeys, useFactions, usePlayers } from '../queries.js';
import { useMe } from '../useMe.js';

const FILTER_KEYS = ['playerId', 'factionId', 'playerCount', 'from', 'to', 'mine'] as const;

function readFilter(params: URLSearchParams): GamesFilter {
  const int = (k: string) => {
    const n = Number(params.get(k));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const date = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(params.get(k) ?? '') ? (params.get(k) ?? undefined) : undefined);
  return {
    playerId: int('playerId'),
    factionId: int('factionId'),
    playerCount: int('playerCount'),
    from: date('from'),
    to: date('to'),
    mine: params.get('mine') === 'true' || undefined,
  };
}

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function GamesPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const filter = readFilter(params);
  const players = usePlayers();
  const factions = useFactions();
  const labels = playerLabels(players.data ?? []);
  const games = useInfiniteQuery({
    queryKey: [...queryKeys.games, filter],
    queryFn: ({ pageParam }) => fetchGames(filter, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
  });

  function set(key: (typeof FILTER_KEYS)[number], value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }

  const hasFilters = FILTER_KEYS.some((k) => params.has(k));
  const rows = games.data?.pages.flatMap((p) => p.games) ?? [];

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Games</h1>
        {me.data && (
          <Link to="/games/new" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            Log a game
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Filter label="Player">
          <select className={inputClass} value={filter.playerId ?? ''} onChange={(e) => set('playerId', e.target.value)}>
            <option value="">Anyone</option>
            {players.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {labels.get(p.id)}
              </option>
            ))}
          </select>
        </Filter>
        <Filter label="Faction">
          <select className={inputClass} value={filter.factionId ?? ''} onChange={(e) => set('factionId', e.target.value)}>
            <option value="">Any</option>
            {factions.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Filter>
        <Filter label="Players in game">
          <select className={inputClass} value={filter.playerCount ?? ''} onChange={(e) => set('playerCount', e.target.value)}>
            <option value="">Any</option>
            {Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, i) => i + MIN_SEATS).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Filter>
        <Filter label="From">
          <input type="date" className={inputClass} value={filter.from ?? ''} onChange={(e) => set('from', e.target.value)} />
        </Filter>
        <Filter label="To">
          <input type="date" className={inputClass} value={filter.to ?? ''} onChange={(e) => set('to', e.target.value)} />
        </Filter>
        <div className="flex flex-col justify-end gap-1 pb-2 text-sm">
          {me.data && (
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4" checked={!!filter.mine} onChange={(e) => set('mine', e.target.checked ? 'true' : '')} />
              Only games I logged
            </label>
          )}
          {hasFilters && (
            <button type="button" className="self-start text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setParams({}, { replace: true })}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {games.isError && <FormError message={games.error.message} />}
      {games.isPending && <p>Loading…</p>}
      {games.data && rows.length === 0 && (
        <p className="text-slate-500">
          {hasFilters ? 'No games match these filters.' : 'No games logged yet.'}{' '}
          {me.data && !hasFilters && (
            <Link to="/games/new" className="text-indigo-600 hover:underline dark:text-indigo-400">
              Log the first one.
            </Link>
          )}
        </p>
      )}
      {rows.length > 0 && (
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
              {rows.map((g) => (
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
          {rows.some((g) => g.endedEarly) && <p className="mt-2 text-xs text-slate-500">* ended early</p>}
        </div>
      )}
      {games.hasNextPage && (
        <button
          type="button"
          onClick={() => void games.fetchNextPage()}
          disabled={games.isFetchingNextPage}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
        >
          {games.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
