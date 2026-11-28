import {
  defaultPlayerMapping,
  distinctFactionNames,
  distinctPlayerNames,
  factionResolver,
  PLAYER_NAME_MAX,
  type DraftGame,
  type Faction,
  type FactionAlias,
  type MeResponse,
  type Player,
  type PlayerMapping,
} from '@mecatol/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { createFactionAlias } from '../../api.js';
import { buttonClass, FormError, inputClass } from '../../components/form.js';
import { queryKeys } from '../../queries.js';
import { secondaryButtonClass } from './TabsStep.js';

export function NamesStep(props: {
  user: MeResponse;
  drafts: DraftGame[];
  roster: Player[];
  factions: Faction[];
  aliases: FactionAlias[];
  mappings: Record<string, PlayerMapping>;
  onMappingsChange: (m: Record<string, PlayerMapping>) => void;
  factionPicks: Record<string, number>;
  onFactionPicksChange: (p: Record<string, number>) => void;
  defaultYear: number;
  onDefaultYearChange: (year: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { drafts, roster, mappings, factionPicks } = props;
  const players = useMemo(() => distinctPlayerNames(drafts), [drafts]);
  const gamesPerName = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of drafts) for (const name of new Set(d.seats.map((s) => s.player.trim()))) counts.set(name, (counts.get(name) ?? 0) + 1);
    return counts;
  }, [drafts]);

  // Faction names that aliases and loose matching can't place. Ones already picked stay listed.
  const resolveWithoutPicks = useMemo(() => factionResolver(props.factions, props.aliases), [props.factions, props.aliases]);
  const unmatched = useMemo(
    () => distinctFactionNames(drafts).filter((name) => resolveWithoutPicks(name) === null),
    [drafts, resolveWithoutPicks],
  );
  const matchedCount = distinctFactionNames(drafts).length - unmatched.length;

  const mappingOf = (name: string) => mappings[name] ?? defaultPlayerMapping(name, roster);
  const setMapping = (name: string, m: PlayerMapping) => props.onMappingsChange({ ...mappings, [name]: m });
  const activeFactions = props.factions.filter((f) => !f.archived);

  return (
    <div className="space-y-8">
      <fieldset className="space-y-3">
        <legend className="text-lg font-medium">Players</legend>
        <p className="text-sm text-slate-500">
          Each name becomes a player in your roster, or matches one you already have. Give two spellings (like &ldquo;codey&rdquo; and
          &ldquo;cody&rdquo;) the same name or the same roster player to count them as one person.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full max-w-3xl text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800">
              <tr>
                <th className="py-2 pr-3 font-medium">In the sheet</th>
                <th className="py-2 pr-3 text-right font-medium">Games</th>
                <th className="py-2 pr-3 font-medium">Import as</th>
                <th className="py-2 font-medium">New player&apos;s name</th>
              </tr>
            </thead>
            <tbody>
              {players.map((name) => {
                const m = mappingOf(name);
                return (
                  <tr key={name} className="border-b border-slate-100 dark:border-slate-900">
                    <td className="py-2 pr-3 font-medium">{name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{gamesPerName.get(name) ?? 0}</td>
                    <td className="py-2 pr-3">
                      <select
                        className={inputClass}
                        aria-label={`Import ${name} as`}
                        value={m.kind === 'existing' ? String(m.id) : 'new'}
                        onChange={(e) =>
                          setMapping(name, e.target.value === 'new' ? { kind: 'new', name } : { kind: 'existing', id: Number(e.target.value) })
                        }
                      >
                        <option value="new">A new player</option>
                        {roster.length > 0 && (
                          <optgroup label="Your roster">
                            {roster.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                                {p.archived ? ' (archived)' : ''}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </td>
                    <td className="py-2">
                      {m.kind === 'new' && (
                        <input
                          className={inputClass}
                          aria-label={`New player name for ${name}`}
                          maxLength={PLAYER_NAME_MAX}
                          value={m.name}
                          onChange={(e) => setMapping(name, { kind: 'new', name: e.target.value })}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {players.length === 0 && <p className="text-sm text-slate-500">No player names found.</p>}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-lg font-medium">Factions</legend>
        <p className="text-sm text-slate-500">
          {matchedCount} faction {matchedCount === 1 ? 'name' : 'names'} matched automatically (ignoring case, a leading &ldquo;The&rdquo; and known
          typos).
          {unmatched.length === 0 ? ' Nothing to fix here.' : ' Pick the faction for each name below.'}
        </p>
        {unmatched.length > 0 && (
          <ul className="max-w-3xl space-y-2">
            {unmatched.map((name) => (
              <FactionPick
                key={name}
                name={name}
                factions={activeFactions}
                picked={factionPicks[name]}
                isAdmin={props.user.role === 'admin'}
                onPick={(id) => {
                  const { [name]: _previous, ...rest } = factionPicks;
                  props.onFactionPicksChange(id === undefined ? rest : { ...rest, [name]: id });
                }}
              />
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-lg font-medium">Dates</legend>
        <label className="flex max-w-md items-center gap-3 text-sm">
          <span>Year for dates written without one</span>
          <input
            type="number"
            className={`${inputClass} w-28`}
            min={1970}
            max={2100}
            value={props.defaultYear}
            onChange={(e) => {
              const year = Number(e.target.value);
              if (Number.isInteger(year) && year >= 1970 && year <= 2100) props.onDefaultYearChange(year);
            }}
          />
        </label>
        <p className="text-xs text-slate-500">Dates saved by Excel or Google Sheets keep their own year. This applies to text like &ldquo;5/21&rdquo; in a .csv.</p>
      </fieldset>

      <div className="flex gap-3">
        <button type="button" className={secondaryButtonClass} onClick={props.onBack}>
          Back
        </button>
        <button type="button" className={buttonClass} onClick={props.onNext}>
          Next: review games
        </button>
      </div>
    </div>
  );
}

function FactionPick({
  name,
  factions,
  picked,
  isAdmin,
  onPick,
}: {
  name: string;
  factions: Faction[];
  picked: number | undefined;
  isAdmin: boolean;
  onPick: (id: number | undefined) => void;
}) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (factionId: number) => createFactionAlias({ alias: name, factionId }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: queryKeys.factionAliases });
    },
  });

  return (
    <li className="flex flex-wrap items-center gap-3 text-sm">
      <span className="w-56 font-medium">&ldquo;{name}&rdquo;</span>
      <select
        className={`${inputClass} w-64`}
        aria-label={`Faction for ${name}`}
        value={picked ?? ''}
        onChange={(e) => onPick(e.target.value ? Number(e.target.value) : undefined)}
      >
        <option value="">Pick a faction…</option>
        {factions.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      {isAdmin && picked !== undefined && !saved && (
        <button
          type="button"
          className="text-indigo-600 hover:underline disabled:opacity-60 dark:text-indigo-400"
          disabled={save.isPending}
          onClick={() => save.mutate(picked)}
          title="Admins only: match this spelling automatically in future imports"
        >
          {save.isPending ? 'Saving…' : 'Save as alias'}
        </button>
      )}
      {saved && <span className="text-emerald-700 dark:text-emerald-400">Saved as an alias</span>}
      {save.error && <FormError message={save.error.message} />}
    </li>
  );
}
