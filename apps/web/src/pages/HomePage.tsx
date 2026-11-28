import type { StatLine } from '@mecatol/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { fetchFactionStats, fetchPlayerStats, fetchStatsOverview } from '../api.js';
import { FormError } from '../components/form.js';
import { RecentGames } from '../components/GamesTable.js';
import { formatDiff, formatNumber, formatRate, StatsFilters, StatTile, useStatsFilter } from '../components/stats.js';
import { playerLabels } from '../format.js';
import { queryKeys } from '../queries.js';
import { useMe } from '../useMe.js';

/** Fewer games than this and a win rate is mostly noise, so it isn't ranked. */
const MIN_RANKED_GAMES = 3;
const TOP_N = 5;

interface Ranked extends StatLine {
  key: number;
  name: string;
  to: string;
}

/** Highest win rate first among rows with enough games; ties go to the one with more games. */
function topRows(rows: readonly Ranked[]): Ranked[] {
  return rows
    .filter((r) => r.games >= MIN_RANKED_GAMES)
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0) || b.games - a.games)
    .slice(0, TOP_N);
}

function TopList({ title, rows, allLink, error }: { title: string; rows: Ranked[] | undefined; allLink: string; error: Error | null }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-medium">{title}</h2>
        <Link to={allLink} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          All →
        </Link>
      </div>
      {error && <FormError message={error.message} />}
      {!rows && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm text-slate-500">Nobody has {MIN_RANKED_GAMES} or more games yet.</p>}
      {rows && rows.length > 0 && (
        <ol className="space-y-2 text-sm">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-baseline gap-3">
              <span className="w-4 text-right text-slate-400 tabular-nums">{i + 1}</span>
              <Link to={r.to} className="flex-1 truncate text-indigo-600 hover:underline dark:text-indigo-400">
                {r.name}
              </Link>
              <span className="font-medium tabular-nums">{formatRate(r.winRate)}</span>
              <span className="w-24 text-right text-xs text-slate-500 tabular-nums">
                {formatDiff(r)} vs exp · {r.games}g
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-xs text-slate-500">
        By win rate, at least {MIN_RANKED_GAMES} games. "vs exp" is points above or below the expected win rate.
      </p>
    </div>
  );
}

export function HomePage() {
  const me = useMe();
  const state = useStatsFilter();
  const { filter, search, ready } = state;
  // Top players are your roster when signed in.
  const playerFilter = { ...filter, mine: me.data ? true : undefined };

  const overview = useQuery({ queryKey: queryKeys.stats('overview', filter), queryFn: () => fetchStatsOverview(filter), enabled: ready });
  const factions = useQuery({ queryKey: queryKeys.stats('factions', filter), queryFn: () => fetchFactionStats(filter), enabled: ready });
  const players = useQuery({
    queryKey: queryKeys.stats('players', playerFilter),
    queryFn: () => fetchPlayerStats(playerFilter),
    enabled: ready,
  });

  const labels = playerLabels((players.data ?? []).map((r) => r.player));
  const topFactions = factions.data && topRows(factions.data.map((r) => ({ ...r, key: r.faction.id, name: r.faction.name, to: `/factions/${r.faction.id}${search}` })));
  const topPlayers =
    players.data &&
    topRows(players.data.map((r) => ({ ...r, key: r.player.id, name: labels.get(r.player.id) ?? r.player.name, to: `/players/${r.player.id}${search}` })));
  const o = overview.data;

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Mecatol Ledger</h1>
          <p className="text-slate-600 dark:text-slate-400">Twilight Imperium games and win rates by player and faction.</p>
        </div>
        {me.data && (
          <Link to="/games/new" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            Log a game
          </Link>
        )}
      </div>

      <StatsFilters state={state} showDates={false} />

      {overview.isError && <FormError message={overview.error.message} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Games" value={o?.games ?? '–'} />
        <StatTile label="Players" value={o?.players ?? '–'} />
        <StatTile label="Factions played" value={o ? `${o.factionsPlayed}` : '–'} />
        <StatTile label="Average spread" value={formatNumber(o?.avgPointSpread ?? null)} hint="Winner's points − 2nd place" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TopList title="Top factions" rows={topFactions} allLink={`/factions${search}`} error={factions.error} />
        <TopList
          title={me.data ? 'Top players in your games' : 'Top players'}
          rows={topPlayers}
          allLink={`/players${search}`}
          error={players.error}
        />
      </div>

      <div className="space-y-3">
        <h2 className="font-medium">Recent games</h2>
        <RecentGames filter={filter} enabled={ready} />
      </div>
    </section>
  );
}
