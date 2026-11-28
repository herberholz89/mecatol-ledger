import type { RosterPlayer } from '@mecatol/shared';
import { HttpError } from '../http-error.js';
import { isUniqueViolation, rows, type Db, type Queryable } from './sql.js';

interface PlayerRow {
  id: number;
  name: string;
  archived: boolean;
  created_by: string;
  owner_name: string | null;
  user_id: string | null;
  claimed_by_name: string | null;
  games: number;
}

const toPlayer = (r: PlayerRow): RosterPlayer => ({
  id: r.id,
  name: r.name,
  archived: r.archived,
  createdBy: r.created_by,
  ownerName: r.owner_name,
  userId: r.user_id,
  claimedByName: r.claimed_by_name,
  games: r.games,
});

/** Columns of a RosterPlayer, from `p` (players or a CTE of updated rows). Use with PLAYER_JOINS. */
const PLAYER_COLUMNS = `p.id, p.name, p.archived, p.created_by, u.display_name as owner_name, p.user_id,
  cu.display_name as claimed_by_name,
  (select count(*) from game_players gp where gp.player_id = p.id)::int as games`;
const PLAYER_JOINS = 'join app_users u on u.id = p.created_by left join app_users cu on cu.id = p.user_id';

/** All players, one roster, or the player an account claimed. Sorted by name, ignoring case. */
export async function listPlayers(
  db: Queryable,
  filter: { createdBy?: string | undefined; claimedBy?: string | undefined } = {},
): Promise<RosterPlayer[]> {
  const conditions: string[] = [];
  const values: string[] = [];
  if (filter.createdBy) conditions.push(`p.created_by = $${values.push(filter.createdBy)}`);
  if (filter.claimedBy) conditions.push(`p.user_id = $${values.push(filter.claimedBy)}`);
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const result = await rows<PlayerRow>(
    db,
    `select ${PLAYER_COLUMNS} from players p ${PLAYER_JOINS} ${where} order by lower(p.name), p.id`,
    values,
  );
  return result.map(toPlayer);
}

export async function getPlayer(db: Queryable, id: number): Promise<RosterPlayer | undefined> {
  const [row] = await rows<PlayerRow>(db, `select ${PLAYER_COLUMNS} from players p ${PLAYER_JOINS} where p.id = $1`, [id]);
  return row && toPlayer(row);
}

const duplicateName = (name: string, existing?: RosterPlayer) =>
  new HttpError(409, `${name} is already in this roster`, existing ? { player: existing } : {});

/** Adds a player to `createdBy`'s roster. 409 (with the existing player) if the name is taken, ignoring case. */
export async function createPlayer(db: Queryable, createdBy: string, name: string): Promise<RosterPlayer> {
  const [row] = await rows<PlayerRow>(
    db,
    `with p as (
       insert into players (name, created_by) values ($1, $2)
       on conflict (created_by, lower(name)) do nothing
       returning *
     )
     select ${PLAYER_COLUMNS} from p ${PLAYER_JOINS}`,
    [name, createdBy],
  );
  if (row) return toPlayer(row);
  const [existing] = await rows<PlayerRow>(
    db,
    `select ${PLAYER_COLUMNS} from players p ${PLAYER_JOINS}
     where p.created_by = $1 and lower(p.name) = lower($2)`,
    [createdBy, name],
  );
  throw duplicateName(name, existing && toPlayer(existing));
}

export async function updatePlayer(
  db: Queryable,
  id: number,
  change: { name?: string | undefined; archived?: boolean | undefined },
): Promise<RosterPlayer> {
  try {
    const [row] = await rows<PlayerRow>(
      db,
      `with p as (
         update players set name = coalesce($2, name), archived = coalesce($3, archived)
         where id = $1 returning *
       )
       select ${PLAYER_COLUMNS} from p ${PLAYER_JOINS}`,
      [id, change.name ?? null, change.archived ?? null],
    );
    if (!row) throw new HttpError(404, 'Player not found');
    return toPlayer(row);
  } catch (err) {
    if (isUniqueViolation(err, 'players_roster_name_unique')) throw duplicateName(change.name ?? 'That name');
    throw err;
  }
}

/**
 * Links `player` to `userId` ("This is me"). Idempotent for the same account. 409 if another
 * account claimed it first, or if this account already claimed a different player.
 */
