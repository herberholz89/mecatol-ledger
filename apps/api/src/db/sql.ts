/**
 * The bit of a Postgres client the data layer needs. Neon's HTTP driver (connections.ts) and
 * node-postgres (tests) both fit, so the same queries run in the Worker and against the test database.
 *
 * Queries are plain SQL rather than Drizzle-built: building queries costs CPU, and the free plan
 * allows 10 ms per request.
 */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface Statement {
  text: string;
  values: unknown[];
}

export interface Db extends Queryable {
  /**
   * Runs the statements in order in one transaction: all of them apply or none do. It's
   * non-interactive (no reading results between statements), so write each statement to guard
   * itself, e.g. by repeating an ownership condition, rather than relying on an earlier read.
   */
  batch(statements: Statement[]): Promise<void>;
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
