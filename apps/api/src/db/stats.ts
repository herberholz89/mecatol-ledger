import type {
  Faction,
  FactionStats,
  FactionStatsDetail,
  Player,
  PlayerStats,
  PlayerStatsDetail,
  SeatResult,
  StatLine,
  StatsOverview,
  StatsQuery,
} from '@mecatol/shared';
import { rows, type Queryable } from './sql.js';

// Stats are aggregated in Postgres over the `seat_results` view (drizzle/0005_seat_results.sql):
// filters go in the WHERE clause, so they apply before grouping. Rates come back as float8 so the
// driver returns numbers rather than numeric strings.

/** Aggregate columns over `sr` (seat_results). */
const STAT_COLUMNS = `
  count(*)::int as games,
  (count(*) filter (where sr.is_winner))::int as wins,
  avg(sr.is_winner::int)::float8 as win_rate,
  avg(1.0 / sr.player_count)::float8 as expected_win_rate,
  avg(sr.points)::float8 as avg_points`;

interface StatRow {
  games: number | null;
  wins: number | null;
  win_rate: number | null;
  expected_win_rate: number | null;
  avg_points: number | null;
}

const toStatLine = (r: StatRow): StatLine => ({
  games: r.games ?? 0,
  wins: r.wins ?? 0,
  winRate: r.win_rate,
  expectedWinRate: r.expected_win_rate,
  avgPoints: r.avg_points,
});

/** Builds `$n` placeholders and the filter conditions on `sr`. `userId` is required when `query.mine` is set. */
class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
  /** The query's filters as `and ...` conditions on `sr`, or an empty string. */
  filters(query: StatsQuery, userId: string | null): string {
    const where: string[] = [];
    if (query.playerCount !== undefined) where.push(`sr.player_count = ${this.add(query.playerCount)}`);
    if (query.from !== undefined) where.push(`sr.played_on >= ${this.add(query.from)}::date`);
    if (query.to !== undefined) where.push(`sr.played_on <= ${this.add(query.to)}::date`);
    if (query.mine) {
      if (!userId) throw new Error('mine needs a user id');
      where.push(`sr.created_by = ${this.add(userId)}`);
    }
    return where.map((w) => ` and ${w}`).join('');
  }
}

/** Player columns, from `p` (players) and `u` (its roster owner). */
const PLAYER_JSON = `json_build_object('id', p.id, 'name', p.name, 'archived', p.archived, 'createdBy', p.created_by, 'ownerName', u.display_name)`;
const FACTION_JSON = `json_build_object('id', f.id, 'name', f.name, 'expansion', f.expansion, 'archived', f.archived)`;

// Most games first, then win rate. Stable on name/id so equal rows don't shuffle between loads.
const ORDER = 'order by games desc, win_rate desc nulls last';

/** Every faction that isn't archived, plus archived ones with games. Factions with no games have 0 games and null rates. */
export async function factionStats(db: Queryable, query: StatsQuery, userId: string | null): Promise<FactionStats[]> {
  const p = new Params();
  const result = await rows<StatRow & { faction: Faction }>(
    db,
    `select ${FACTION_JSON} as faction, s.*
     from factions f
     left join (select sr.faction_id, ${STAT_COLUMNS} from seat_results sr where true${p.filters(query, userId)} group by sr.faction_id) s
       on s.faction_id = f.id
     where not f.archived or s.games > 0
     order by coalesce(s.games, 0) desc, s.win_rate desc nulls last, f.name`,
    p.values,
  );
  return result.map((r) => ({ faction: r.faction, ...toStatLine(r) }));
}

/** Players with at least one game matching the filters. */
export async function playerStats(db: Queryable, query: StatsQuery, userId: string | null): Promise<PlayerStats[]> {
  const p = new Params();
  const result = await rows<StatRow & { player: Player }>(
    db,
    `select ${PLAYER_JSON} as player, s.*
     from (select sr.player_id, ${STAT_COLUMNS} from seat_results sr where true${p.filters(query, userId)} group by sr.player_id) s
     join players p on p.id = s.player_id
     join app_users u on u.id = p.created_by
     ${ORDER}, lower(p.name), p.id`,
    p.values,
  );
  return result.map((r) => ({ player: r.player, ...toStatLine(r) }));
}

