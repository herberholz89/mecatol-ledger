import type { GameDetail, GameInput, GamesPage, GamesQuery, GameSummary, SeatInput } from '@mecatol/shared';
import type { AppUser } from './schema.js';
import { forbidden, HttpError, notFound } from '../http-error.js';
import { iso, rows, type Db, type Queryable } from './sql.js';

interface SummaryRow {
  id: number;
  played_on: string | null;
  vp_target: number;
  ended_early: boolean;
  player_count: number;
  point_spread: number;
  winner_points: number;
  winner_player_id: number;
  winner_player_name: string;
  winner_faction_id: number;
  winner_faction_name: string;
  created_by: string;
  created_by_name: string | null;
  created_at: Date | string;
}

interface DetailRow extends SummaryRow {
  notes: string | null;
  updated_at: Date | string;
  seats: {
    player_id: number;
    player_name: string;
    player_archived: boolean;
    faction_id: number;
    faction_name: string;
    faction_archived: boolean;
    points: number;
    is_winner: boolean;
  }[];
}

// `played_on::text` keeps dates as YYYY-MM-DD; drivers would otherwise turn them into
// local-midnight Date objects.
const SUMMARY_COLUMNS = `
  gs.game_id as id, gs.played_on::text as played_on, gs.vp_target, gs.ended_early,
  gs.player_count, gs.point_spread, gs.winner_points,
  wp.id as winner_player_id, wp.name as winner_player_name,
  wf.id as winner_faction_id, wf.name as winner_faction_name,
  gs.created_by, u.display_name as created_by_name, gs.created_at`;

const SUMMARY_JOINS = `
  join players wp on wp.id = gs.winner_player_id
  join factions wf on wf.id = gs.winner_faction_id
  join app_users u on u.id = gs.created_by`;

/** Seats as JSON, highest points first, so a game's detail is one query. */
const SEATS_JSON = `
  (select json_agg(json_build_object(
            'player_id', p.id, 'player_name', p.name, 'player_archived', p.archived,
            'faction_id', f.id, 'faction_name', f.name, 'faction_archived', f.archived,
            'points', s.points, 'is_winner', s.is_winner)
          order by s.points desc, s.is_winner desc, lower(p.name))
   from game_players s join players p on p.id = s.player_id join factions f on f.id = s.faction_id
   where s.game_id = gs.game_id)`;

const ORDER = 'order by gs.played_on desc nulls last, gs.game_id desc';

function toSummary(r: SummaryRow): GameSummary {
  return {
    id: r.id,
    playedOn: r.played_on,
    vpTarget: r.vp_target,
    endedEarly: r.ended_early,
    playerCount: r.player_count,
    pointSpread: r.point_spread,
    winner: {
      player: { id: r.winner_player_id, name: r.winner_player_name },
      faction: { id: r.winner_faction_id, name: r.winner_faction_name },
      points: r.winner_points,
    },
    createdBy: { id: r.created_by, displayName: r.created_by_name },
    createdAt: iso(r.created_at),
  };
}

/** Newest first (undated games last). `userId` is required when `query.mine` is set. */
export async function listGames(db: Queryable, query: GamesQuery, userId: string | null): Promise<GamesPage> {
  const where: string[] = [];
  const values: unknown[] = [];
  const param = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  if (query.playerId !== undefined) {
    where.push(`exists (select 1 from game_players x where x.game_id = gs.game_id and x.player_id = ${param(query.playerId)})`);
  }
  if (query.factionId !== undefined) {
    where.push(`exists (select 1 from game_players x where x.game_id = gs.game_id and x.faction_id = ${param(query.factionId)})`);
  }
  if (query.playerCount !== undefined) where.push(`gs.player_count = ${param(query.playerCount)}`);
  if (query.from !== undefined) where.push(`gs.played_on >= ${param(query.from)}::date`);
  if (query.to !== undefined) where.push(`gs.played_on <= ${param(query.to)}::date`);
  if (query.mine) {
    if (!userId) throw new HttpError(401, 'Not signed in');
    where.push(`gs.created_by = ${param(userId)}`);
  }
  // Fetch one extra row to know whether there's another page.
  const sql = `select ${SUMMARY_COLUMNS} from game_summary gs ${SUMMARY_JOINS} ${where.length ? `where ${where.join(' and ')}` : ''} ${ORDER}
    limit ${param(query.limit + 1)} offset ${param(query.offset)}`;
  const result = await rows<SummaryRow>(db, sql, values);
  const hasMore = result.length > query.limit;
  return {
    games: result.slice(0, query.limit).map(toSummary),
    nextOffset: hasMore ? query.offset + query.limit : null,
  };
}

