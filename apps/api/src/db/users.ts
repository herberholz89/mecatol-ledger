import { neon } from '@neondatabase/serverless';
import type { AppUser } from './schema.js';

// These run on every signed-in request, so they're plain SQL over the HTTP driver rather than
// Drizzle-built queries: building the query costs CPU, and the free plan allows 10 ms per request.

const RETURNING = 'returning id, email, display_name, role, created_at';

/**
 * Creates or refreshes a user's app_users row. $1 id, $2 email, $3 is-admin (from ADMIN_EMAILS).
 * The email is refreshed from the session. Admins are promoted; nobody is demoted here, so roles
 * granted later by an admin stick.
 */
export const UPSERT_APP_USER_SQL = `
insert into app_users (id, email, role)
values ($1, $2, case when $3::boolean then 'admin' else 'user' end)
on conflict (id) do update set
  email = excluded.email,
  role = case when $3::boolean then 'admin' else app_users.role end
${RETURNING}`;

/** $1 id, $2 display name. */
export const UPDATE_DISPLAY_NAME_SQL = `update app_users set display_name = $2 where id = $1 ${RETURNING}`;

interface AppUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  created_at: Date | string;
}

export function toAppUser(row: AppUserRow): AppUser {
  if (row.role !== 'user' && row.role !== 'admin') throw new Error(`Unexpected role ${row.role}`);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: new Date(row.created_at),
  };
}

async function one(databaseUrl: string, text: string, params: unknown[]): Promise<AppUser | undefined> {
  const rows = (await neon(databaseUrl).query(text, params)) as AppUserRow[];
  return rows[0] && toAppUser(rows[0]);
}

export async function upsertAppUser(
  databaseUrl: string,
  input: { id: string; email: string; isAdmin: boolean },
): Promise<AppUser> {
  const user = await one(databaseUrl, UPSERT_APP_USER_SQL, [input.id, input.email, input.isAdmin]);
  if (!user) throw new Error('upsert into app_users returned no row');
  return user;
}

export async function updateDisplayName(databaseUrl: string, id: string, displayName: string): Promise<AppUser> {
  const user = await one(databaseUrl, UPDATE_DISPLAY_NAME_SQL, [id, displayName]);
  if (!user) throw new Error(`app_users row ${id} not found`);
  return user;
}
