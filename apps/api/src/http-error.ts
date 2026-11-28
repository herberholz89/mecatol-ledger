import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

/** Thrown from routes and the data layer; `app.onError` turns it into `{ error, ...extra }`. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const forbidden = (message = "You can't change this") => new HttpError(403, message);

/** Parses with a Zod schema or throws a 400 carrying the issues (paths match the web form fields). */
export function parseOr400<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid request', { issues: parsed.error.issues });
  }
  return parsed.data;
}

/** Parses a positive integer route param or throws a 404. */
export function parseId(raw: string, what: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound(what);
  return id;
}
