import { Link, NavLink, Outlet } from 'react-router';
import { useMe } from './useMe.js';

function UserMenu() {
  const me = useMe();
  if (me.isPending) return null;
  if (!me.data) {
    return (
      <Link to="/signin" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
        Sign in
      </Link>
    );
  }
  return (
    <Link to="/account" className="text-sm hover:underline">
      {me.data.displayName ?? me.data.email}
      {me.data.role === 'admin' && (
        <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          admin
        </span>
      )}
    </Link>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm hover:underline ${isActive ? 'font-medium' : 'text-slate-600 dark:text-slate-400'}`;

export function Layout() {
  const me = useMe();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800">
        {/* Phones: name and account on one row, the links on a second row that scrolls sideways if needed. */}
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 sm:flex-nowrap">
          <Link to="/" className="shrink-0 font-semibold tracking-tight">
            Mecatol Ledger
          </Link>
          <div className="shrink-0 sm:order-last">
            <UserMenu />
          </div>
          <nav className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-x-6 overflow-x-auto px-4 py-1 whitespace-nowrap sm:mx-0 sm:w-auto sm:flex-1 sm:overflow-visible sm:px-0">
            <NavLink to="/games" className={navClass}>
              Games
            </NavLink>
            <NavLink to="/factions" className={navClass}>
              Factions
            </NavLink>
            <NavLink to="/players" className={navClass}>
              Players
            </NavLink>
            {me.data && (
              <NavLink to="/import" className={navClass}>
                Import
              </NavLink>
            )}
            {me.data?.role === 'admin' && (
              <NavLink to="/admin" className={navClass}>
                Admin
              </NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-5xl px-4 py-6 text-xs text-slate-500">
        A stats tracker for Twilight Imperium games. Not affiliated with Fantasy Flight Games.
      </footer>
    </div>
  );
}
