/**
 * The bit of a Postgres client the data layer needs. Neon's HTTP driver (wrapped in connections.ts),
 * Neon's WebSocket Pool client and node-postgres all fit, so the same queries run in the Worker and
 * against the test database.
 *
 * Queries are plain SQL rather than Drizzle-built: building queries costs CPU, and the free plan
 * allows 10 ms per request.
 */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface PoolClientLike extends Queryable {
  release(): void;
}

export interface PoolLike {
  connect(): Promise<PoolClientLike>;
}

/** Runs `fn` inside BEGIN/COMMIT on one pooled connection, rolling back if it throws. */
export async function runTransaction<T>(pool: PoolLike, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Rows typed by the caller. The SQL is the source of truth for their shape. */
export async function rows<T>(db: Queryable, text: string, values: unknown[] = []): Promise<T[]> {
  return (await db.query(text, values)).rows as T[];
}

/** True for a Postgres unique violation, optionally on a specific constraint or index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === '23505' && (constraint === undefined || e.constraint === constraint);
}

/** Timestamps arrive as Date (pg, Neon) or string depending on the driver; send ISO strings. */
export function iso(value: Date | string): string {
  return new Date(value).toISOString();
}
