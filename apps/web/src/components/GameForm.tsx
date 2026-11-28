import {
  EXPANSION_LABELS,
  EXPANSIONS,
  gameInputSchema,
  MAX_SEATS,
  MIN_SEATS,
  NOTES_MAX,
  PLAYER_NAME_MAX,
  playerNameSchema,
  POINTS_MAX,
  topScorers,
  VP_TARGET_MAX,
  VP_TARGET_MIN,
  type Faction,
  type GameDetail,
  type GameInput,
  type GameInputDraft,
  type Player,
} from '@mecatol/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm, useWatch, type FieldErrors, type Path, type Resolver } from 'react-hook-form';
import { ApiError, createPlayer } from '../api.js';
import { queryKeys } from '../queries.js';
import { buttonClass, Field, FormError, inputClass } from './form.js';

// Form state is all strings (what the inputs hold). The resolver converts it to the shared
// GameInput shape and validates with the same Zod schema the API uses, so error paths match.

interface SeatForm {
  playerId: string;
  factionId: string;
  points: string;
}

export interface GameFormValues {
  playedOn: string;
  vpTarget: string;
  endedEarly: boolean;
  notes: string;
  seats: SeatForm[];
  /** Only used on a tie for the most points; otherwise the top scorer wins. */
  winnerPlayerId: string;
}

const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));

const emptySeat = (): SeatForm => ({ playerId: '', factionId: '', points: '' });

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function defaultGameValues(game?: GameDetail): GameFormValues {
  if (!game) {
    return { playedOn: todayIso(), vpTarget: '10', endedEarly: false, notes: '', seats: [emptySeat(), emptySeat()], winnerPlayerId: '' };
  }
  return {
    playedOn: game.playedOn ?? '',
    vpTarget: String(game.vpTarget),
    endedEarly: game.endedEarly,
    notes: game.notes ?? '',
    seats: game.seats.map((s) => ({ playerId: String(s.player.id), factionId: String(s.faction.id), points: String(s.points) })),
    winnerPlayerId: String(game.winner.player.id),
  };
}

/** Seats with a player and points filled in, for working out the winner while typing. */
function scoredSeats(seats: readonly SeatForm[]) {
  return seats
    .map((s) => ({ playerId: num(s.playerId), points: num(s.points) }))
    .filter((s) => Number.isInteger(s.playerId) && Number.isInteger(s.points));
}

function toDraft(v: GameFormValues): GameInputDraft {
  const seats = v.seats.map((s) => ({ playerId: num(s.playerId), factionId: num(s.factionId), points: num(s.points) }));
  const top = topScorers(scoredSeats(v.seats));
  return {
    playedOn: v.playedOn === '' ? null : v.playedOn,
    vpTarget: num(v.vpTarget),
    endedEarly: v.endedEarly,
    notes: v.notes,
    seats,
    winnerPlayerId: top.length === 1 && top[0] !== undefined ? top[0] : num(v.winnerPlayerId),
  };
}

/** Puts `{ type, message }` at a dotted path in a nested errors object, keeping the first error per field. */
function setAt(target: Record<string, unknown>, path: readonly PropertyKey[], message: string): void {
  // Array-level errors ("At least 2 players") go on the field array's `root`.
  const keys = path.length === 1 && path[0] === 'seats' ? ['seats', 'root'] : path.map(String);
  let node = target;
  keys.slice(0, -1).forEach((k) => {
    node[k] ??= {};
    node = node[k] as Record<string, unknown>;
  });
  const last = keys.at(-1) ?? 'root';
  node[last] ??= { type: 'validate', message };
}

const resolver: Resolver<GameFormValues, unknown, GameInput> = (values) => {
  const parsed = gameInputSchema.safeParse(toDraft(values));
  if (parsed.success) return { values: parsed.data, errors: {} };
  const errors: Record<string, unknown> = {};
  for (const issue of parsed.error.issues) setAt(errors, issue.path, issue.message);
  return { values: {}, errors: errors as FieldErrors<GameFormValues> };
};

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="block text-sm text-red-600">{message}</span> : null;
}

