import type { Role } from '@mecatol/shared';
import { HttpError } from '../http-error.js';
import { iso, rows, type Queryable } from './sql.js';

export interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  createdAt: string;
  games: number;
  players: number;
}

const USER_COLUMNS = `u.id, u.email, u.display_name as "displayName", u.role, u.created_at as "createdAt",
  (select count(*) from games g where g.created_by = u.id)::int as games,
  (select count(*) from players p where p.created_by = u.id)::int as players`;

const toUser = (r: UserRow): UserRow => ({ ...r, createdAt: iso(r.createdAt) });

/** Every app user, admins first, then by email. Admin only (checked by the route). */
export async function listUsers(db: Queryable): Promise<UserRow[]> {
  const result = await rows<UserRow>(db, `select ${USER_COLUMNS} from app_users u order by u.role = 'admin' desc, u.email`);
  return result.map(toUser);
}

export async function getUser(db: Queryable, id: string): Promise<UserRow | undefined> {
  const [row] = await rows<UserRow>(db, `select ${USER_COLUMNS} from app_users u where u.id = $1`, [id]);
  return row && toUser(row);
}

export async function setUserRole(db: Queryable, id: string, role: Role): Promise<UserRow> {
  const [row] = await rows<UserRow>(
    db,
    `with u as (update app_users set role = $2 where id = $1 returning *) select ${USER_COLUMNS} from u`,
    [id, role],
  );
  if (!row) throw new HttpError(404, 'User not found');
  return toUser(row);
}
