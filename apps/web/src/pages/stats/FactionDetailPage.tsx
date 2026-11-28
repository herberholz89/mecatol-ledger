import { EXPANSION_LABELS } from '@mecatol/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { fetchFactionStatsDetail } from '../../api.js';
import { TrendChart } from '../../components/lazyCharts.js';
import { FormError } from '../../components/form.js';
import { RecentGames } from '../../components/GamesTable.js';
import { StatsFilters, StatTable, StatTiles, useStatsFilter } from '../../components/stats.js';
import { playerLabels } from '../../format.js';
import { queryKeys } from '../../queries.js';

export function FactionDetailPage() {
  const id = Number(useParams().id);
  const state = useStatsFilter();
  const { filter, search, ready } = state;
  const detail = useQuery({
    queryKey: queryKeys.stats('faction', id, filter),
    queryFn: () => fetchFactionStatsDetail(id, filter),
    enabled: ready && Number.isInteger(id),
  });

  if (detail.isError) return <FormError message={detail.error.message} />;
  if (!detail.data) return <p>Loading…</p>;
  const { faction, totals, players, results } = detail.data;
  const labels = playerLabels(players.map((r) => r.player));

  return (
    <section className="space-y-8">
      <div>
        <Link to={`/factions${search}`} className="text-sm text-slate-500 hover:underline">
          ← Factions
        </Link>
        <h1 className="text-2xl font-semibold">{faction.name}</h1>
        <p className="text-sm text-slate-500">
          {EXPANSION_LABELS[faction.expansion]}
          {faction.archived && ' · archived'}
        </p>
      </div>
      <StatsFilters state={state} />
      <StatTiles line={totals} />
      <div className="space-y-3">
        <h2 className="font-medium">Win rate over time</h2>
        <TrendChart results={results} />
      </div>
      <div className="space-y-3">
        <h2 className="font-medium">Who plays it</h2>
        <StatTable
          nameLabel="Player"
          empty="Nobody has played this faction yet."
          rows={players.map((r) => ({ ...r, key: r.player.id, name: labels.get(r.player.id) ?? r.player.name, to: `/players/${r.player.id}${search}` }))}
        />
      </div>
      <div className="space-y-3">
        <h2 className="font-medium">Recent games</h2>
        <RecentGames filter={{ ...filter, factionId: faction.id }} limit={10} />
      </div>
    </section>
  );
}
