import { updateMeSchema, type MeResponse } from '@mecatol/shared';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware.js';
import type { AppUser } from '../db/schema.js';
import { updateDisplayName } from '../db/users.js';
import type { AppEnv } from '../env.js';

function toMe(u: AppUser): MeResponse {
  return { id: u.id, email: u.email, displayName: u.displayName, role: u.role, createdAt: u.createdAt.toISOString() };
}

export const me = new Hono<AppEnv>()
  .use(requireUser)
  .get('/', (c) => c.json(toMe(c.var.user)))
  .patch('/', async (c) => {
    const parsed = updateMeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    const user = await updateDisplayName(c.env.DATABASE_URL, c.var.user.id, parsed.data.displayName);
    return c.json(toMe(user));
  });