export async function claimPlayer(db: Queryable, player: RosterPlayer, userId: string): Promise<RosterPlayer> {
  if (player.userId === userId) return player;
  if (player.userId !== null) throw new HttpError(409, `${player.name} is already claimed by ${player.claimedByName ?? 'another account'}`);
  try {
    const [row] = await rows<PlayerRow>(
      db,
      `with p as (update players set user_id = $2 where id = $1 and user_id is null returning *)
       select ${PLAYER_COLUMNS} from p ${PLAYER_JOINS}`,
      [player.id, userId],
    );
    // Claimed by someone else between the read and the write.
    if (!row) throw new HttpError(409, `${player.name} is already claimed by another account`);
    return toPlayer(row);
  } catch (err) {
    if (!isUniqueViolation(err, 'one_player_per_user')) throw err;
    const [claimed] = await listPlayers(db, { claimedBy: userId });
    throw new HttpError(409, `You've already claimed ${claimed?.name ?? 'another player'}. Remove that claim first.`, {
      ...(claimed ? { player: claimed } : {}),
    });
  }
}

/** Removes the claim on `id`. The route checks who may do this. */
export async function unclaimPlayer(db: Queryable, id: number): Promise<RosterPlayer> {
  const [row] = await rows<PlayerRow>(
    db,
    `with p as (update players set user_id = null where id = $1 returning *)
     select ${PLAYER_COLUMNS} from p ${PLAYER_JOINS}`,
    [id],
  );
  if (!row) throw new HttpError(404, 'Player not found');
  return toPlayer(row);
}

/**
 * Moves every seat of `from` to `into` (same roster) and deletes `from`, in one transaction.
 * A claim on `from` moves to `into`. 409 if both played in the same game, or both are claimed.
 */
export async function mergePlayers(db: Db, from: RosterPlayer, into: RosterPlayer): Promise<RosterPlayer> {
  if (from.id === into.id) throw new HttpError(400, "Can't merge a player into itself");
  if (from.createdBy !== into.createdBy) throw new HttpError(400, 'Only players in the same roster can be merged');
  if (from.userId !== null && into.userId !== null) {
    throw new HttpError(409, 'Both players are claimed by different accounts. Remove one claim first.');
  }
  const [shared] = await rows<{ count: number }>(
    db,
    `select count(*)::int as count from game_players a join game_players b using (game_id)
     where a.player_id = $1 and b.player_id = $2`,
    [from.id, into.id],
  );
  if (shared && shared.count > 0) throw sharedGames(from, into, shared.count);

  // Each statement repeats its guard: the batch can't read between steps. The seat move is checked
  // by the (game_id, player_id) primary key, so a game both joined since the check above fails it.
  const claim = from.userId;
  try {
    await db.batch([
      {
        text: `update game_players set player_id = $2 where player_id = $1
               and exists (select 1 from players where id = $2 and created_by = $3)`,
        values: [from.id, into.id, from.createdBy],
      },
      ...(claim === null
        ? []
        : [
            {
              text: `update players set user_id = null where id = $1 and user_id = $2
                     and exists (select 1 from players where id = $3 and user_id is null)`,
              values: [from.id, claim, into.id],
            },
            { text: 'update players set user_id = $2 where id = $1 and user_id is null', values: [into.id, claim] },
          ]),
      {
        text: `delete from players where id = $1 and created_by = $2
               and exists (select 1 from players where id = $3 and created_by = $2)`,
        values: [from.id, from.createdBy, into.id],
      },
    ]);
  } catch (err) {
    if (isUniqueViolation(err, 'game_players_game_id_player_id_pk')) throw sharedGames(from, into);
    // A seat added for `from` while `into` was deleted: the delete's foreign key stops it.
    if (isForeignKeyViolation(err)) throw new HttpError(409, `${into.name} no longer exists`);
    throw err;
  }
  const merged = await getPlayer(db, into.id);
  if (!merged) throw new HttpError(409, `${into.name} no longer exists`);
  return merged;
}

const sharedGames = (from: RosterPlayer, into: RosterPlayer, count?: number) =>
  new HttpError(
    409,
    `${from.name} and ${into.name} played in the same game${count === undefined || count === 1 ? '' : ` (${count} games)`}, so they can't be the same person`,
  );

/** Deletes a player who isn't in any games. 409 otherwise (archive or merge them instead). */
export async function deletePlayer(db: Queryable, player: RosterPlayer): Promise<void> {
  const inGames = () =>
    new HttpError(409, `${player.name} is in games, so they can't be deleted. Archive or merge them instead.`);
  try {
    const deleted = await rows<{ id: number }>(
      db,
      `delete from players p where p.id = $1
       and not exists (select 1 from game_players gp where gp.player_id = p.id) returning p.id`,
      [player.id],
    );
    if (deleted.length > 0) return;
  } catch (err) {
    // A seat inserted at the same moment.
    if (isForeignKeyViolation(err)) throw inGames();
    throw err;
  }
  if (await getPlayer(db, player.id)) throw inGames();
  throw new HttpError(404, 'Player not found');
}

function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23503';
}
