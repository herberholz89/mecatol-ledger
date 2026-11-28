import {
  defaultPlayerMapping,
  draftFromParsed,
  factionResolver,
  mappingToRef,
  parseTab,
  reviewGame,
  type CreatedImport,
  type DraftGame,
  type MeResponse,
  type PlayerMapping,
  type ReviewContext,
  type SheetTab,
} from '@mecatol/shared';
import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { FormError } from '../../components/form.js';
import { useFactionAliases, useFactions, usePlayers } from '../../queries.js';
import { useMe } from '../../useMe.js';
import { NamesStep } from './NamesStep.js';
import { ReviewStep } from './ReviewStep.js';
import { TabsStep } from './TabsStep.js';
import { UploadStep } from './UploadStep.js';

/** Undated games in the group's original sheet are from 2026 (decision log, 2026-11-26). */
const DEFAULT_YEAR = 2026;

const STEPS = [
  ['upload', 'Upload'],
  ['tabs', 'Pick tabs'],
  ['names', 'Match names'],
  ['review', 'Review'],
] as const;
type Step = (typeof STEPS)[number][0] | 'done';

export interface LoadedFile {
  name: string;
  tabs: SheetTab[];
}

export function ImportPage() {
  const me = useMe();
  if (me.isPending) return <p>Loading…</p>;
  if (me.isError) return <FormError message={me.error.message} />;
  if (!me.data) return <Navigate to="/signin?next=/import" replace />;
  return <ImportWizard user={me.data} />;
}

function ImportWizard({ user }: { user: MeResponse }) {
  const roster = usePlayers(user.id);
  const factions = useFactions();
  const aliases = useFactionAliases();

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [selectedTabs, setSelectedTabs] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<DraftGame[]>([]);
  const [mappings, setMappings] = useState<Record<string, PlayerMapping>>({});
  const [factionPicks, setFactionPicks] = useState<Record<string, number>>({});
  const [defaultYear, setDefaultYear] = useState(DEFAULT_YEAR);
  const [result, setResult] = useState<CreatedImport | null>(null);

  const rosterPlayers = useMemo(() => roster.data ?? [], [roster.data]);
  const resolveFaction = useMemo(
    () => factionResolver(factions.data ?? [], aliases.data ?? [], factionPicks),
    [factions.data, aliases.data, factionPicks],
  );
  const ctx = useMemo<ReviewContext>(
    () => ({
      defaultYear,
      player: (name) => mappingToRef(mappings[name] ?? defaultPlayerMapping(name, rosterPlayers)),
      faction: resolveFaction,
    }),
    [defaultYear, mappings, rosterPlayers, resolveFaction],
  );
  const reviewed = useMemo(() => drafts.map((d) => reviewGame(d, ctx)), [drafts, ctx]);

  const loadError = roster.error ?? factions.error ?? aliases.error;
  const loading = roster.isPending || factions.isPending || aliases.isPending;

  function loaded(next: LoadedFile, likelyTabs: string[]) {
    setFile(next);
    setSelectedTabs(likelyTabs);
    setStep('tabs');
  }

  function pickTabs() {
    if (!file) return;
    setDrafts(file.tabs.filter((t) => selectedTabs.includes(t.name)).flatMap((t) => parseTab(t).map(draftFromParsed)));
    setStep('names');
  }

  function startOver() {
    setFile(null);
    setDrafts([]);
    setMappings({});
    setFactionPicks({});
    setResult(null);
    setStep('upload');
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Import a spreadsheet</h1>
        <p className="text-sm text-slate-500">
          Bring in games from the group&apos;s &ldquo;Twilight Imperium data&rdquo; sheet. They&apos;re added as games you logged, and you can undo
          the whole import from your account page.
        </p>
      </div>

      {step !== 'done' && (
        <ol className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {STEPS.map(([key, label], i) => (
            <li key={key} className={key === step ? 'font-medium' : 'text-slate-500'}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      )}

      <FormError message={loadError?.message ?? null} />

      {step === 'upload' && <UploadStep onLoaded={loaded} />}
      {step === 'tabs' && file && (
        <TabsStep
          file={file}
          selected={selectedTabs}
          onChange={setSelectedTabs}
          onReorder={setFile}
          onBack={startOver}
          onNext={pickTabs}
        />
      )}
      {step === 'names' &&
        (loading ? (
          <p>Loading your roster and factions…</p>
        ) : (
          <NamesStep
            user={user}
            drafts={drafts}
            roster={rosterPlayers}
            factions={factions.data ?? []}
            aliases={aliases.data ?? []}
            mappings={mappings}
            onMappingsChange={setMappings}
            factionPicks={factionPicks}
            onFactionPicksChange={setFactionPicks}
            defaultYear={defaultYear}
            onDefaultYearChange={setDefaultYear}
            onBack={() => setStep('tabs')}
            onNext={() => setStep('review')}
          />
        ))}
      {step === 'review' && file && (
        <ReviewStep
          fileName={file.name}
          drafts={drafts}
          reviewed={reviewed}
          onDraftsChange={setDrafts}
          factions={factions.data ?? []}
          resolveFaction={resolveFaction}
          nameOptions={[...new Set([...rosterPlayers.map((p) => p.name), ...drafts.flatMap((d) => d.seats.map((s) => s.player.trim()))])]
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b))}
          defaultYear={defaultYear}
          onBack={() => setStep('names')}
          onImported={(created) => {
            setResult(created);
            setStep('done');
          }}
        />
      )}
      {step === 'done' && result && (
        <div className="space-y-4 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          <p className="text-base font-medium">
            Imported {result.games} {result.games === 1 ? 'game' : 'games'}
            {result.newPlayers > 0 && ` and added ${result.newPlayers} ${result.newPlayers === 1 ? 'player' : 'players'} to your roster`}.
          </p>
          <p>Changed your mind? Undo the whole import from your account page.</p>
          <div className="flex gap-4">
            <Link to="/games?mine=true" className="text-indigo-600 hover:underline dark:text-indigo-400">
              See the games
            </Link>
            <Link to="/account" className="text-indigo-600 hover:underline dark:text-indigo-400">
              My imports
            </Link>
            <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={startOver}>
              Import another file
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
