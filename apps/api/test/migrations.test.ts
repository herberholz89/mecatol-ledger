import { FACTION_ALIAS_SEED, FACTION_SEED } from '@mecatol/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { must } from './test-db.js';
import { toAppUser, UPDATE_DISPLAY_NAME_SQL, UPSERT_APP_USER_SQL } from '../src/db/users.js';

// Runs against a real Postgres: the CI service container, or a local database.
// Skipped when TEST_DATABASE_URL isn't set. The database is wiped first.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('migrations', () => {
  const pool = new pg.Pool({ connectionString: url });

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
    await migrate(drizzle({ client: pool }), { migrationsFolder: './drizzle' });
  });

  afterAll(() => pool.end());

  it('seeds the 30 factions from the shared list', async () => {
    const { rows } = await pool.query<{ name: string; expansion: string }>(
      'select name, expansion from factions order by name',
    );
    const expected = [...FACTION_SEED].sort((a, b) => a.name.localeCompare(b.name));
    expect(rows.sort((a, b) => a.name.localeCompare(b.name))).toEqual(expected);
  });

  it('seeds the aliases from the shared list', async () => {
    const { rows } = await pool.query<{ alias: string; name: string }>(
      'select a.alias, f.name from faction_aliases a join factions f on f.id = a.faction_id',
    );
    expect(Object.fromEntries(rows.map((r) => [r.alias, r.name]))).toEqual(FACTION_ALIAS_SEED);
  });

  it('rejects unknown expansions', async () => {
    await expect(pool.query("insert into factions (name, expansion) values ('X', 'nope')")).rejects.toThrow(
      /factions_expansion_check/,
    );
  });

  it('creates app_users with a role check', async () => {
    const id = '57196779-a30c-4b00-816e-fd683d01c6d4';
    const { rows } = await pool.query<{ role: string; display_name: string | null }>(
      "insert into app_users (id, email) values ($1, 'me@example.com') returning role, display_name",
      [id],
    );
    expect(rows[0]).toEqual({ role: 'user', display_name: null });
    await expect(pool.query("update app_users set role = 'owner' where id = $1", [id])).rejects.toThrow(
      /app_users_role_check/,
    );
    await pool.query('delete from app_users');
  });

  it('upserts app_users: refreshes email, promotes admins, never demotes', async () => {
    const id = '57196779-a30c-4b00-816e-fd683d01c6d4';
    const upsert = async (email: string, isAdmin: boolean) =>
      toAppUser((await pool.query(UPSERT_APP_USER_SQL, [id, email, isAdmin])).rows[0]);

    expect(await upsert('me@example.com', false)).toMatchObject({ id, email: 'me@example.com', role: 'user', displayName: null });
    expect(await upsert('new@example.com', false)).toMatchObject({ email: 'new@example.com', role: 'user' });
    expect(await upsert('new@example.com', true)).toMatchObject({ role: 'admin' });
    expect(await upsert('new@example.com', false)).toMatchObject({ role: 'admin' });

    const renamed = toAppUser((await pool.query(UPDATE_DISPLAY_NAME_SQL, [id, 'Cody'])).rows[0]);
    expect(renamed).toMatchObject({ displayName: 'Cody', role: 'admin' });
    expect(renamed.createdAt).toBeInstanceOf(Date);
    await pool.query('delete from app_users');
  });

  describe('games tables', () => {
    const owner = '57196779-a30c-4b00-816e-fd683d01c6d4';
    let p1: number, p2: number, f1: number, f2: number;

    beforeAll(async () => {
      await pool.query("insert into app_users (id, email) values ($1, 'owner@example.com')", [owner]);
      const ins = async (name: string) =>
        must((await pool.query<{ id: number }>('insert into players (name, created_by) values ($1, $2) returning id', [name, owner])).rows[0]).id;
      p1 = await ins('Cody');
      p2 = await ins('Marcus');
      const { rows } = await pool.query<{ id: number }>('select id from factions order by id limit 2');
      [f1, f2] = rows.map((r) => r.id) as [number, number];
    });

    const newGame = async (endedEarly = false) =>
      must((await pool.query<{ id: number }>('insert into games (created_by, ended_early) values ($1, $2) returning id', [owner, endedEarly])).rows[0]).id;
    const seat = (g: number, p: number, f: number, points: number, win: boolean) =>
      pool.query('insert into game_players (game_id, player_id, faction_id, points, is_winner) values ($1, $2, $3, $4, $5)', [g, p, f, points, win]);

    it('keeps player names unique per roster ignoring case, and trimmed', async () => {
      await expect(pool.query("insert into players (name, created_by) values ('cody', $1)", [owner])).rejects.toThrow(/players_roster_name_unique/);
      await expect(pool.query("insert into players (name, created_by) values (' Eve', $1)", [owner])).rejects.toThrow(/players_name_check/);
      await expect(pool.query("insert into players (name, created_by) values ('', $1)", [owner])).rejects.toThrow(/players_name_check/);
    });

    it('allows at most one winner and one seat per faction', async () => {
      const g = await newGame();
      await seat(g, p1, f1, 10, true);
      await expect(seat(g, p2, f2, 9, true)).rejects.toThrow(/one_winner_per_game/);
      await expect(seat(g, p2, f1, 9, false)).rejects.toThrow(/game_players_game_faction_unique/);
      await expect(seat(g, p2, f2, -1, false)).rejects.toThrow(/game_players_points_check/);
    });

    it('derives player count, winner and spread in game_summary', async () => {
      const g = await newGame();
      await seat(g, p1, f1, 11, true);
      await seat(g, p2, f2, 6, false);
      const tie = await newGame(true);
      await seat(tie, p1, f1, 8, false);
      await seat(tie, p2, f2, 8, true);
      const { rows } = await pool.query(
        'select game_id, player_count, point_spread, winner_player_id, winner_faction_id, winner_points from game_summary where game_id = any($1) order by game_id',
        [[g, tie]],
      );
      expect(rows).toEqual([
        { game_id: g, player_count: 2, point_spread: 5, winner_player_id: p1, winner_faction_id: f1, winner_points: 11 },
        { game_id: tie, player_count: 2, point_spread: 0, winner_player_id: p2, winner_faction_id: f2, winner_points: 8 },
      ]);
    });

    it('deletes seats with their game', async () => {
      const g = await newGame();
      await seat(g, p1, f1, 10, true);
      await pool.query('delete from games where id = $1', [g]);
      expect((await pool.query('select 1 from game_players where game_id = $1', [g])).rows).toHaveLength(0);
    });
  });

  it('is safe to re-run', async () => {
    await migrate(drizzle({ client: pool }), { migrationsFolder: './drizzle' });
    const { rows } = await pool.query<{ n: string }>('select count(*) as n from factions');
    expect(rows[0]?.n).toBe('30');
  });
});
