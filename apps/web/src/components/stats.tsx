import { MAX_SEATS, MIN_SEATS, type StatLine } from '@mecatol/shared';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { StatsFilter } from '../api.js';
import { useMe } from '../useMe.js';
import { inputClass } from './form.js';

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

/** 0.4567 → "46%". */
export const formatRate = (rate: number | null) => (rate === null ? '–' : `${Math.round(rate * 100)}%`);

export const formatNumber = (n: number | null, digits = 1) => (n === null ? '–' : n.toFixed(digits));

/** Win rate minus expected, in percentage points: "+12" / "−5" / "0". */
export function formatDiff(line: Pick<StatLine, 'winRate' | 'expectedWinRate'>): string {
  const diff = rateDiff(line);
  if (diff === null) return '–';
  const pts = Math.round(diff * 100);
  return pts > 0 ? `+${pts}` : pts < 0 ? `−${-pts}` : '0';
}

export function rateDiff(line: Pick<StatLine, 'winRate' | 'expectedWinRate'>): number | null {
  return line.winRate === null || line.expectedWinRate === null ? null : line.winRate - line.expectedWinRate;
}

// ---------------------------------------------------------------------------------------------
// Filters, kept in the URL so a filtered view can be shared and survives reloads
// ---------------------------------------------------------------------------------------------

const FILTER_KEYS = ['playerCount', 'from', 'to', 'mine'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

export function readStatsFilter(params: URLSearchParams): StatsFilter {
  const n = Number(params.get('playerCount'));
  const date = (k: string) => {
    const v = params.get(k) ?? '';
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };
  return {
    playerCount: Number.isInteger(n) && n >= MIN_SEATS && n <= MAX_SEATS ? n : undefined,
    from: date('from'),
    to: date('to'),
    mine: params.get('mine') === 'true' || undefined,
  };
}

/**
 * The stats filter from the URL. `mine` is dropped while signed out, so a shared "mine" link
 * shows everything instead of failing. `search` carries the filters onto links to other stats pages.
 */
export function useStatsFilter() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const raw = readStatsFilter(params);
  const filter: StatsFilter = { ...raw, mine: me.data ? raw.mine : undefined };

  function set(key: string, value: string) {
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

  const search = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = filter[k];
    if (v !== undefined) search.set(k, String(v));
  }
  return {
    filter,
    params,
    set,
    clear: () => setParams({}, { replace: true }),
    hasFilters: [...params.keys()].length > 0,
    /** `?playerCount=…` for links, or ''. */
    search: search.size ? `?${search}` : '',
    /** Waits for the session check so a `mine` link doesn't fetch twice. */
    ready: !me.isPending,
  };
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}

/** One row of filters above the stats. `extra` adds page-specific controls (e.g. expansion). */
export function StatsFilters({
  state,
  extra,
  showDates = true,
}: {
  state: ReturnType<typeof useStatsFilter>;
  extra?: ReactNode;
  showDates?: boolean;
}) {
  const me = useMe();
  const { filter, set, clear, hasFilters } = state;
  const value = (k: FilterKey) => (filter[k] === undefined ? '' : String(filter[k]));
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-36">
        <FilterField label="Players in game">
          <select className={inputClass} value={value('playerCount')} onChange={(e) => set('playerCount', e.target.value)}>
            <option value="">Any</option>
            {Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, i) => i + MIN_SEATS).map((n) => (
              <option key={n} value={n}>
                {n} players
              </option>
            ))}
          </select>
        </FilterField>
      </div>
      {extra}
      {showDates && (
        <>
          <div className="w-40">
            <FilterField label="From">
              <input type="date" className={inputClass} value={value('from')} onChange={(e) => set('from', e.target.value)} />
            </FilterField>
          </div>
          <div className="w-40">
            <FilterField label="To">
              <input type="date" className={inputClass} value={value('to')} onChange={(e) => set('to', e.target.value)} />
            </FilterField>
          </div>
        </>
      )}
      <div className="flex flex-col gap-1 pb-2 text-sm">
        {me.data && (
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4" checked={!!filter.mine} onChange={(e) => set('mine', e.target.checked ? 'true' : '')} />
            Only games I logged
          </label>
        )}
        {hasFilters && (
          <button type="button" className="self-start text-indigo-600 hover:underline dark:text-indigo-400" onClick={clear}>
            Clear filters
          </button>
        )}
      </div>
      {(filter.from || filter.to) && <p className="basis-full text-xs text-slate-500">Date filters leave out games with no date.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Tiles and tables
// ---------------------------------------------------------------------------------------------

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

/** Totals for one faction or player as a row of tiles. */
export function StatTiles({ line }: { line: StatLine }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile label="Games" value={line.games} hint={`${line.wins} won`} />
      <StatTile label="Win rate" value={formatRate(line.winRate)} hint={line.games ? `${formatDiff(line)} pts vs expected` : undefined} />
      <StatTile label="Expected win rate" value={formatRate(line.expectedWinRate)} hint="1 ÷ players, averaged" />
      <StatTile label="Average points" value={formatNumber(line.avgPoints)} />
    </div>
  );
}

