import type { AppUser } from '../db/schema.js';

/**
 * Per-isolate memory of recently upserted app_users rows, so repeat requests from a signed-in user
 * skip the database write. The session itself is still checked with Neon Auth on every request.
 * Each isolate has its own copy, so a role change made elsewhere shows up within TTL_MS.
 */
const TTL_MS = 60_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { user: AppUser; expires: number }>();

/** Returns the cached row if it's fresh and still matches the session's email and admin status. */
export function getCachedUser(id: string, email: string, isAdmin: boolean, now = Date.now()): AppUser | undefined {
  const hit = cache.get(id);
  if (!hit || hit.expires <= now) return undefined;
  if (hit.user.email !== email || (isAdmin && hit.user.role !== 'admin')) return undefined;
  return hit.user;
}

export function cacheUser(user: AppUser, now = Date.now()): void {
  if (cache.size >= MAX_ENTRIES && !cache.has(user.id)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(user.id, { user, expires: now + TTL_MS });
}

/** Drops one user, e.g. after an admin changes their role. Other isolates catch up within TTL_MS. */
export function forgetUser(id: string): void {
  cache.delete(id);
}

/** For tests. */
export function clearUserCache(): void {
  cache.clear();
}
