import { canManagePlayer, canUnclaimPlayer, type RosterPlayer } from '@mecatol/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { claimPlayer, deletePlayer, mergePlayer, unclaimPlayer, updatePlayer } from '../api.js';
import { queryKeys, usePlayerList, usePlayers } from '../queries.js';
import { useMe } from '../useMe.js';
import { FormError, inputClass } from './form.js';

const smallButton =
  'rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-900';

/**
 * Refreshes players and everything under games (lists, stats), which show player names. Pass the id
 * of a player that no longer exists (merged or deleted) to drop its queries instead of refetching them.
 */
function useRefresh() {
  const queryClient = useQueryClient();
  return (goneId?: number) => {
    if (goneId !== undefined) {
      queryClient.removeQueries({ queryKey: queryKeys.player(goneId) });
      queryClient.removeQueries({ queryKey: queryKeys.stats('player', goneId) });
    }
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.allPlayers }),
      queryClient.invalidateQueries({ queryKey: queryKeys.games }),
      queryClient.invalidateQueries({ queryKey: ['game'] }),
    ]);
  };
}

/** Who claimed the player, with "This is me" / remove-claim buttons for those allowed. */
export function ClaimControl({ player }: { player: RosterPlayer }) {
  const me = useMe();
  const refresh = useRefresh();
  const claim = useMutation({ mutationFn: () => claimPlayer(player.id), onSuccess: () => refresh() });
  const unclaim = useMutation({ mutationFn: () => unclaimPlayer(player.id), onSuccess: () => refresh() });
  const user = me.data;
  const mine = !!user && player.userId === user.id;
  const error = claim.error?.message ?? unclaim.error?.message ?? null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {player.userId === null ? (
          <span className="text-slate-500">Not linked to an account.</span>
        ) : (
          <span>
            {mine ? 'This is you.' : `Claimed by ${player.claimedByName ?? 'an account without a display name'}.`}
          </span>
        )}
        {user && player.userId === null && (
          <button type="button" className={smallButton} disabled={claim.isPending} onClick={() => claim.mutate()}>
            {claim.isPending ? 'Claiming…' : 'This is me'}
          </button>
        )}
        {canUnclaimPlayer(user, player) && (
          <button
            type="button"
            className={smallButton}
            disabled={unclaim.isPending}
            onClick={() => {
              const question = mine ? `Unlink ${player.name} from your account?` : `Remove ${player.claimedByName ?? 'this account'}'s claim on ${player.name}?`;
              if (window.confirm(question)) unclaim.mutate();
            }}
          >
            {unclaim.isPending ? 'Removing…' : mine ? 'Not me' : 'Remove claim'}
          </button>
        )}
      </div>
      <FormError message={error} />
    </div>
  );
}

/** Rename, archive, merge and delete, for the roster owner or an admin. Renders nothing for anyone else. */
export function ManagePlayer({ player }: { player: RosterPlayer }) {
  const me = useMe();
  if (!canManagePlayer(me.data, player.createdBy)) return null;
  return (
    <section className="space-y-6 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div>
        <h2 className="font-medium">Manage player</h2>
        <p className="text-sm text-slate-500">
          {me.data?.id === player.createdBy ? 'In your roster.' : `In ${player.ownerName ?? 'an unnamed user'}'s roster (you're an admin).`}
        </p>
      </div>
      <RenameForm key={player.name} player={player} />
      <ArchiveToggle player={player} />
      <MergeForm player={player} />
      <DeleteButton player={player} />
    </section>
  );
}

function RenameForm({ player }: { player: RosterPlayer }) {
  const refresh = useRefresh();
  const [name, setName] = useState(player.name);
  const rename = useMutation({ mutationFn: (newName: string) => updatePlayer(player.id, { name: newName }), onSuccess: () => refresh() });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && name.trim() !== player.name) rename.mutate(name);
  };
  return (
    <form onSubmit={submit} className="space-y-1">
      <label htmlFor="player-name" className="text-sm font-medium">
        Name
      </label>
      <div className="flex gap-2">
        <input id="player-name" className={inputClass} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className={smallButton} disabled={rename.isPending || !name.trim() || name.trim() === player.name}>
          {rename.isPending ? 'Saving…' : 'Rename'}
        </button>
      </div>
      <FormError message={rename.error?.message ?? null} />
    </form>
  );
}

