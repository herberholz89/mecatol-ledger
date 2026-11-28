import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router';
import { signOut } from '../auth.js';
import { DisplayNameForm } from '../components/DisplayNameForm.js';
import { FormError } from '../components/form.js';
import { MyImports } from '../components/MyImports.js';
import { MyRoster } from '../components/PlayerTools.js';
import { ME_QUERY_KEY, useMe } from '../useMe.js';

export function AccountPage() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const out = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      // Leave the page before clearing the user, so the signed-out redirect to /signin doesn't fire.
      await navigate('/', { replace: true });
      queryClient.setQueryData(ME_QUERY_KEY, null);
    },
  });

  if (me.isPending) return <p>Loading…</p>;
  if (me.isError) return <FormError message={me.error.message} />;
  if (!me.data) return <Navigate to="/signin?next=/account" replace />;

  const user = me.data;
  return (
    <section className="max-w-lg space-y-8">
      <h1 className="text-2xl font-semibold">Account</h1>
      {!user.displayName && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Pick a display name to finish setting up your account.
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-slate-500">Email</dt>
        <dd>{user.email}</dd>
        <dt className="text-slate-500">Role</dt>
        <dd>{user.role === 'admin' ? 'Admin' : 'User'}</dd>
      </dl>
      <DisplayNameForm key={user.displayName ?? ''} initial={user.displayName} />
      <MyRoster userId={user.id} />
      <MyImports />
      <div className="border-t border-slate-200 pt-6 dark:border-slate-800">
        <FormError message={out.error?.message ?? null} />
        <button
          type="button"
          onClick={() => out.mutate()}
          disabled={out.isPending}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
        >
          {out.isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </section>
  );
}
