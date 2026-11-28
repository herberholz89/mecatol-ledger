import type { Player } from '@mecatol/shared';
import { HttpError } from '../http-error.js';
import { isUniqueViolation, rows, type Queryable } from './sql.js';

interface PlayerRow {
  id: number;
  name: string;
  archived: boolean;
  created_by: string;
  owner_name: string | null;
}

const toPlayer = (r: PlayerRow): Player => ({
  id: r.id,
  name: r.name,
  archived: r.archived,
  createdBy: r.created_by,
  ownerName: r.owner_name,
});

const PLAYER_COLUMNS = 'p.id, p.name, p.archived, p.created_by, u.display_name as owner_name';

/** All players, or one roster. Sorted by name, ignoring case. */
export async function listPlayers(db: Queryable, filter: { createdBy?: string | undefined } = {}): Promise<Player[]> {
  const where = filter.createdBy ? 'where p.created_by = $1' : '';
  const values = filter.createdBy ? [filter.createdBy] : [];
  const result = await rows<PlayerRow>(
    db,
    `select ${PLAYER_COLUMNS} from players p join app_users u on u.id = p.created_by ${where}
     order by lower(p.name), p.id`,
    values,
  );
  return result.map(toPlayer);
}

export async function getPlayer(db: Queryable, id: number): Promise<Player | undefined> {
  const [row] = await rows<PlayerRow>(
    db,
    `select ${PLAYER_COLUMNS} from players p join app_users u on u.id = p.created_by where p.id = $1`,
    [id],
  );
  return row && toPlayer(row);
}

const duplicateName = (name: string, existing?: Player) =>
  new HttpError(409, `${name} is already in this roster`, existing ? { player: existing } : {});

/** Adds a player to `createdBy`'s roster. 409 (with the existing player) if the name is taken, ignoring case. */
export async function createPlayer(db: Queryable, createdBy: string, name: string): Promise<Player> {
  const [row] = await rows<PlayerRow>(
    db,
    `with ins as (
       insert into players (name, created_by) values ($1, $2)
       on conflict (created_by, lower(name)) do nothing
       returning *
     )
     select ${PLAYER_COLUMNS} from ins p join app_users u on u.id = p.created_by`,
    [name, createdBy],
  );
  if (row) return toPlayer(row);
  const [existing] = await rows<PlayerRow>(
    db,
    `select ${PLAYER_COLUMNS} from players p join app_users u on u.id = p.created_by
     where p.created_by = $1 and lower(p.name) = lower($2)`,
    [createdBy, name],
  );
  throw duplicateName(name, existing && toPlayer(existing));
}

export async function updatePlayer(
  db: Queryable,
  id: number,
  change: { name?: string | undefined; archived?: boolean | undefined },
): Promise<Player> {
  try {
    const [row] = await rows<PlayerRow>(
      db,
      `with upd as (
         update players set name = coalesce($2, name), archived = coalesce($3, archived)
         where id = $1 returning *
       )
       select ${PLAYER_COLUMNS} from upd p join app_users u on u.id = p.created_by`,
      [id, change.name ?? null, change.archived ?? null],
    );
    if (!row) throw new HttpError(404, 'Player not found');
    return toPlayer(row);
  } catch (err) {
    if (isUniqueViolation(err, 'players_roster_name_unique')) throw duplicateName(change.name ?? 'That name');
    throw err;
  }
}