export interface StatRow extends StatLine {
  key: number;
  name: string;
  /** Link target for the name. */
  to: string;
  /** Shown after the name, e.g. "archived" or a roster owner. */
  note?: string | undefined;
}

type SortKey = 'name' | 'games' | 'winRate' | 'diff' | 'avgPoints';

const sortValue = (r: StatRow, key: Exclude<SortKey, 'name'>): number | null => (key === 'diff' ? rateDiff(r) : r[key]);

function sortRows(rows: readonly StatRow[], key: SortKey, desc: boolean): StatRow[] {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (key === 'name') return dir * a.name.localeCompare(b.name);
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    // Rows with no games always sink to the bottom, whichever way the column is sorted.
    if (av === null || bv === null) return (av === null ? 1 : 0) - (bv === null ? 1 : 0);
    return dir * (av - bv) || b.games - a.games;
  });
}

/**
 * A sortable record table. Rows arrive most-played first; clicking a header sorts by that column.
 * "± exp." is win rate minus expected win rate, in percentage points.
 */
export function StatTable({ rows, nameLabel, empty }: { rows: readonly StatRow[]; nameLabel: string; empty: ReactNode }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null);
  const shown = sort ? sortRows(rows, sort.key, sort.desc) : rows;

  if (rows.length === 0) return <p className="text-slate-500">{empty}</p>;

  const header = (key: SortKey, label: string, right = true) => {
    const active = sort?.key === key;
    return (
      <th className={`py-2 pr-3 font-medium ${right ? 'text-right' : ''}`} aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
        <button
          type="button"
          className="hover:text-slate-900 dark:hover:text-slate-100"
          onClick={() => setSort({ key, desc: active ? !sort.desc : key !== 'name' })}
        >
          {label}
          {active ? (sort.desc ? ' ↓' : ' ↑') : ''}
        </button>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800">
          <tr>
            {header('name', nameLabel, false)}
            {header('games', 'Games')}
            <th className="py-2 pr-3 text-right font-medium">Wins</th>
            {header('winRate', 'Win rate')}
            <th className="py-2 pr-3 text-right font-medium">Expected</th>
            {header('diff', '± exp.')}
            {header('avgPoints', 'Avg pts')}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const diff = rateDiff(r);
            return (
              <tr key={r.key} className="border-b border-slate-100 hover:bg-slate-100 dark:border-slate-900 dark:hover:bg-slate-900">
                <td className="py-2 pr-3">
                  <Link to={r.to} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {r.name}
                  </Link>
                  {r.note && <span className="ml-2 text-xs text-slate-500">{r.note}</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.games}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.wins}</td>
                <td className="py-2 pr-3 text-right font-medium tabular-nums">{formatRate(r.winRate)}</td>
                <td className="py-2 pr-3 text-right text-slate-500 tabular-nums">{formatRate(r.expectedWinRate)}</td>
                <td
                  className={`py-2 pr-3 text-right tabular-nums ${
                    diff === null || Math.abs(diff) < 0.005 ? 'text-slate-500' : diff > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {formatDiff(r)}
                </td>
                <td className="py-2 text-right tabular-nums">{formatNumber(r.avgPoints)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
