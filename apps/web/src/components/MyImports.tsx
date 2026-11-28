import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { deleteImport, fetchImports } from '../api.js';
import { queryKeys } from '../queries.js';
import { FormError } from './form.js';

/** The signed-in user's spreadsheet imports, each with an undo button. */
export function MyImports() {
  const queryClient = useQueryClient();
  const imports = useQuery({ queryKey: queryKeys.imports, queryFn: fetchImports });
  const undo = useMutation({
    mutationFn: deleteImport,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.imports }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: ['game'] }),
      ]),
  });

  return (
    <section className="space-y-3 border-t border-slate-200 pt-6 dark:border-slate-800">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-medium">My imports</h2>
        <Link to="/import" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          Import a spreadsheet
        </Link>
      </div>
      <FormError message={imports.error?.message ?? undo.error?.message ?? null} />
      {imports.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {imports.data?.length === 0 && <p className="text-sm text-slate-500">You haven&apos;t imported anything.</p>}
      {imports.data && imports.data.length > 0 && (
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
          {imports.data.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-2">
              <span className="flex-1">
                <span className="font-medium">{b.sourceName}</span>
                <span className="block text-xs text-slate-500">
                  {new Date(b.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {b.games}{' '}
                  {b.games === 1 ? 'game' : 'games'}
                </span>
              </span>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:border-red-400 hover:text-red-700 disabled:opacity-60 dark:border-slate-700"
                disabled={undo.isPending}
                onClick={() => {
                  const what = `${b.games} ${b.games === 1 ? 'game' : 'games'}`;
                  if (window.confirm(`Undo "${b.sourceName}"? This deletes its ${what}. Players it added stay in your roster.`)) undo.mutate(b.id);
                }}
              >
                {undo.isPending && undo.variables === b.id ? 'Undoing…' : 'Undo'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
