import { neon, Pool } from '@neondatabase/serverless';
import { runTransaction, type Queryable } from './sql.js';

/** Neon's HTTP driver: one round trip per query, no connection setup. Use for reads and single writes. */
export function readDb(databaseUrl: string): Queryable {
  const sql = neon(databaseUrl);
  return { query: async (text, values) => ({ rows: await sql.query(text, values) }) };
}

/**
 * Runs `fn` in a transaction on a WebSocket Pool created for this request and closed afterwards
 * (Workers can't share sockets between requests).
 */
export async function withTransaction<T>(databaseUrl: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: databaseUrl });
  // An idle connection whose socket closes (as it does when the pool shuts down) makes the pool
  // emit 'error'. Without a listener that's an uncaught exception, even though the request is done.
  // Errors during a query still reject that query and reach the caller.
  pool.on('error', (err: Error) => console.warn('Neon pool connection closed:', err.message));
  try {
    return await runTransaction(pool, fn);
  } finally {
    await pool.end();
  }
}
