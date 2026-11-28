import { useQuery } from '@tanstack/react-query';
import { fetchPlayerStats } from '../../api.js';
import { FormError } from '../../components/form.js';
import { StatsFilters, StatTable, useStatsFilter } from '../../components/stats.js';
import { playerLabels } from '../../format.js';
import { queryKeys } from '../../queries.js';

export function PlayersPage() {
  const state = useStatsFilter();
  const { filter, search, hasFilters, ready } = state;
  const stats = useQuery({ queryKey: queryKeys.stats('players', filter), queryFn: () => fetchPlayerStats(filter), enabled: ready });
  const labels = playerLabels((stats.data ?? []).map((r) => r.player));

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Players</h1>
        <p className="text-sm text-slate-500">Everyone with at least one game. Compare win rates within one player count where you can.</p>
      </div>
      <StatsFilters state={state} />
      {stats.isError && <FormError message={stats.error.message} />}
      {!stats.data && !stats.isError && <p>Loading…</p>}
      {stats.data && (
        <StatTable
          nameLabel="Player"
          empty={hasFilters ? 'No players have games matching these filters.' : 'No games logged yet.'}
          rows={stats.data.map((r) => ({
            ...r,
            key: r.player.id,
            name: labels.get(r.player.id) ?? r.player.name,
            to: `/players/${r.player.id}${search}`,
            note: r.player.archived ? 'archived' : undefined,
          }))}
        />
      )}
    </section>
  );
}
