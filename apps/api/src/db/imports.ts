import {
  playerRefKey,
  type CreatedImport,
  type ImportBatchInput,
  type ImportBatchSummary,
  type ImportChunkInput,
  type ImportGame,
} from '@mecatol/shared';
import type { AppUser } from './schema.js';
import { forbidden, HttpError, notFound } from '../http-error.js';
import { iso, isUniqueViolation, rows, type Queryable } from './sql.js';

interface BatchRow {
  id: number;
  source_name: string;
  created_at: Date | string;
  games: number;
}

const toSummary = (r: BatchRow): ImportBatchSummary => ({
  id: r.id,
  sourceName: r.source_name,
  createdAt: iso(r.created_at),
  games: r.games,
});

/** A user's imports, newest first, with how many games each still has. */
export async function listImports(db: Queryable, userId: string): Promise<ImportBatchSummary[]> {
  const result = await rows<BatchRow>(
    db,
    `select b.id, b.source_name, b.created_at, count(g.id)::int as games
     from import_batches b left join games g on g.import_batch_id = b.id
     where b.created_by = $1
     group by b.id
     order by b.created_at desc, b.id desc`,
    [userId],
  );
  return result.map(toSummary);
}

const seatIssue = (game: number, seat: number, field: string, message: string) =>
  new HttpError(400, `Game ${game + 1}: ${message}`, {
    issues: [{ code: 'custom', path: ['games', game, 'seats', seat, field], message }],
  });

/**
 * Checks the games against the database and resolves new player names that already exist in the
 * roster (ignoring case) to those players. Returns the names that still need creating. A later
 * chunk's names that an earlier chunk created resolve to those players here.
 */
async function resolveRefs(db: Queryable, userId: string, games: ImportGame[]): Promise<{ newNames: string[]; idByName: Map<string, number> }> {
  const playerIds = new Set<number>();
  const names = new Map<string, string>(); // lower → as written (first spelling wins)
  const factionIds = new Set<number>();
  for (const game of games) {
    for (const seat of game.seats) {
      if ('id' in seat.player) playerIds.add(seat.player.id);
      else if (!names.has(seat.player.name.toLowerCase())) names.set(seat.player.name.toLowerCase(), seat.player.name);
      factionIds.add(seat.factionId);
    }
  }

  const [ctx] = await rows<{ players: number[]; named: { id: number; lname: string }[] | null; factions: number[] }>(
    db,
    `select
       (select coalesce(array_agg(id), '{}') from players where created_by = $1 and id = any($2::int[])) as players,
       (select json_agg(json_build_object('id', id, 'lname', lower(name)))
          from players where created_by = $1 and lower(name) = any($3::text[])) as named,
       (select coalesce(array_agg(id), '{}') from factions where id = any($4::int[])) as factions`,
    [userId, [...playerIds], [...names.keys()], [...factionIds]],
  );
  if (!ctx) throw new Error('import context query returned no row');
  const roster = new Set(ctx.players);
  const knownFactions = new Set(ctx.factions);
  const idByName = new Map((ctx.named ?? []).map((p) => [p.lname, p.id]));

  games.forEach((game, g) => {
    const seen = new Map<string, number>();
    game.seats.forEach((seat, s) => {
      if ('id' in seat.player && !roster.has(seat.player.id)) throw seatIssue(g, s, 'player', "That player isn't in your roster");
      if (!knownFactions.has(seat.factionId)) throw seatIssue(g, s, 'factionId', 'Unknown faction');
      // A new name can turn out to be an existing player who's also in this game.
      const existing = 'name' in seat.player ? idByName.get(seat.player.name.toLowerCase()) : undefined;
      const key = existing === undefined ? playerRefKey(seat.player) : `id:${existing}`;
      const first = seen.get(key);
      if (first !== undefined) throw seatIssue(g, s, 'player', `Same player as seat ${first + 1}`);
      seen.set(key, s);
    });
  });

  const newNames = [...names.entries()].filter(([lower]) => !idByName.has(lower)).map(([, name]) => name);
  return { newNames, idByName };
}

/** A new batch named `sourceName`, or the existing batch `batchId` (only its creator can add to it). */
type Target = { sourceName: string } | { batchId: number };

/**
 * Writes any new roster players and the games and seats in one statement, so each request is all
 * or nothing without a transaction (data-modifying CTEs over Neon's HTTP driver). Game ids are
 * drawn from the sequence up front so seats can refer to them; they're drawn in order, so games
 * keep the order they were sent in. Returns null when adding to a batch that isn't the user's.
 *
 * Archived players and factions are allowed: imports are history.
 */
