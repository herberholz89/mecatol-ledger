import { parseTab } from '@mecatol/shared';
import { useMemo } from 'react';
import { buttonClass } from '../../components/form.js';
import type { LoadedFile } from './ImportPage.js';

export const secondaryButtonClass =
  'rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900';

export function TabsStep({
  file,
  selected,
  onChange,
  onReorder,
  onBack,
  onNext,
}: {
  file: LoadedFile;
  selected: string[];
  onChange: (tabs: string[]) => void;
  onReorder: (file: LoadedFile) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const counts = useMemo(() => new Map(file.tabs.map((t) => [t.name, parseTab(t).length])), [file]);
  const total = selected.reduce((n, name) => n + (counts.get(name) ?? 0), 0);

  function moveUp(i: number) {
    const tabs = [...file.tabs];
    const [tab] = tabs.splice(i, 1);
    if (tab) tabs.splice(i - 1, 0, tab);
    onReorder({ ...file, tabs });
  }

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm">
        <span className="font-medium">{file.name}</span>: pick the tabs that hold games. Tabs with totals or other data are left out.
      </p>
      <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {file.tabs.map((tab, i) => (
          <li key={tab.name} className="flex items-center gap-2 pr-2">
            <label className="flex flex-1 items-center gap-3 px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={selected.includes(tab.name)}
                onChange={(e) => onChange(e.target.checked ? [...selected, tab.name] : selected.filter((n) => n !== tab.name))}
              />
              <span className="flex-1">{tab.name}</span>
              <span className="text-slate-500">
                {counts.get(tab.name) ? `${counts.get(tab.name)} possible ${counts.get(tab.name) === 1 ? 'game' : 'games'}` : 'no games found'}
              </span>
            </label>
            <button
              type="button"
              className="rounded px-1 text-slate-400 hover:text-slate-900 disabled:invisible dark:hover:text-slate-100"
              aria-label={`Move ${tab.name} up`}
              title="Import earlier"
              disabled={i === 0}
              onClick={() => moveUp(i)}
            >
              ↑
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">Games are imported in this order, top to bottom. Undated games are listed newest-imported first, so put older tabs at the top.</p>
      <div className="flex gap-3">
        <button type="button" className={secondaryButtonClass} onClick={onBack}>
          Choose another file
        </button>
        <button type="button" className={buttonClass} disabled={total === 0} onClick={onNext}>
          Next: match names
        </button>
      </div>
    </div>
  );
}