export async function getGame(db: Queryable, id: number): Promise<GameDetail | undefined> {
  const [row] = await rows<DetailRow>(
    db,
    `select ${SUMMARY_COLUMNS}, g.notes, g.updated_at, ${SEATS_JSON} as seats
     from game_summary gs join games g on g.id = gs.game_id ${SUMMARY_JOINS}
     where gs.game_id = $1`,
    [id],
  );
  if (!row) return undefined;
  return {
    ...toSummary(row),
    notes: row.notes,
    updatedAt: iso(row.updated_at),
    seats: row.seats.map((s) => ({
      player: { id: s.player_id, name: s.player_name, archived: s.player_archived },
      faction: { id: s.faction_id, name: s.faction_name, archived: s.faction_archived },
      points: s.points,
      isWinner: s.is_winner,
    })),
  };
}

interface WriteContext {
  /** The existing game's creator; null for a new game or a missing one. */
  game_owner: string | null;
  players: { id: number; name: string; archived: boolean; created_by: string }[] | null;
  factions: { id: number; name: string; archived: boolean }[] | null;
  previous: { player_id: number; faction_id: number }[] | null;
}

/** Everything a write needs to check, in one round trip. `gameId` is null for a new game. */
async function loadWriteContext(db: Queryable, seats: SeatInput[], gameId: number | null): Promise<WriteContext> {
  const [ctx] = await rows<WriteContext>(
    db,
    `select
       (select created_by from games where id = $3) as game_owner,
       (select json_agg(json_build_object('id', id, 'name', name, 'archived', archived, 'created_by', created_by))
          from players where id = any($1::int[])) as players,
       (select json_agg(json_build_object('id', id, 'name', name, 'archived', archived))
          from factions where id = any($2::int[])) as factions,
       (select json_agg(json_build_object('player_id', player_id, 'faction_id', faction_id))
          from game_players where game_id = $3) as previous`,
    [seats.map((s) => s.playerId), seats.map((s) => s.factionId), gameId],
  );
  if (!ctx) throw new Error('write context query returned no row');
  return ctx;
}

/**
 * Checks that every seat's player is in the owner's roster and every faction exists. Archived
 * players and factions are refused unless they were already in the game being edited.
 */
function checkSeatRefs(ctx: WriteContext, ownerId: string, seats: SeatInput[]): void {
  const playerById = new Map((ctx.players ?? []).map((p) => [p.id, p]));
  const factionById = new Map((ctx.factions ?? []).map((f) => [f.id, f]));
  const hadPlayer = new Set((ctx.previous ?? []).map((p) => p.player_id));
  const hadFaction = new Set((ctx.previous ?? []).map((p) => p.faction_id));

  const issue = (i: number, field: 'playerId' | 'factionId', message: string) =>
    new HttpError(400, message, { issues: [{ code: 'custom', path: ['seats', i, field], message }] });

  seats.forEach((seat, i) => {
    const player = playerById.get(seat.playerId);
    if (!player || player.created_by !== ownerId) throw issue(i, 'playerId', "That player isn't in this game's roster");
    if (player.archived && !hadPlayer.has(player.id)) throw issue(i, 'playerId', `${player.name} is archived`);
    const faction = factionById.get(seat.factionId);
    if (!faction) throw issue(i, 'factionId', 'Unknown faction');
    if (faction.archived && !hadFaction.has(faction.id)) throw issue(i, 'factionId', `${faction.name} is archived`);
  });
}