async function insertGames(db: Queryable, user: AppUser, target: Target, games: ImportGame[]): Promise<CreatedImport | null> {
  const { newNames, idByName } = await resolveRefs(db, user.id, games);

  const seatOrd: number[] = [];
  const seatPlayer: (number | null)[] = [];
  const seatNewName: (string | null)[] = [];
  const seatFaction: number[] = [];
  const seatPoints: number[] = [];
  const seatWinner: boolean[] = [];
  games.forEach((game, g) => {
    game.seats.forEach((seat, s) => {
      const existing = 'id' in seat.player ? seat.player.id : idByName.get(seat.player.name.toLowerCase());
      seatOrd.push(g + 1);
      seatPlayer.push(existing ?? null);
      seatNewName.push(existing === undefined && 'name' in seat.player ? seat.player.name : null);
      seatFaction.push(seat.factionId);
      seatPoints.push(seat.points);
      seatWinner.push(s === game.winner);
    });
  });

  // $2 is the new batch's name or the existing batch's id. Everything below is guarded by `b`, so
  // nothing is written when the batch isn't found.
  const batchCte =
    'sourceName' in target
      ? 'insert into import_batches (created_by, source_name) values ($1, $2::text) returning id, source_name, created_at'
      : 'select id, source_name, created_at from import_batches where id = $2::int and created_by = $1';

  try {
    const [row] = await rows<BatchRow & { new_players: number }>(
      db,
      `with b as (
         ${batchCte}
       ), new_p as (
         insert into players (name, created_by)
         select n, $1 from unnest($3::text[]) as n where exists (select 1 from b)
         returning id, lower(name) as lname
       ), ids as materialized (
         select ord::int, nextval(pg_get_serial_sequence('games', 'id'))::int as id
         from generate_series(1, cardinality($5::int[])) as ord where exists (select 1 from b) order by ord
       ), g as (
         insert into games (id, played_on, vp_target, ended_early, notes, created_by, import_batch_id)
         select ids.id, x.played_on, x.vp_target, x.ended_early, x.notes, $1, b.id
         from b, unnest($4::date[], $5::int[], $6::boolean[], $7::text[]) with ordinality
                   as x(played_on, vp_target, ended_early, notes, ord)
         join ids on ids.ord = x.ord
         returning id
       ), s as (
         insert into game_players (game_id, player_id, faction_id, points, is_winner)
         select ids.id, coalesce(s.player_id, new_p.id), s.faction_id, s.points, s.is_winner
         from unnest($8::int[], $9::int[], $10::text[], $11::int[], $12::int[], $13::boolean[])
                as s(ord, player_id, new_name, faction_id, points, is_winner)
         join ids on ids.ord = s.ord
         left join new_p on new_p.lname = lower(s.new_name)
         returning 1
       )
       select b.id, b.source_name, b.created_at,
              ((select count(*) from games where import_batch_id = b.id) + (select count(*) from g))::int as games,
              (select count(*) from new_p)::int as new_players
       from b`,
      [
        user.id,
        'sourceName' in target ? target.sourceName : target.batchId,
        newNames,
        games.map((g) => g.playedOn),
        games.map((g) => g.vpTarget),
        games.map((g) => g.endedEarly),
        games.map((g) => g.notes),
        seatOrd,
        seatPlayer,
        seatNewName,
        seatFaction,
        seatPoints,
        seatWinner,
      ],
    );
    return row ? { ...toSummary(row), newPlayers: row.new_players } : null;
  } catch (err) {
    // Someone added one of the new names to this roster between the check and the insert.
    if (isUniqueViolation(err, 'players_roster_name_unique')) {
      throw new HttpError(409, 'Your roster changed while importing. Reload the page and try again.');
    }
    throw err;
  }
}

/** Creates a batch with its first chunk of games. */
export async function createImport(db: Queryable, user: AppUser, batch: ImportBatchInput): Promise<CreatedImport> {
  const created = await insertGames(db, user, { sourceName: batch.sourceName }, batch.games);
  if (!created) throw new Error('import insert returned no row');
  return created;
}

/** Adds the next chunk of games to a batch the user created. Admins can't add to others' imports. */
export async function addImportGames(db: Queryable, batchId: number, user: AppUser, chunk: ImportChunkInput): Promise<CreatedImport> {
  const updated = await insertGames(db, user, { batchId }, chunk.games);
  if (!updated) throw notFound('Import');
  return updated;
}

/** Owner or admin only. The batch's games and their seats go with it (on delete cascade). */
export async function deleteImport(db: Queryable, id: number, user: AppUser): Promise<void> {
  const [row] = await rows<{ deleted: boolean }>(
    db,
    `with target as (select id, created_by from import_batches where id = $1),
          del as (delete from import_batches b using target t
                  where b.id = t.id and ($2::boolean or t.created_by = $3) returning b.id)
     select (select count(*) from del) > 0 as deleted from target`,
    [id, user.role === 'admin', user.id],
  );
  if (!row) throw notFound('Import');
  if (!row.deleted) throw forbidden('Only the person who imported this or an admin can undo it');
}
