import { parseAdminEmails, updateUserSchema, type AdminUser } from '@mecatol/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin, requireUser } from '../auth/middleware.js';
import { forgetUser } from '../auth/user-cache.js';
import { getUser, listUsers, setUserRole, type UserRow } from '../db/admin-users.js';
import { getDb } from '../db/connections.js';
import type { AppEnv } from '../env.js';
import { HttpError, notFound, parseOr400 } from '../http-error.js';

const userId = z.uuid();

/** Users and roles, for admins. */
export const usersRoute = new Hono<AppEnv>()
  .use(requireUser, requireAdmin)
  .get('/', async (c) => {
    const adminEmails = parseAdminEmails(c.env.ADMIN_EMAILS);
    const users = await listUsers(getDb(c.env.DATABASE_URL));
    return c.json(users.map((u): AdminUser => withEmailFlag(u, adminEmails)));
  })
  /**
   * Promote or demote. Not yourself (so there's always an admin who can undo it), and not anyone in
   * ADMIN_EMAILS, who'd be promoted again on their next request. Other isolates may keep the old
   * role for up to a minute (the per-isolate user cache).
   */
  .patch('/:id', async (c) => {
    const parsedId = userId.safeParse(c.req.param('id'));
    if (!parsedId.success) throw notFound('User');
    const { role } = parseOr400(updateUserSchema, await c.req.json().catch(() => null));
    if (parsedId.data === c.var.user.id) throw new HttpError(400, "You can't change your own role");
    const db = getDb(c.env.DATABASE_URL);
    const adminEmails = parseAdminEmails(c.env.ADMIN_EMAILS);
    const target = await getUser(db, parsedId.data);
    if (!target) throw notFound('User');
    if (role !== 'admin' && adminEmails.has(target.email.toLowerCase())) {
      throw new HttpError(409, `${target.email} is in ADMIN_EMAILS, so they're promoted again on every sign-in. Remove them there first.`);
    }
    const updated = await setUserRole(db, target.id, role);
    forgetUser(updated.id);
    return c.json(withEmailFlag(updated, adminEmails));
  });

function withEmailFlag(u: UserRow, adminEmails: Set<string>): AdminUser {
  return { ...u, adminByEmail: adminEmails.has(u.email.toLowerCase()) };
}
