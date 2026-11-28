import {
  IMPORT_MAX_GAMES,
  MAX_SEATS,
  NOTES_MAX,
  POINTS_MAX,
  SOURCE_NAME_MAX,
  toIsoDate,
  VP_TARGET_MAX,
  VP_TARGET_MIN,
  type CreatedImport,
  type DraftGame,
  type DraftSeat,
  type Faction,
  type ReviewedGame,
  type ReviewIssue,
} from '@mecatol/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, createImport } from '../../api.js';
import { buttonClass, FormError, inputClass } from '../../components/form.js';
import { formatDate } from '../../format.js';
import { queryKeys } from '../../queries.js';
import { secondaryButtonClass } from './TabsStep.js';

type Filter = 'all' | 'attention';

const ISSUE_STYLE: Record<ReviewIssue['level'], [string, string]> = {
  blocked: ['✕', 'text-red-700 dark:text-red-300'],
  warning: ['!', 'text-amber-700 dark:text-amber-300'],
  info: ['·', 'text-slate-500'],
};

const STATUS_STYLE: Record<ReviewedGame['status'], [string, string]> = {
  ok: ['OK', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'],
  warning: ['Check', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'],
  blocked: ['Blocked', 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'],
  skipped: ['Skipped', 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'],
};

export function ReviewStep(props: {
  fileName: string;
  drafts: DraftGame[];
  reviewed: ReviewedGame[];
  onDraftsChange: (drafts: DraftGame[]) => void;
  factions: Faction[];
  resolveFaction: (name: string) => number | null;
  nameOptions: string[];
  defaultYear: number;
  onBack: () => void;
  onImported: (created: CreatedImport) => void;
}) {
  const { drafts, reviewed } = props;
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState(props.fileName.slice(0, SOURCE_NAME_MAX));

  const count = (s: ReviewedGame['status']) => reviewed.filter((r) => r.status === s).length;
  const games = reviewed.flatMap((r) => (r.game ? [r.game] : []));
  const blocked = count('blocked');

  const commit = useMutation({
    mutationFn: () => createImport({ sourceName: sourceName.trim(), games }),
    onSuccess: async (created) => {
      props.onImported(created);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: queryKeys.allPlayers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.imports }),
      ]);
    },
  });

  const update = (key: string, change: (d: DraftGame) => DraftGame) => props.onDraftsChange(drafts.map((d) => (d.key === key ? change(d) : d)));

  const commitError = commit.error instanceof ApiError ? commit.error.message : (commit.error?.message ?? null);
  const tooMany = games.length > IMPORT_MAX_GAMES;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span>
          <span className="font-medium">{drafts.length}</span> games found:
        </span>
        <span>{count('ok')} OK</span>
        <span className="text-amber-700 dark:text-amber-300">{count('warning')} to check</span>
        <span className="text-red-700 dark:text-red-300">{blocked} blocked</span>
        <span className="text-slate-500">{count('skipped')} skipped</span>
        <label className="ml-auto flex items-center gap-2">
          <input type="checkbox" className="size-4" checked={filter === 'attention'} onChange={(e) => setFilter(e.target.checked ? 'attention' : 'all')} />
          Only show games to check or fix
        </label>
      </div>

      <p className="text-sm text-slate-500">
        Blocked games can&apos;t be imported until they&apos;re fixed: click a game to edit it, or skip it. Games to check import as they are;
        the notes say what looked odd.
      </p>

      <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {drafts.map((draft, i) => {
          const r = reviewed[i];
          if (!r) return null;
          if (filter === 'attention' && (r.status === 'ok' || r.status === 'skipped') && editing !== draft.key) return null;
          return (
            <li key={draft.key} className="space-y-2 p-3">
              <GameRow
                draft={draft}
                review={r}
                defaultYear={props.defaultYear}
                editing={editing === draft.key}
                onToggleEdit={() => setEditing(editing === draft.key ? null : draft.key)}
                onToggleSkip={() => update(draft.key, (d) => ({ ...d, skip: !d.skip }))}
              />
              {editing === draft.key && (
                <GameEditor
                  draft={draft}
                  review={r}
                  factions={props.factions}
                  resolveFaction={props.resolveFaction}
                  nameOptions={props.nameOptions}
                  defaultYear={props.defaultYear}
                  onChange={(next) => update(draft.key, () => next)}
                />
              )}
            </li>
          );
        })}
      </ul>

      <div className="space-y-3 rounded-md border border-slate-200 p-4 dark:border-slate-800">
        <label className="block max-w-md space-y-1">
          <span className="text-sm font-medium">Name this import</span>
          <input className={inputClass} maxLength={SOURCE_NAME_MAX} value={sourceName} onChange={(e) => setSourceName(e.target.value)} />
          <span className="block text-xs text-slate-500">Shown on your account page, where you can undo it.</span>
        </label>
        {blocked > 0 && (
          <p className="text-sm text-red-700 dark:text-red-300">
            {blocked} blocked {blocked === 1 ? 'game' : 'games'} won&apos;t be imported. Fix or skip {blocked === 1 ? 'it' : 'them'} first, or import
            the rest now.
          </p>
        )}
        {tooMany && <p className="text-sm text-red-700 dark:text-red-300">At most {IMPORT_MAX_GAMES} games per import. Skip some or import fewer tabs.</p>}
        <FormError message={commitError} />
        <div className="flex gap-3">
          <button type="button" className={secondaryButtonClass} onClick={props.onBack}>
            Back
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={games.length === 0 || tooMany || !sourceName.trim() || commit.isPending}
            onClick={() => commit.mutate()}
          >
            {commit.isPending ? 'Importing…' : `Import ${games.length} ${games.length === 1 ? 'game' : 'games'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function GameRow({
  draft,
  review,
  defaultYear,
  editing,
  onToggleEdit,
  onToggleSkip,
}: {
  draft: DraftGame;
  review: ReviewedGame;
  defaultYear: number;
  editing: boolean;
  onToggleEdit: () => void;
  onToggleSkip: () => void;
}) {
  const [label, style] = STATUS_STYLE[review.status];
  const rows = draft.firstRow === draft.lastRow ? `row ${draft.firstRow}` : `rows ${draft.firstRow}–${draft.lastRow}`;
  const date = draft.date ? toIsoDate(draft.date, defaultYear) : null;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${style}`}>{label}</span>
        <span className="text-xs text-slate-500">
          {draft.tab}, {rows}
        </span>
        <span className="text-xs text-slate-500">{date ? formatDate(date) : 'No date'}</span>
        {review.vpTarget !== null && <span className="text-xs text-slate-500">{review.vpTarget} VP</span>}
        {review.spread !== null && <span className="text-xs text-slate-500">spread {review.spread}</span>}
        {draft.endedEarly && <span className="text-xs text-slate-500">ended early</span>}
        <span className="ml-auto flex gap-3 text-xs">
          <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={onToggleEdit}>
            {editing ? 'Done' : 'Edit'}
          </button>
          <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={onToggleSkip}>
            {draft.skip ? 'Include' : 'Skip'}
          </button>
        </span>
      </div>
      <p className={`text-sm ${draft.skip ? 'text-slate-400 line-through' : ''}`}>
        {draft.seats.map((s, i) => (
          <span key={i} className={i === review.winner ? 'font-semibold' : ''}>
            {i > 0 && <span className="font-normal text-slate-400"> · </span>}
            {s.player.trim() || <span className="text-red-600">no player</span>} ({s.faction.trim() || '?'}) {s.points ?? '?'}
          </span>
        ))}
        {draft.notes.trim() && <span className="text-slate-500"> — {draft.notes.trim()}</span>}
      </p>
      {!draft.skip && review.issues.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {review.issues.map((issue, i) => (
            <li key={i} className={ISSUE_STYLE[issue.level][1]}>
              {ISSUE_STYLE[issue.level][0]} {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GameEditor({
  draft,
  review,
  factions,
  resolveFaction,
  nameOptions,
  defaultYear,
  onChange,
}: {
  draft: DraftGame;
  review: ReviewedGame;
  factions: Faction[];
  resolveFaction: (name: string) => number | null;
  nameOptions: string[];
  defaultYear: number;
  onChange: (draft: DraftGame) => void;
}) {
  const listId = `names-${draft.key}`;
  const setSeat = (i: number, change: Partial<DraftSeat>) =>
    onChange({ ...draft, seats: draft.seats.map((s, j) => (j === i ? { ...s, ...change } : s)) });
  const top = Math.max(...draft.seats.map((s) => s.points ?? -1));
  const topSeats = draft.seats.flatMap((s, i) => (s.points === top ? [i] : []));
  const date = draft.date ? toIsoDate(draft.date, defaultYear) : null;
  const factionName = (id: number) => factions.find((f) => f.id === id)?.name ?? '';

  return (
    <div className="space-y-4 rounded-md bg-slate-100 p-3 dark:bg-slate-900">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-slate-500">Date</span>
          <input
            type="date"
            className={inputClass}
            value={date ?? ''}
            onChange={(e) => {
              const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.target.value);
              onChange({ ...draft, date: m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null });
            }}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-slate-500">VP target</span>
          <input
            type="number"
            className={inputClass}
            min={VP_TARGET_MIN}
            max={VP_TARGET_MAX}
            placeholder={review.vpTarget !== null ? String(review.vpTarget) : ''}
            value={draft.vpTarget ?? ''}
            onChange={(e) => {
              const n = e.target.value === '' ? null : Number(e.target.value);
              onChange({ ...draft, vpTarget: n !== null && Number.isInteger(n) ? Math.min(VP_TARGET_MAX, Math.max(VP_TARGET_MIN, n)) : null });
            }}
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="size-4" checked={draft.endedEarly} onChange={(e) => onChange({ ...draft, endedEarly: e.target.checked })} />
          Ended early
        </label>
      </div>

      <datalist id={listId}>
        {nameOptions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="space-y-2">
        <div className="hidden grid-cols-[1fr_1fr_5rem_2rem] gap-2 text-xs text-slate-500 sm:grid">
          <span>Player</span>
          <span>Faction</span>
          <span>Points</span>
        </div>
        {draft.seats.map((seat, i) => {
          const factionId = seat.faction.trim() ? resolveFaction(seat.faction) : null;
          return (
            <div key={i} className="grid grid-cols-[1fr_1fr_5rem_2rem] items-center gap-2">
              <input
                className={inputClass}
                list={listId}
                aria-label={`Player ${i + 1}`}
                placeholder="Player name"
                value={seat.player}
                onChange={(e) => setSeat(i, { player: e.target.value })}
              />
              <select
                className={inputClass}
                aria-label={`Faction ${i + 1}`}
                value={factionId ?? ''}
                onChange={(e) => setSeat(i, { faction: e.target.value ? factionName(Number(e.target.value)) : '' })}
              >
                <option value="">{seat.faction.trim() && factionId === null ? `Unknown: ${seat.faction.trim()}` : 'Pick a faction…'}</option>
                {factions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                className={inputClass}
                aria-label={`Points ${i + 1}`}
                min={0}
                max={POINTS_MAX}
                value={seat.points ?? ''}
                onChange={(e) => setSeat(i, { points: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <button
                type="button"
                className="text-slate-400 hover:text-red-600"
                aria-label={`Remove seat ${i + 1}`}
                onClick={() => onChange({ ...draft, winner: null, seats: draft.seats.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </div>
          );
        })}
        {draft.seats.length < MAX_SEATS && (
          <button
            type="button"
            className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
            onClick={() => onChange({ ...draft, seats: [...draft.seats, { row: null, player: '', faction: '', points: null }] })}
          >
            Add a player
          </button>
        )}
        <p className="text-xs text-slate-500">A name that isn&apos;t in your roster yet becomes a new player.</p>
      </div>

      {review.tie && draft.endedEarly && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="text-slate-500">Tied on {top}, pick the winner:</span>
          {topSeats.map((i) => (
            <label key={i} className="inline-flex items-center gap-1">
              <input type="radio" name={`winner-${draft.key}`} checked={draft.winner === i} onChange={() => onChange({ ...draft, winner: i })} />
              {draft.seats[i]?.player.trim() || `Seat ${i + 1}`}
            </label>
          ))}
        </div>
      )}

      <label className="block space-y-1 text-sm">
        <span className="text-xs text-slate-500">Notes</span>
        <input className={inputClass} maxLength={NOTES_MAX} value={draft.notes} onChange={(e) => onChange({ ...draft, notes: e.target.value })} />
      </label>
      {draft.annotations.length > 0 && (
        <p className="text-xs text-slate-500">
          Written in the sheet next to this game: {draft.annotations.map((a) => `“${a}”`).join(', ')}
        </p>
      )}
    </div>
  );
}
