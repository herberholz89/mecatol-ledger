import { statsQuerySchema } from '@mecatol/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { requireUserWhenMine } from '../auth/middleware.js';
import { getDb } from '../db/connections.js';
import { factionStats, factionStatsDetail, playerStats, playerStatsDetail, statsOverview } from '../db/stats.js';
import type { AppEnv } from '../env.js';
import { notFound, parseId, parseOr400 } from '../http-error.js';

/** The validated filters, the database, and the user id when `mine` is set (requireUserWhenMine ran). */
function statsArgs(c: Context<AppEnv>) {
  const query = parseOr400(statsQuerySchema, c.req.query());
  return { db: getDb(c.env.DATABASE_URL), query, userId: query.mine ? c.var.user.id : null };
}

/** Public stats. Every route takes `playerCount`, `from`, `to`, and `mine` (needs a session). */
export const statsRoute = new Hono<AppEnv>()
  .use(requireUserWhenMine)
  .get('/overview', async (c) => {
    const { db, query, userId } = statsArgs(c);
    return c.json(await statsOverview(db, query, userId));
  })
  .get('/factions', async (c) => {
    const { db, query, userId } = statsArgs(c);
    return c.json(await factionStats(db, query, userId));
  })
  .get('/factions/:id', async (c) => {
    const { db, query, userId } = statsArgs(c);
    const detail = await factionStatsDetail(db, parseId(c.req.param('id'), 'Faction'), query, userId);
    if (!detail) throw notFound('Faction');
    return c.json(detail);
  })
  .get('/players', async (c) => {
    const { db, query, userId } = statsArgs(c);
    return c.json(await playerStats(db, query, userId));
  })
  .get('/players/:id', async (c) => {
    const { db, query, userId } = statsArgs(c);
    const detail = await playerStatsDetail(db, parseId(c.req.param('id'), 'Player'), query, userId);
    if (!detail) throw notFound('Player');
    return c.json(detail);
  });
