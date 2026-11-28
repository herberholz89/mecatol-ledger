import { canEditGame } from '@mecatol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { deleteGame, fetchGame } from '../api.js';
import { FormError } from '../components/form.js';
import { formatDate } from '../format.js';
import { queryKeys } from '../queries.js';
import { useMe } from '../useMe.js';

export function GameDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const game = useQuery({ queryKey: queryKeys.game(id), queryFn: () => fetchGame(id), enabled: Number.isInteger(id) });
  const remove = useMutation({
    mutationFn: () => deleteGame(id),
    onSuccess: async () => {
      await navigate('/games', { replace: true });
      queryClient.removeQueries({ queryKey: queryKeys.game(id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.games });
    },
  });

  if (game.isError) return <FormError message={game.error.message} />;
  if (!game.data) return <p>Loading…</p>;
  const g = game.data;

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <Link to="/games" className="text-sm text-slate-500 hover:underline">
          ← Games
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold">{formatDate(g.playedOn)}</h1>
          {canEditGame(me.data, g.createdBy.id) && (
            <div className="flex gap-3 text-sm">
              <Link to={`/games/${g.id}/edit`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                Edit
              </Link>
              <button
                type="button"
                className="text-red-600 hover:underline disabled:opacity-60"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm('Delete this game? This cannot be undone.')) remove.mutate();
                }}
              >
                {remove.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          )}
        </div>
        <p className="text-sm text-slate-500">
          {g.playerCount} players · {g.vpTarget} VP game{g.endedEarly ? ' · ended early' : ''} · spread {g.pointSpread}
        </p>
      </div>
      <FormError message={remove.error?.message ?? null} />

      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800">
          <tr>
            <th className="py-2 font-medium">Player</th>
            <th className="py-2 font-medium">Faction</th>
            <th className="py-2 text-right font-medium">Points</th>
          </tr>
        </thead>
        <tbody>
          {g.seats.map((s) => (
            <tr key={s.player.id} className={`border-b border-slate-100 dark:border-slate-900 ${s.isWinner ? 'font-semibold' : ''}`}>
              <td className="py-2">
                {s.player.name}
                {s.isWinner && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    winner
                  </span>
                )}
              </td>
              <td className="py-2">{s.faction.name}</td>
              <td className="py-2 text-right tabular-nums">{s.points}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {g.notes && (
        <div>
          <h2 className="mb-1 text-sm font-medium">Notes</h2>
          <p className="whitespace-pre-wrap text-sm">{g.notes}</p>
        </div>
      )}
      <p className="text-xs text-slate-500">Logged by {g.createdBy.displayName ?? 'someone without a display name'}.</p>
    </section>
  );
}
