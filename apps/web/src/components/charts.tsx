import { runningWinRate, type SeatResult } from '@mecatol/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type TooltipContentProps,
} from 'recharts';
import { formatRate } from './stats.js';

// Colors are CSS variables from index.css, so light and dark mode each get their own steps.
const SERIES = 'var(--chart-series-1)';
const REFERENCE = 'var(--chart-reference)';
const GRID = 'var(--chart-grid)';
const INK = 'var(--chart-ink)';
const tick = { fill: INK, fontSize: 12 };
const percentTicks = [0, 0.25, 0.5, 0.75, 1];

/** `expected` matches how the chart draws it: a tick on each bar, or a dashed line. */
function Legend({ expected }: { expected: 'tick' | 'line' }) {
  return (
    <div className="flex gap-4 text-xs text-slate-600 dark:text-slate-400">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: SERIES }} />
        Win rate
      </span>
      <span className="flex items-center gap-1.5">
        {expected === 'tick' ? (
          <span className="inline-block h-3 w-0 border-l-2" style={{ borderColor: REFERENCE }} />
        ) : (
          <span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: REFERENCE }} />
        )}
        Expected (1 ÷ players)
      </span>
    </div>
  );
}

function TooltipBox({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-1 font-medium text-slate-900 dark:text-slate-100">{title}</div>
      {lines.map((l) => (
        <div key={l} className="text-slate-600 dark:text-slate-400">
          {l}
        </div>
      ))}
    </div>
  );
}

export interface WinRateBar {
  name: string;
  winRate: number;
  expected: number;
  games: number;
  wins: number;
}

/**
 * The win-rate bar, plus a tick at the expected win rate. The bar's background spans the whole
 * 0–100% axis, so the tick's position is a fraction of it (this also works for a 0% bar).
 */
function BarWithExpected(props: BarShapeProps) {
  const { x, y, width, height, background } = props as BarShapeProps & {
    x: number;
    y: number;
    width: number;
    height: number;
    background?: { x: number; width: number };
  };
  const payload = props.payload as WinRateBar;
  const r = Math.min(4, width / 2, height / 2);
  const tickX = background ? background.x + background.width * payload.expected : null;
  return (
    <g>
      {width > 0 && (
        <path
          d={`M${x},${y} h${width - r} a${r},${r} 0 0 1 ${r},${r} v${height - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${width - r} z`}
          fill={SERIES}
        />
      )}
      {tickX !== null && <line x1={tickX} x2={tickX} y1={y - 3} y2={y + height + 3} stroke={REFERENCE} strokeWidth={2} />}
    </g>
  );
}

function BarTooltip({ active, payload }: TooltipContentProps) {
  const row = active ? (payload[0]?.payload as WinRateBar | undefined) : undefined;
  if (!row) return null;
  return (
    <TooltipBox
      title={row.name}
      lines={[`Win rate ${formatRate(row.winRate)} (${row.wins} of ${row.games})`, `Expected ${formatRate(row.expected)}`]}
    />
  );
}

/** Horizontal bars of win rate against expected, one per row, in the order given. */
export function WinRateBars({ rows }: { rows: readonly WinRateBar[] }) {
  if (rows.length === 0) return null;
  return (
    <figure className="space-y-2">
      <Legend expected="tick" />
      <ResponsiveContainer width="100%" height={rows.length * 26 + 32}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis
            type="number"
            domain={[0, 1]}
            ticks={percentTicks}
            tickFormatter={(v: number) => formatRate(v)}
            tick={tick}
            axisLine={false}
            tickLine={false}
          />
          <YAxis type="category" dataKey="name" width={170} tick={tick} axisLine={false} tickLine={false} interval={0} />
          <Tooltip content={BarTooltip} cursor={{ fill: GRID, fillOpacity: 0.5 }} isAnimationActive={false} />
          <Bar dataKey="winRate" shape={BarWithExpected} background={{ fill: 'transparent' }} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

type TrendPoint = ReturnType<typeof runningWinRate>[number];

function TrendTooltip({ active, payload }: TooltipContentProps) {
  const point = active ? (payload[0]?.payload as TrendPoint | undefined) : undefined;
  if (!point) return null;
  return <TooltipBox title={`After game ${point.game}`} lines={[`Win rate ${formatRate(point.winRate)}`, `Expected ${formatRate(point.expected)}`]} />;
}

/** Running win rate after each game, oldest first, against the running expected win rate. */
export function TrendChart({ results }: { results: readonly SeatResult[] }) {
  if (results.length < 2) return <p className="text-sm text-slate-500">A trend needs at least two games.</p>;
  const data = runningWinRate(results);
  return (
    <figure className="space-y-2">
      <Legend expected="line" />
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="game" tick={tick} axisLine={{ stroke: GRID }} tickLine={false} minTickGap={24} />
          <YAxis domain={[0, 1]} ticks={percentTicks} tickFormatter={(v: number) => formatRate(v)} tick={tick} axisLine={false} tickLine={false} width={44} />
          <Tooltip content={TrendTooltip} cursor={{ stroke: INK, strokeWidth: 1 }} isAnimationActive={false} />
          <Line type="linear" dataKey="expected" stroke={REFERENCE} strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
          <Line type="linear" dataKey="winRate" stroke={SERIES} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <figcaption className="text-xs text-slate-500">Game number, oldest first. Games with no date count as the oldest.</figcaption>
    </figure>
  );
}
