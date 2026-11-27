import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

/** HTTP driver for single queries. Use the WebSocket Pool per request when a transaction is needed. */
export function createDb(databaseUrl: string) {
  return drizzle({ client: neon(databaseUrl), schema });
}

export type Db = ReturnType<typeof createDb>;
