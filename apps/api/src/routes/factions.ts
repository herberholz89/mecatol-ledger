import { createFactionAliasSchema, createFactionSchema, updateFactionSchema } from '@mecatol/shared';
import { Hono } from 'hono';
import { requireAdmin, requireUser } from '../auth/middleware.js';
import { getDb } from '../db/connections.js';
import { createFaction, createFactionAlias, deleteFactionAlias, listFactionAliases, listFactions, updateFaction } from '../db/factions.js';
import type { AppEnv } from '../env.js';
import { parseId, parseOr400 } from '../http-error.js';

export const factionsRoute = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listFactions(getDb(c.env.DATABASE_URL))))
  /** Alternate spellings, used by the importer. */
  .get('/aliases', async (c) => c.json(await listFactionAliases(getDb(c.env.DATABASE_URL))))
  .post('/aliases', requireUser, requireAdmin, async (c) => {
    const { alias, factionId } = parseOr400(createFactionAliasSchema, await c.req.json().catch(() => null));
    return c.json(await createFactionAlias(getDb(c.env.DATABASE_URL), alias, factionId), 201);
  })
  /** The alias as typed (URL-encoded); its normalized form is removed. */
  .delete('/aliases/:alias', requireUser, requireAdmin, async (c) => {
    await deleteFactionAlias(getDb(c.env.DATABASE_URL), c.req.param('alias'));
    return c.body(null, 204);
  })
  .post('/', requireUser, requireAdmin, async (c) => {
    const { name, expansion } = parseOr400(createFactionSchema, await c.req.json().catch(() => null));
    return c.json(await createFaction(getDb(c.env.DATABASE_URL), name, expansion), 201);
  })
  /** Rename, change expansion, archive or unarchive. Factions are never deleted: games reference them. */
  .patch('/:id', requireUser, requireAdmin, async (c) => {
    const id = parseId(c.req.param('id'), 'Faction');
    const change = parseOr400(updateFactionSchema, await c.req.json().catch(() => null));
    return c.json(await updateFaction(getDb(c.env.DATABASE_URL), id, change));
  });
