import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { fetchPlayer, fetchPlayerStatsDetail } from '../../api.js';
import { TrendChart } from '../../components/lazyCharts.js';
import { FormError } from '../../components/form.js';
import { RecentGames } from '../../components/GamesTable.js';
import { ClaimControl, ManagePlayer } from '../../components/PlayerTools.js';
import { StatsFilters, StatTable, StatTiles, useStatsFilter } from '../../components/stats.js';
import { queryKeys } from '../../queries.js';

export function PlayerDetailPage() {
  const id = Number(useParams().id);
  const state = useStatsFilter();
  const { filter, search, ready } = state;
  const detail = useQuery({
    queryKey: queryKeys.stats('player', id, filter),
    queryFn: () => fetchPlayerStatsDetail(id, filter),
    enabled: ready && Number.isInteger(id),
  });
  // Claim and roster details; the stats response carries only the basics.
  const rosterPlayer = useQuery({ queryKey: queryKeys.player(id), queryFn: () => fetchPlayer(id), enabled: Number.isInteger(id) });

  if (detail.isError) return <FormError message={detail.error.message} />;
  if (!detail.data) return <p>Loading…</p>;
  const { player, totals, factions, results } = detail.data;

  return (
    <section className="space-y-8">
      <div>
        <Link to={`/players${search}`} className="text-sm text-slate-500 hover:underline">
          ← Players
        </Link>
        <h1 className="text-2xl font-semibold">{player.name}</h1>
        <p className="text-sm text-slate-500">
          In {player.ownerName ?? 'an unnamed user'}'s roster
          {player.archived && ' · archived'}
        </p>
        {rosterPlayer.data && (
          <div className="mt-2">
            <ClaimControl player={rosterPlayer.data} />
          </div>
        )}
      </div>
      <StatsFilters state={state} />
      <StatTiles line={totals} />
      <div className="space-y-3">
        <h2 className="font-medium">Win rate over time</h2>
        <TrendChart results={results} />
      </div>
      <div className="space-y-3">
        <h2 className="font-medium">Record by faction</h2>
        <StatTable
          nameLabel="Faction"
          empty="No games yet."
          rows={factions.map((r) => ({ ...r, key: r.faction.id, name: r.faction.name, to: `/factions/${r.faction.id}${search}` }))}
        />
      </div>
      <div className="space-y-3">
        <h2 className="font-medium">History</h2>
        <RecentGames filter={{ ...filter, playerId: player.id }} limit={10} />
      </div>
      {rosterPlayer.data && <ManagePlayer player={rosterPlayer.data} />}
    </section>
  );
}