/** Seat arrays for `unnest`, in the order the statements below expect. */
const seatArrays = (game: GameInput) => [
  game.seats.map((s) => s.playerId),
  game.seats.map((s) => s.factionId),
  game.seats.map((s) => s.points),
];

/**
 * Seats must use the creator's roster. The game and its seats are inserted by one statement, so
 * they're atomic without a transaction (data-modifying CTEs). Returns the new game id.
 */
export async function createGame(db: Queryable, user: AppUser, game: GameInput): Promise<number> {
  checkSeatRefs(await loadWriteContext(db, game.seats, null), user.id, game.seats);
  const [row] = await rows<{ id: number }>(
    db,
    `with g as (
       insert into games (played_on, vp_target, ended_early, notes, created_by)
       values ($1, $2, $3, $4, $5) returning id
     ), seats as (
       insert into game_players (game_id, player_id, faction_id, points, is_winner)
       select g.id, s.player_id, s.faction_id, s.points, s.player_id = $6
       from g, unnest($7::int[], $8::int[], $9::int[]) as s(player_id, faction_id, points)
     )
     select id from g`,
    [game.playedOn, game.vpTarget, game.endedEarly, game.notes, user.id, game.winnerPlayerId, ...seatArrays(game)],
  );
  if (!row) throw new Error('insert into games returned no row');
  return row.id;
}

/**
 * Owner or admin only. Replaces all seats. Seats must use the roster of the game's creator, so an
 * admin editing someone else's game picks from that person's roster.
 *
 * The update, seat delete and seat insert run as one batch (an HTTP transaction). They can't be one
 * statement: CTE parts run in no fixed order, so re-inserting a seat key the same statement deletes
 * could collide. Each statement repeats `id = $1 and created_by = $2`, so a game deleted after the
 * checks above leaves the batch doing nothing and the route answers 404.
 */
export async function updateGame(db: Db, id: number, user: AppUser, game: GameInput): Promise<void> {
  const ctx = await loadWriteContext(db, game.seats, id);
  const ownerId = ctx.game_owner;
  if (!ownerId) throw notFound('Game');
  if (user.role !== 'admin' && ownerId !== user.id) throw forbidden('Only the person who logged this game or an admin can change it');
  checkSeatRefs(ctx, ownerId, game.seats);

  const target = 'select id from games where id = $1 and created_by = $2';
  await db.batch([
    {
      text: `update games set played_on = $3, vp_target = $4, ended_early = $5, notes = $6, updated_at = now()
             where id in (${target})`,
      values: [id, ownerId, game.playedOn, game.vpTarget, game.endedEarly, game.notes],
    },
    { text: `delete from game_players where game_id in (${target})`, values: [id, ownerId] },
    {
      text: `insert into game_players (game_id, player_id, faction_id, points, is_winner)
             select t.id, s.player_id, s.faction_id, s.points, s.player_id = $3
             from (${target}) t, unnest($4::int[], $5::int[], $6::int[]) as s(player_id, faction_id, points)`,
      values: [id, ownerId, game.winnerPlayerId, ...seatArrays(game)],
    },
  ]);
}

/** Owner or admin only. Seats go with the game (on delete cascade). */
export async function deleteGame(db: Queryable, id: number, user: AppUser): Promise<void> {
  const [row] = await rows<{ deleted: boolean | null }>(
    db,
    `with target as (select id, created_by from games where id = $1),
          del as (delete from games g using target t
                  where g.id = t.id and ($2::boolean or t.created_by = $3) returning g.id)
     select (select count(*) from del) > 0 as deleted from target`,
    [id, user.role === 'admin', user.id],
  );
  if (!row) throw notFound('Game');
  if (!row.deleted) throw forbidden('Only the person who logged this game or an admin can delete it');
}
