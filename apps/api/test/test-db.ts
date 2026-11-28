import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

// Tests that touch the database run against a real Postgres: the CI service container, or a local
// database. They're skipped when TEST_DATABASE_URL isn't set. The database is wiped first.
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

let pool: pg.Pool | undefined;

export function testPool(): pg.Pool {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  pool ??= new pg.Pool({ connectionString: TEST_DATABASE_URL });
  return pool;
}

export async function resetDatabase(): Promise<void> {
  const p = testPool();
  await p.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await migrate(drizzle({ client: p }), { migrationsFolder: './drizzle' });
}

export async function closeTestPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Unwraps a value tests expect to exist, failing loudly instead of using `!`. */
export function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`Expected ${what}`);
  return value;
}