function ArchiveToggle({ player }: { player: RosterPlayer }) {
  const refresh = useRefresh();
  const toggle = useMutation({ mutationFn: () => updatePlayer(player.id, { archived: !player.archived }), onSuccess: () => refresh() });
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{player.archived ? 'Archived' : 'Archive'}</p>
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-slate-500">
          {player.archived
            ? "Hidden when logging new games. Their games and stats stay."
            : "Hide them when logging new games, e.g. someone who stopped playing. Their games and stats stay."}
        </p>
        <button type="button" className={smallButton} disabled={toggle.isPending} onClick={() => toggle.mutate()}>
          {player.archived ? 'Unarchive' : 'Archive'}
        </button>
      </div>
      <FormError message={toggle.error?.message ?? null} />
    </div>
  );
}

function MergeForm({ player }: { player: RosterPlayer }) {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const roster = usePlayers(player.createdBy);
  const [intoId, setIntoId] = useState('');
  const others = (roster.data ?? []).filter((p) => p.id !== player.id);
  const into = others.find((p) => p.id === Number(intoId));
  const merge = useMutation({
    mutationFn: (target: number) => mergePlayer(player.id, { intoPlayerId: target }),
    onSuccess: async (merged) => {
      await navigate(`/players/${merged.id}`, { replace: true });
      await refresh(player.id);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!into) return;
    const games = player.games === 1 ? '1 game' : `${player.games} games`;
    if (window.confirm(`Merge ${player.name} into ${into.name}? ${player.name}'s ${games} move to ${into.name}, and ${player.name} is deleted. This can't be undone.`)) {
      merge.mutate(into.id);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-1">
      <label htmlFor="merge-into" className="text-sm font-medium">
        Merge into another player
      </label>
      <p className="text-sm text-slate-500">For two spellings of the same person. Their games move over and {player.name} is deleted.</p>
      <div className="flex gap-2">
        <select id="merge-into" className={inputClass} value={intoId} onChange={(e) => setIntoId(e.target.value)}>
          <option value="">Pick a player…</option>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.games} {p.games === 1 ? 'game' : 'games'}){p.archived ? ' · archived' : ''}
            </option>
          ))}
        </select>
        <button type="submit" className={smallButton} disabled={!into || merge.isPending}>
          {merge.isPending ? 'Merging…' : 'Merge'}
        </button>
      </div>
      <FormError message={merge.error?.message ?? null} />
    </form>
  );
}

function DeleteButton({ player }: { player: RosterPlayer }) {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const remove = useMutation({
    mutationFn: () => deletePlayer(player.id),
    onSuccess: async () => {
      await navigate('/account', { replace: true });
      await refresh(player.id);
    },
  });
  if (player.games > 0) {
    return (
      <p className="text-sm text-slate-500">
        {player.name} is in {player.games === 1 ? '1 game' : `${player.games} games`}, so they can&apos;t be deleted. Archive or merge them instead.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">Delete</p>
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-slate-500">Not in any games, e.g. a typo or a test name.</p>
        <button
          type="button"
          className={`${smallButton} text-red-700 hover:border-red-400 dark:text-red-400`}
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Delete ${player.name}? This can't be undone.`)) remove.mutate();
          }}
        >
          {remove.isPending ? 'Deleting…' : 'Delete player'}
        </button>
      </div>
      <FormError message={remove.error?.message ?? null} />
    </div>
  );
}

/** The signed-in user's roster and claimed player, for the account page. */
export function MyRoster({ userId }: { userId: string }) {
  const roster = usePlayers(userId);
  const claimed = usePlayerList({ claimedBy: userId }).data?.[0];
  return (
    <section className="space-y-3 border-t border-slate-200 pt-6 dark:border-slate-800">
      <h2 className="text-lg font-medium">My player</h2>
      {claimed ? (
        <p className="text-sm">
          You&apos;re <Link to={`/players/${claimed.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">{claimed.name}</Link>
          {claimed.createdBy !== userId && ` in ${claimed.ownerName ?? 'an unnamed user'}'s roster`}.
        </p>
      ) : (
        <p className="text-sm text-slate-500">Not linked yet. Open your player&apos;s page and press &ldquo;This is me&rdquo;.</p>
      )}
      <h2 className="pt-3 text-lg font-medium">My roster</h2>
      <FormError message={roster.error?.message ?? null} />
      {roster.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {roster.data?.length === 0 && <p className="text-sm text-slate-500">No players yet. Players are added when you log or import a game.</p>}
      {roster.data && roster.data.length > 0 && (
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
          {roster.data.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <Link to={`/players/${p.id}`} className="flex-1 font-medium hover:underline">
                {p.name}
              </Link>
              <span className="text-xs text-slate-500">
                {[p.archived && 'archived', p.claimedByName && `claimed by ${p.claimedByName}`, `${p.games} ${p.games === 1 ? 'game' : 'games'}`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
