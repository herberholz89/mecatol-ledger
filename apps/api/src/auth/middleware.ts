import { parseAdminEmails } from '@mecatol/shared';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { upsertAppUser } from '../db/users.js';
import type { AppEnv } from '../env.js';
import { getNeonSession } from './neon-auth.js';
import { cacheUser, getCachedUser } from './user-cache.js';

/**
 * Requires a Neon Auth session. Upserts the app_users row and sets `c.var.user`.
 * Responds 401 without a session. Roles come from app_users, never from Neon Auth.
 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const cookie = c.req.header('cookie');
  if (!cookie?.includes('session_token')) return c.json({ error: 'Not signed in' }, 401);

  const session = await getNeonSession(c.env.NEON_AUTH_BASE_URL, cookie);
  if (!session) return c.json({ error: 'Not signed in' }, 401);
  for (const sc of session.setCookies) c.header('set-cookie', sc, { append: true });

  const { id } = session.user;
  const email = session.user.email.toLowerCase();
  const isAdmin = session.user.emailVerified && parseAdminEmails(c.env.ADMIN_EMAILS).has(email);
  let user = getCachedUser(id, email, isAdmin);
  if (!user) {
    user = await upsertAppUser(c.env.DATABASE_URL, { id, email, isAdmin });
    cacheUser(user);
  }
  c.set('user', user);
  await next();
});

/** Use after `requireUser`. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.user.role !== 'admin') return c.json({ error: 'Admins only' }, 403);
  await next();
});

const mineFlag = z.stringbool().optional().catch(undefined);

/** For public list routes: requires a session only when the query asks for `mine=true`. */
export const requireUserWhenMine = createMiddleware<AppEnv>(async (c, next) => {
  if (mineFlag.parse(c.req.query('mine'))) return requireUser(c, next);
  await next();
});
