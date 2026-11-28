import { neon } from '@neondatabase/serverless';
import type { Db } from './sql.js';

/**
 * The database over Neon's HTTP driver. Every call is one HTTPS round trip; Neon's proxy logs in to
 * Postgres, so the Worker does no SCRAM password hashing. (A WebSocket `Pool` does that hashing in
 * the Worker on every new connection, which took POST /api/games to 16 ms CPU against the free
 * plan's 10 ms.) Atomic multi-statement writes use `batch`, which is Neon's non-interactive HTTP
 * transaction.
 */
export function getDb(databaseUrl: string): Db {
  const sql = neon(databaseUrl);
  return {
    query: async (text, values) => ({ rows: await sql.query(text, values) }),
    batch: async (statements) => {
      await sql.transaction(statements.map((s) => sql.query(s.text, s.values)));
    },
  };
}
