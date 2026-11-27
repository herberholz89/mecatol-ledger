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

  it('is safe to re-run', async () => {
    await migrate(drizzle({ client: pool }), { migrationsFolder: './drizzle' });
    const { rows } = await pool.query<{ n: string }>('select count(*) as n from factions');
    expect(rows[0]?.n).toBe('30');
  });
});
