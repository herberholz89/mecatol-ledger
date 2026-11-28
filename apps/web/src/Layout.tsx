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

export function Layout() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <nav className="flex items-center gap-6">
            <Link to="/" className="font-semibold tracking-tight">
              Mecatol Ledger
            </Link>
            <NavLink
              to="/games"
              className={({ isActive }) => `text-sm hover:underline ${isActive ? 'font-medium' : 'text-slate-600 dark:text-slate-400'}`}
            >
              Games
            </NavLink>
          </nav>
          <UserMenu />
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
