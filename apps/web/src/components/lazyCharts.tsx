import { lazy, Suspense, type ComponentProps } from 'react';

// Recharts is large, so the charts load in their own chunk, only on pages that draw one.
const WinRateBarsImpl = lazy(() => import('./charts.js').then((m) => ({ default: m.WinRateBars })));
const TrendChartImpl = lazy(() => import('./charts.js').then((m) => ({ default: m.TrendChart })));

const fallback = <p className="text-sm text-slate-500">Loading chart…</p>;

export function WinRateBars(props: ComponentProps<typeof WinRateBarsImpl>) {
  return (
    <Suspense fallback={fallback}>
      <WinRateBarsImpl {...props} />
    </Suspense>
  );
}

export function TrendChart(props: ComponentProps<typeof TrendChartImpl>) {
  return (
    <Suspense fallback={fallback}>
      <TrendChartImpl {...props} />
    </Suspense>
  );
}
