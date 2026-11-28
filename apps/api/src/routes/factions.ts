import { createFactionAliasSchema } from '@mecatol/shared';
import { Hono } from 'hono';
import { requireAdmin, requireUser } from '../auth/middleware.js';
import { getDb } from '../db/connections.js';
import { createFactionAlias, listFactionAliases, listFactions } from '../db/factions.js';
import type { AppEnv } from '../env.js';
import { parseOr400 } from '../http-error.js';

export const factionsRoute = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listFactions(getDb(c.env.DATABASE_URL))))
  /** Alternate spellings, used by the importer. */
  .get('/aliases', async (c) => c.json(await listFactionAliases(getDb(c.env.DATABASE_URL))))
  .post('/aliases', requireUser, requireAdmin, async (c) => {
    const { alias, factionId } = parseOr400(createFactionAliasSchema, await c.req.json().catch(() => null));
    return c.json(await createFactionAlias(getDb(c.env.DATABASE_URL), alias, factionId), 201);
  });
