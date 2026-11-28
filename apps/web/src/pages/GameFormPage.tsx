import { canEditGame, type GameInput } from '@mecatol/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { createGame, fetchGame, updateGame } from '../api.js';
import { FormError } from '../components/form.js';
import { GameForm } from '../components/GameForm.js';
import { queryKeys, useFactions, usePlayers } from '../queries.js';
import { useMe } from '../useMe.js';

/** `/games/new` and `/games/:id/edit`. */
export function GameFormPage() {
  const params = useParams();
  const editId = params.id ? Number(params.id) : undefined;
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const game = useQuery({
    queryKey: queryKeys.game(editId ?? 0),
    queryFn: () => fetchGame(editId ?? 0),
    enabled: editId !== undefined,
  });
  // Seats come from the game creator's roster: yours for a new game.
  const ownerId = editId === undefined ? me.data?.id : game.data?.createdBy.id;
  const players = usePlayers(ownerId);
  const factions = useFactions();

  if (me.isPending) return <p>Loading…</p>;
  if (!me.data) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (editId !== undefined && game.isError) return <FormError message={game.error.message} />;
  if (editId !== undefined && game.data && !canEditGame(me.data, game.data.createdBy.id)) {
    return <FormError message="Only the person who logged this game or an admin can edit it." />;
  }
  const error = players.error ?? factions.error;
  if (error) return <FormError message={error.message} />;
  if (!players.data || !factions.data || (editId !== undefined && !game.data) || !ownerId) return <p>Loading…</p>;

  async function save(input: GameInput) {
    const saved = editId === undefined ? await createGame(input) : await updateGame(editId, input);
    queryClient.setQueryData(queryKeys.game(saved.id), saved);
    await queryClient.invalidateQueries({ queryKey: queryKeys.games });
    await navigate(`/games/${saved.id}`);
  }

  const isOwner = ownerId === me.data.id;
  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <Link to={editId === undefined ? '/games' : `/games/${editId}`} className="text-sm text-slate-500 hover:underline">
          ← {editId === undefined ? 'Games' : 'Back to game'}
        </Link>
        <h1 className="text-2xl font-semibold">{editId === undefined ? 'Log a game' : 'Edit game'}</h1>
        {!isOwner && game.data && (
          <p className="mt-1 text-sm text-slate-500">
            Editing {game.data.createdBy.displayName ?? 'another user'}&apos;s game as admin. Players come from their roster.
          </p>
        )}
      </div>
      {players.data.length < 2 && isOwner && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Your roster has {players.data.length === 0 ? 'no players' : 'one player'} yet. Add the people you played with below.
        </p>
      )}
      <GameForm
        key={game.data?.updatedAt ?? 'new'}
        initial={game.data}
        players={players.data}
        factions={factions.data}
        canAddPlayers={isOwner}
        submitLabel={editId === undefined ? 'Save game' : 'Save changes'}
        onSubmit={save}
      />
    </section>
  );
}
