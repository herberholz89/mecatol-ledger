import { EXPANSION_LABELS, EXPANSIONS, type AdminUser, type Expansion, type Faction, type Role } from '@mecatol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { createFaction, createFactionAlias, deleteFactionAlias, fetchUsers, updateFaction, updateUser } from '../api.js';
import { buttonClass, FormError, inputClass } from '../components/form.js';
import { queryKeys, useFactionAliases, useFactions } from '../queries.js';
import { useMe } from '../useMe.js';

const smallButton =
  'rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-900';
const cellInput =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900';
const sectionClass = 'space-y-4 border-t border-slate-200 pt-6 dark:border-slate-800';

/** Factions (and their aliases) feed the game form, importer and stats, so refresh all of them. */
function useRefreshFactions() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.factions }),
      queryClient.invalidateQueries({ queryKey: queryKeys.games }),
      queryClient.invalidateQueries({ queryKey: ['game'] }),
    ]);
}

export function AdminPage() {
  const me = useMe();
  if (me.isPending) return <p>Loading…</p>;
  if (!me.data) return <Navigate to="/signin?next=/admin" replace />;
  if (me.data.role !== 'admin') return <FormError message="This page is for admins." />;
  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-slate-500">
          Factions, aliases and roles. To delete any game, open it from the games list: admins see Edit and Delete on every game.
        </p>
      </div>
      <FactionsAdmin />
      <AliasesAdmin />
      <UsersAdmin myId={me.data.id} />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------------------------

function FactionsAdmin() {
  const factions = useFactions();
  const [showArchived, setShowArchived] = useState(true);
  const list = (factions.data ?? []).filter((f) => showArchived || !f.archived);
  return (
    <section className={sectionClass}>
      <div>
        <h2 className="text-lg font-medium">Factions</h2>
        <p className="text-sm text-slate-500">
          Factions are never deleted, because games use them. Archive one to hide it from the game form; its games and stats stay.
        </p>
      </div>
      <AddFactionForm />
      <FormError message={factions.error?.message ?? null} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived
      </label>
      <div className="text-sm">
        <div className="hidden grid-cols-[1fr_12rem_6.5rem] gap-3 border-b border-slate-200 py-2 text-xs text-slate-500 sm:grid dark:border-slate-800">
          <span>Name</span>
          <span>Expansion</span>
          <span className="text-right">Status</span>
        </div>
        {list.map((f) => (
          <FactionRow key={`${f.id}:${f.name}`} faction={f} />
        ))}
      </div>
    </section>
  );
}

function AddFactionForm() {
  const refresh = useRefreshFactions();
  const [name, setName] = useState('');
  const [expansion, setExpansion] = useState<Expansion>('thunders_edge');
  const add = useMutation({
    mutationFn: () => createFaction({ name, expansion }),
    onSuccess: async () => {
      setName('');
      await refresh();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) add.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="New faction name"
          placeholder="New faction name"
          className={`${inputClass} min-w-48 flex-1`}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
        <select aria-label="Expansion" className={`${inputClass} sm:w-56`} value={expansion} onChange={(e) => setExpansion(e.target.value as Expansion)}>
          {EXPANSIONS.map((x) => (
            <option key={x} value={x}>
              {EXPANSION_LABELS[x]}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass} disabled={!name.trim() || add.isPending}>
          {add.isPending ? 'Adding…' : 'Add faction'}
        </button>
      </div>
      <FormError message={add.error?.message ?? null} />
    </form>
  );
}

function FactionRow({ faction }: { faction: Faction }) {
  const refresh = useRefreshFactions();
  const [name, setName] = useState(faction.name);
  const save = useMutation({
    mutationFn: (change: Parameters<typeof updateFaction>[1]) => updateFaction(faction.id, change),
    onSuccess: refresh,
  });
  const renamed = name.trim() !== '' && name.trim() !== faction.name;
  return (
    // Phones: name on its own line, expansion and archive below it.
    <div className={`border-b border-slate-100 py-2 dark:border-slate-900 ${faction.archived ? 'text-slate-500' : ''}`}>
      <div className="grid grid-cols-[1fr_6.5rem] gap-2 sm:grid-cols-[1fr_12rem_6.5rem] sm:gap-3">
        <form
          className="col-span-2 flex gap-2 sm:col-span-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (renamed) save.mutate({ name });
          }}
        >
          <input aria-label={`Name of ${faction.name}`} className={cellInput} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          {renamed && (
            <button type="submit" className={smallButton} disabled={save.isPending}>
              Save
            </button>
          )}
        </form>
        <select
          aria-label={`Expansion of ${faction.name}`}
          className={cellInput}
          value={faction.expansion}
          disabled={save.isPending}
          onChange={(e) => save.mutate({ expansion: e.target.value as Expansion })}
        >
          {EXPANSIONS.map((x) => (
            <option key={x} value={x}>
              {EXPANSION_LABELS[x]}
            </option>
          ))}
        </select>
        <button type="button" className={`${smallButton} justify-self-end`} disabled={save.isPending} onClick={() => save.mutate({ archived: !faction.archived })}>
          {faction.archived ? 'Unarchive' : 'Archive'}
        </button>
      </div>
      {save.error && (
        <div className="pt-2">
          <FormError message={save.error.message} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------------------------

function AliasesAdmin() {
  const factions = useFactions();
  const aliases = useFactionAliases();
  const refresh = useRefreshFactions();
  const [alias, setAlias] = useState('');
  const [factionId, setFactionId] = useState('');
  const names = new Map((factions.data ?? []).map((f) => [f.id, f.name]));
  const add = useMutation({
    mutationFn: () => createFactionAlias({ alias, factionId: Number(factionId) }),
    onSuccess: async () => {
      setAlias('');
      await refresh();
    },
  });
  const remove = useMutation({ mutationFn: deleteFactionAlias, onSuccess: refresh });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (alias.trim() && factionId) add.mutate();
  };

  return (
    <section className={sectionClass}>
      <div>
        <h2 className="text-lg font-medium">Aliases</h2>
        <p className="text-sm text-slate-500">
          Other spellings the importer accepts. They&apos;re stored lowercased. Names already match ignoring case, spacing and a leading
          &ldquo;The&rdquo;, so add only real misspellings.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-1">
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Alias"
            placeholder="Spelling, e.g. necro virus"
            className={`${inputClass} min-w-48 flex-1`}
            value={alias}
            maxLength={100}
            onChange={(e) => setAlias(e.target.value)}
          />
          <select aria-label="Faction for the alias" className={`${inputClass} sm:w-56`} value={factionId} onChange={(e) => setFactionId(e.target.value)}>
            <option value="">Means…</option>
            {(factions.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass} disabled={!alias.trim() || !factionId || add.isPending}>
            {add.isPending ? 'Adding…' : 'Add alias'}
          </button>
        </div>
        <FormError message={add.error?.message ?? null} />
      </form>
      <FormError message={aliases.error?.message ?? remove.error?.message ?? null} />
      {aliases.data?.length === 0 && <p className="text-sm text-slate-500">No aliases.</p>}
      {aliases.data && aliases.data.length > 0 && (
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
          {aliases.data.map((a) => (
            <li key={a.alias} className="flex items-center gap-3 py-2">
              <span className="flex-1">
                <span className="font-mono">{a.alias}</span>
                <span className="text-slate-500"> → {names.get(a.factionId) ?? `faction ${a.factionId}`}</span>
              </span>
              <button
                type="button"
                className={`${smallButton} hover:border-red-400 hover:text-red-700`}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete the alias "${a.alias}"?`)) remove.mutate(a.alias);
                }}
              >
                {remove.isPending && remove.variables === a.alias ? 'Deleting…' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Users and roles
// ---------------------------------------------------------------------------------------------

function UsersAdmin({ myId }: { myId: string }) {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: queryKeys.users, queryFn: fetchUsers });
  const change = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => updateUser(id, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });

  return (
    <section className={sectionClass}>
      <div>
        <h2 className="text-lg font-medium">Users</h2>
        <p className="text-sm text-slate-500">
          Admins manage factions and aliases and can edit or delete anyone&apos;s games and players. A change can take up to a minute to apply.
        </p>
      </div>
      <FormError message={users.error?.message ?? change.error?.message ?? null} />
      {users.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {users.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800">
              <tr>
                <th className="py-2 font-medium">User</th>
                <th className="hidden py-2 pl-3 text-right font-medium sm:table-cell">Games logged</th>
                <th className="hidden py-2 pl-3 text-right font-medium sm:table-cell">Players</th>
                <th className="w-28 py-2 pl-3 font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <UserRow key={u.id} user={u} isMe={u.id === myId} pending={change.isPending} onChange={(role) => change.mutate({ id: u.id, role })} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function UserRow({ user, isMe, pending, onChange }: { user: AdminUser; isMe: boolean; pending: boolean; onChange: (role: Role) => void }) {
  const locked = isMe ? "You can't change your own role" : user.adminByEmail ? 'Listed in ADMIN_EMAILS, so always an admin' : null;
  return (
    <tr className="border-b border-slate-100 dark:border-slate-900">
      <td className="py-2">
        <span className="font-medium">{user.displayName ?? 'No display name'}</span>
        {isMe && <span className="text-slate-500"> (you)</span>}
        <span className="block text-xs text-slate-500">
          {user.email} · joined {new Date(user.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
        </span>
        <span className="block text-xs text-slate-500 sm:hidden">
          {user.games} {user.games === 1 ? 'game' : 'games'} logged · {user.players} {user.players === 1 ? 'player' : 'players'}
        </span>
        {locked && <span className="block text-xs text-slate-500">{locked}</span>}
      </td>
      <td className="hidden py-2 pl-3 text-right tabular-nums sm:table-cell">{user.games}</td>
      <td className="hidden py-2 pl-3 text-right tabular-nums sm:table-cell">{user.players}</td>
      <td className="py-2 pl-3 align-top">
        <select
          aria-label={`Role of ${user.email}`}
          className={cellInput}
          value={user.role}
          disabled={pending || locked !== null}
          title={locked ?? undefined}
          onChange={(e) => {
            const role = e.target.value as Role;
            const question = role === 'admin' ? `Make ${user.email} an admin?` : `Remove admin from ${user.email}?`;
            if (window.confirm(question)) onChange(role);
          }}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </td>
    </tr>
  );
}
