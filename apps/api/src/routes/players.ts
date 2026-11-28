import { createPlayerSchema, playersQuerySchema, updatePlayerSchema } from '@mecatol/shared';
import { Hono } from 'hono';
import { requireUser, requireUserWhenMine } from '../auth/middleware.js';
import { getDb } from '../db/connections.js';
import { createPlayer, getPlayer, listPlayers, updatePlayer } from '../db/players.js';
import type { AppEnv } from '../env.js';
import { forbidden, notFound, parseId, parseOr400 } from '../http-error.js';

export const playersRoute = new Hono<AppEnv>()
  /** All players, one roster (`createdBy`), or your own (`mine=true`). */
  .get('/', requireUserWhenMine, async (c) => {
    const query = parseOr400(playersQuerySchema, c.req.query());
    const createdBy = query.mine ? c.var.user.id : query.createdBy;
    return c.json(await listPlayers(getDb(c.env.DATABASE_URL), { createdBy }));
  })
  .get('/:id', async (c) => {
    const player = await getPlayer(getDb(c.env.DATABASE_URL), parseId(c.req.param('id'), 'Player'));
    if (!player) throw notFound('Player');
    return c.json(player);
  })
  .post('/', requireUser, async (c) => {
    const { name } = parseOr400(createPlayerSchema, await c.req.json().catch(() => null));
    return c.json(await createPlayer(getDb(c.env.DATABASE_URL), c.var.user.id, name), 201);
  })
  /** Rename or archive. Roster owner or admin. */
  .patch('/:id', requireUser, async (c) => {
    const id = parseId(c.req.param('id'), 'Player');
    const change = parseOr400(updatePlayerSchema, await c.req.json().catch(() => null));
    const db = getDb(c.env.DATABASE_URL);
    const player = await getPlayer(db, id);
    if (!player) throw notFound('Player');
    const { user } = c.var;
    if (user.role !== 'admin' && player.createdBy !== user.id) throw forbidden('Only the roster owner or an admin can change this player');
    return c.json(await updatePlayer(db, id, change));
  });
