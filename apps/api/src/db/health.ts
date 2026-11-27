import { count } from 'drizzle-orm';
import { createDb } from './client.js';
import { factions } from './schema.js';

/** Checks connectivity and that migrations have run, in one cheap query. */
export async function countFactions(databaseUrl: string): Promise<number> {
  const [row] = await createDb(databaseUrl).select({ n: count() }).from(factions);
  return row?.n ?? 0;
}
