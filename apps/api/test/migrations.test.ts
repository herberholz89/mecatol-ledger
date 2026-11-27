import { FACTION_ALIAS_SEED, FACTION_SEED } from '@mecatol/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

  it('is safe to re-run', async () => {
    await migrate(drizzle({ client: pool }), { migrationsFolder: './drizzle' });
    const { rows } = await pool.query<{ n: string }>('select count(*) as n from factions');
    expect(rows[0]?.n).toBe('30');
  });
});