function FactionOptions({ factions, keep }: { factions: readonly Faction[]; keep: ReadonlySet<number> }) {
  return EXPANSIONS.map((exp) => {
    const list = factions.filter((f) => f.expansion === exp && (!f.archived || keep.has(f.id)));
    if (list.length === 0) return null;
    return (
      <optgroup key={exp} label={EXPANSION_LABELS[exp]}>
        {list.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </optgroup>
    );
  });
}

/** Adds a player to the signed-in user's roster without leaving the game form. */
function AddPlayer({ onAdded }: { onAdded: (player: Player) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: createPlayer,
    onSuccess: async (player) => {
      setName('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.allPlayers });
      onAdded(player);
    },
    onError: (err) => setError(err.message),
  });

  function submit() {
    const parsed = playerNameSchema.safeParse(name);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid name');
    setError(null);
    add.mutate({ name: parsed.data });
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <input
          className={inputClass}
          placeholder="New player name"
          aria-label="New player name"
          maxLength={PLAYER_NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={add.isPending}
          className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-900"
        >
          {add.isPending ? 'Adding…' : 'Add to roster'}
        </button>
      </div>
      <FieldError message={error ?? undefined} />
    </div>
  );
}

export function GameForm({
  initial,
  players,
  factions,
  canAddPlayers,
  submitLabel,
  onSubmit,
}: {
  initial?: GameDetail | undefined;
  /** The roster seats can pick from (the game creator's). */
  players: readonly Player[];
  factions: readonly Faction[];
  /** False when an admin edits someone else's game: new players would land in the admin's roster. */
  canAddPlayers: boolean;
  submitLabel: string;
  onSubmit: (game: GameInput) => Promise<unknown>;
}) {
  const form = useForm<GameFormValues, unknown, GameInput>({ resolver, defaultValues: defaultGameValues(initial) });
  const { register, control, formState, setValue, getValues, setError } = form;
  const { errors, isSubmitting } = formState;
  const seatsArray = useFieldArray({ control, name: 'seats' });
  const seats = useWatch({ control, name: 'seats' });
  const endedEarly = useWatch({ control, name: 'endedEarly' });

  // Archived players and factions stay selectable only where the game already uses them.
  const keepPlayers = new Set(initial?.seats.map((s) => s.player.id));
  const keepFactions = new Set(initial?.seats.map((s) => s.faction.id));
  const playerOptions = players.filter((p) => !p.archived || keepPlayers.has(p.id));
  const playerName = new Map(players.map((p) => [p.id, p.name]));

  const scored = scoredSeats(seats);
  const top = topScorers(scored);
  const topPoints = scored.find((s) => s.playerId === top[0])?.points;

  async function submit(game: GameInput) {
    try {
      await onSubmit(game);
    } catch (err) {
      if (err instanceof ApiError && err.issues.length > 0) {
        for (const issue of err.issues) {
          if (issue.path.length > 0) setError(issue.path.join('.') as Path<GameFormValues>, { message: issue.message });
        }
      }
      setError('root.server', { message: err instanceof Error ? err.message : 'Saving failed' });
    }
  }

  // A player added from the form goes into the first empty seat, but only once their <option>
  // has rendered: setting a select to a value it has no option for leaves it showing blank.
  const pendingFill = useRef<number | null>(null);
  const [, rerender] = useState(0);
  useEffect(() => {
    const id = pendingFill.current;
    if (id === null || !playerOptions.some((p) => p.id === id)) return;
    pendingFill.current = null;
    const i = getValues('seats').findIndex((s) => s.playerId === '');
    if (i >= 0) setValue(`seats.${i}.playerId`, String(id), { shouldDirty: true });
  });

  function fillFirstEmptySeat(player: Player) {
    pendingFill.current = player.id;
    rerender((n) => n + 1);
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date played" type="date" hint="Leave empty if unknown" error={errors.playedOn?.message} {...register('playedOn')} />
        <Field
          label="VP target"
          type="number"
          inputMode="numeric"
          min={VP_TARGET_MIN}
          max={VP_TARGET_MAX}
          error={errors.vpTarget?.message}
          {...register('vpTarget')}
        />
        <label className="flex items-center gap-2 self-center pt-5 text-sm">
          <input type="checkbox" className="size-4" {...register('endedEarly')} />
          Ended early
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Players</legend>
        <div className="hidden grid-cols-[1fr_1fr_6rem_2rem] gap-2 text-xs text-slate-500 sm:grid">
          <span>Player</span>
          <span>Faction</span>
          <span>Points</span>
        </div>
        {seatsArray.fields.map((field, i) => {
          const seatErrors = errors.seats?.[i];
          return (
            // Phones: player, points and remove on one line, the faction full width below it.
            <div
              key={field.id}
              className="grid grid-cols-[1fr_4.5rem_2rem] items-start gap-2 border-b border-slate-200 pb-3 sm:grid-cols-[1fr_1fr_6rem_2rem] sm:border-0 sm:pb-0 dark:border-slate-800"
            >
              <div className="col-start-1 row-start-1">
                <select className={inputClass} aria-label={`Player ${i + 1}`} {...register(`seats.${i}.playerId`)}>
                  <option value="">Player…</option>
                  {playerOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.archived ? ' (archived)' : ''}
                    </option>
                  ))}
                </select>
                <FieldError message={seatErrors?.playerId?.message} />
              </div>
              <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                <select className={inputClass} aria-label={`Faction ${i + 1}`} {...register(`seats.${i}.factionId`)}>
                  <option value="">Faction…</option>
                  <FactionOptions factions={factions} keep={keepFactions} />
                </select>
                <FieldError message={seatErrors?.factionId?.message} />
              </div>
              <div className="col-start-2 row-start-1 sm:col-start-3">
                <input
                  className={inputClass}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={POINTS_MAX}
                  aria-label={`Points ${i + 1}`}
                  {...register(`seats.${i}.points`)}
                />
                <FieldError message={seatErrors?.points?.message} />
              </div>
              <button
                type="button"
                onClick={() => seatsArray.remove(i)}
                disabled={seatsArray.fields.length <= MIN_SEATS}
                aria-label={`Remove player ${i + 1}`}
                title="Remove"
                className="col-start-3 row-start-1 mt-2 rounded text-slate-400 hover:text-red-600 disabled:invisible sm:col-start-4"
              >
                ✕
              </button>
            </div>
          );
        })}
        <FieldError message={errors.seats?.root?.message ?? errors.seats?.message} />
        {seatsArray.fields.length < MAX_SEATS && (
          <button
            type="button"
            onClick={() => seatsArray.append(emptySeat())}
            className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
          >
            + Add a player
          </button>
        )}
        {canAddPlayers && (
          <div className="pt-2">
            <p className="mb-1 text-xs text-slate-500">Someone new? Add them to your roster:</p>
            <AddPlayer onAdded={fillFirstEmptySeat} />
          </div>
        )}
      </fieldset>

      <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
        <span className="font-medium">Winner: </span>
        {top.length === 0 && <span className="text-slate-500">enter points to pick the winner</span>}
        {top.length === 1 && (
          <span>
            {playerName.get(top[0] ?? -1) ?? '?'} ({topPoints} points)
          </span>
        )}
        {top.length > 1 && !endedEarly && (
          <span className="text-amber-700 dark:text-amber-300">
            {top.length} players are tied on {topPoints} points. A tie is only allowed when the game ended early.
          </span>
        )}
        {top.length > 1 && endedEarly && (
          <span className="inline-flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-slate-500">tied on {topPoints}, pick one:</span>
            {top.map((id) => (
              <label key={id} className="inline-flex items-center gap-1">
                <input type="radio" value={String(id)} {...register('winnerPlayerId')} />
                {playerName.get(id) ?? '?'}
              </label>
            ))}
          </span>
        )}
        {/* On a tie without "Ended early", the amber line above already says what to do. */}
        {!(top.length > 1 && !endedEarly) && <FieldError message={errors.winnerPlayerId?.message} />}
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Notes</span>
        <textarea className={inputClass} rows={3} maxLength={NOTES_MAX} {...register('notes')} />
        <FieldError message={errors.notes?.message} />
      </label>

      <FormError message={errors.root?.server?.message ?? null} />
      <button type="submit" className={buttonClass} disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
