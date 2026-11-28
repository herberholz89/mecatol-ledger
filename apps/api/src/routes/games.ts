import { gameInputSchema, gamesQuerySchema } from '@mecatol/shared';
import { Hono } from 'hono';
import { requireUser, requireUserWhenMine } from '../auth/middleware.js';
import { getDb } from '../db/connections.js';
import { createGame, deleteGame, getGame, listGames, updateGame } from '../db/games.js';
import type { AppEnv } from '../env.js';
import { notFound, parseId, parseOr400 } from '../http-error.js';

async function loadGame(databaseUrl: string, id: number) {
  const game = await getGame(getDb(databaseUrl), id);
  if (!game) throw notFound('Game');
  return game;
}

export const gamesRoute = new Hono<AppEnv>()
  .get('/', requireUserWhenMine, async (c) => {
    const query = parseOr400(gamesQuerySchema, c.req.query());
    return c.json(await listGames(getDb(c.env.DATABASE_URL), query, query.mine ? c.var.user.id : null));
  })
  .get('/:id', async (c) => c.json(await loadGame(c.env.DATABASE_URL, parseId(c.req.param('id'), 'Game'))))
  .post('/', requireUser, async (c) => {
    const input = parseOr400(gameInputSchema, await c.req.json().catch(() => null));
    const id = await createGame(getDb(c.env.DATABASE_URL), c.var.user, input);
    return c.json(await loadGame(c.env.DATABASE_URL, id), 201);
  })
  /** Replaces the game and all its seats. Creator or admin. */
  .put('/:id', requireUser, async (c) => {
    const id = parseId(c.req.param('id'), 'Game');
    const input = parseOr400(gameInputSchema, await c.req.json().catch(() => null));
    await updateGame(getDb(c.env.DATABASE_URL), id, c.var.user, input);
    return c.json(await loadGame(c.env.DATABASE_URL, id));
  })
  .delete('/:id', requireUser, async (c) => {
    await deleteGame(getDb(c.env.DATABASE_URL), parseId(c.req.param('id'), 'Game'), c.var.user);
    return c.body(null, 204);
  });
