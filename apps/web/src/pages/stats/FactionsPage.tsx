import { EXPANSION_LABELS, EXPANSIONS, type Expansion } from '@mecatol/shared';
import { useQuery } from '@tanstack/react-query';
import { fetchFactionStats } from '../../api.js';
import { WinRateBars } from '../../components/lazyCharts.js';
import { FormError, inputClass } from '../../components/form.js';
import { StatsFilters, StatTable, useStatsFilter } from '../../components/stats.js';
import { queryKeys } from '../../queries.js';

const isExpansion = (v: string | null): v is Expansion => (EXPANSIONS as readonly string[]).includes(v ?? '');

export function FactionsPage() {
  const state = useStatsFilter();
  const { filter, params, set, search, ready } = state;
  const expansionParam = params.get('expansion');
  const expansion = isExpansion(expansionParam) ? expansionParam : undefined;
  const stats = useQuery({ queryKey: queryKeys.stats('factions', filter), queryFn: () => fetchFactionStats(filter), enabled: ready });

  const rows = (stats.data ?? []).filter((r) => !expansion || r.faction.expansion === expansion);
  const played = rows.filter((r) => r.games > 0);
  const bars = [...played]
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0) || b.games - a.games)
    .map((r) => ({ name: r.faction.name, winRate: r.winRate ?? 0, expected: r.expectedWinRate ?? 0, games: r.games, wins: r.wins }));

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Factions</h1>
        <p className="text-sm text-slate-500">
          Win rate against expected win rate (what you'd win by chance: 1 ÷ players, averaged over the games).
        </p>
      </div>
      <StatsFilters
        state={state}
        extra={
          <div className="w-48">
            <label className="block space-y-1">
              <span className="text-xs text-slate-500">Expansion</span>
              <select className={inputClass} value={expansion ?? ''} onChange={(e) => set('expansion', e.target.value)}>
                <option value="">All</option>
                {EXPANSIONS.map((x) => (
                  <option key={x} value={x}>
                    {EXPANSION_LABELS[x]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      />
      {stats.isError && <FormError message={stats.error.message} />}
      {!stats.data && !stats.isError && <p>Loading…</p>}
      {stats.data && (
        <>
          {played.length > 0 && (
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <h2 className="mb-3 font-medium">Win rate by faction</h2>
              <WinRateBars rows={bars} />
            </div>
          )}
          <StatTable
            nameLabel="Faction"
            empty="No factions match."
            rows={rows.map((r) => ({
              ...r,
              key: r.faction.id,
              name: r.faction.name,
              to: `/factions/${r.faction.id}${search}`,
              note: r.faction.archived ? 'archived' : undefined,
            }))}
          />
        </>
      )}
    </section>
  );
}