interface DetailRow {
  totals: StatRow;
  breakdown: (StatRow & { faction?: Faction; player?: Player })[] | null;
  results: { gameId: number; playedOn: string | null; playerCount: number; isWinner: boolean }[] | null;
}

/** Oldest first; undated games (mostly old spreadsheet history) come before dated ones. */
const RESULTS_JSON = `json_agg(json_build_object('gameId', sr.game_id, 'playedOn', sr.played_on::text,
  'playerCount', sr.player_count, 'isWinner', sr.is_winner) order by sr.played_on asc nulls first, sr.game_id)`;

const toResults = (r: DetailRow): SeatResult[] => r.results ?? [];

/** Totals, record by player, and each result for one faction. Undefined if the faction doesn't exist. */
export async function factionStatsDetail(
  db: Queryable,
  factionId: number,
  query: StatsQuery,
  userId: string | null,
): Promise<FactionStatsDetail | undefined> {
  const p = new Params();
  const id = p.add(factionId);
  const filters = p.filters(query, userId);
  const [row] = await rows<DetailRow & { faction: Faction }>(
    db,
    `select ${FACTION_JSON} as faction,
       (select row_to_json(t) from (select ${STAT_COLUMNS} from seat_results sr where sr.faction_id = ${id}${filters}) t) as totals,
       (select json_agg(b) from (
          select ${PLAYER_JSON} as player, s.*
          from (select sr.player_id, ${STAT_COLUMNS} from seat_results sr where sr.faction_id = ${id}${filters} group by sr.player_id) s
          join players p on p.id = s.player_id join app_users u on u.id = p.created_by
          ${ORDER}, lower(p.name), p.id) b) as breakdown,
       (select ${RESULTS_JSON} from seat_results sr where sr.faction_id = ${id}${filters}) as results
     from factions f where f.id = ${id}`,
    p.values,
  );
  if (!row) return undefined;
  return {
    faction: row.faction,
    totals: toStatLine(row.totals),
    players: (row.breakdown ?? []).map((b) => ({ player: b.player as Player, ...toStatLine(b) })),
    results: toResults(row),
  };
}

/** Totals, record by faction, and each result for one player. Undefined if the player doesn't exist. */
export async function playerStatsDetail(
  db: Queryable,
  playerId: number,
  query: StatsQuery,
  userId: string | null,
): Promise<PlayerStatsDetail | undefined> {
  const p = new Params();
  const id = p.add(playerId);
  const filters = p.filters(query, userId);
  const [row] = await rows<DetailRow & { player: Player }>(
    db,
    `select ${PLAYER_JSON} as player,
       (select row_to_json(t) from (select ${STAT_COLUMNS} from seat_results sr where sr.player_id = ${id}${filters}) t) as totals,
       (select json_agg(b) from (
          select ${FACTION_JSON} as faction, s.*
          from (select sr.faction_id, ${STAT_COLUMNS} from seat_results sr where sr.player_id = ${id}${filters} group by sr.faction_id) s
          join factions f on f.id = s.faction_id
          ${ORDER}, f.name) b) as breakdown,
       (select ${RESULTS_JSON} from seat_results sr where sr.player_id = ${id}${filters}) as results
     from players p join app_users u on u.id = p.created_by where p.id = ${id}`,
    p.values,
  );
  if (!row) return undefined;
  return {
    player: row.player,
    totals: toStatLine(row.totals),
    factions: (row.breakdown ?? []).map((b) => ({ faction: b.faction as Faction, ...toStatLine(b) })),
    results: toResults(row),
  };
}

/** Headline numbers for the dashboard, with the same filters. */
export async function statsOverview(db: Queryable, query: StatsQuery, userId: string | null): Promise<StatsOverview> {
  const p = new Params();
  const filters = p.filters(query, userId);
  const [row] = await rows<StatsOverview>(
    db,
    `with sr as (select * from seat_results sr where true${filters})
     select
       count(distinct sr.game_id)::int as games,
       count(distinct sr.player_id)::int as players,
       count(distinct sr.faction_id)::int as "factionsPlayed",
       (select avg(gs.point_spread)::float8 from game_summary gs where gs.game_id in (select game_id from sr)) as "avgPointSpread"
     from sr`,
    p.values,
  );
  if (!row) throw new Error('stats overview returned no row');
  return row;
}
