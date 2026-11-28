import {
  canManagePlayer,
  canUnclaimPlayer,
  createPlayerSchema,
  mergePlayerSchema,
  playersQuerySchema,
  updatePlayerSchema,
  type RosterPlayer,
} from '@mecatol/shared';
import { Hono, type Context } from 'hono';
import { requireUser, requireUserWhenMine } from '../auth/middleware.js';
import { getDb } from '../db/connections.js';
import {
  claimPlayer,
  createPlayer,
  deletePlayer,
  getPlayer,
  listPlayers,
  mergePlayers,
  unclaimPlayer,
  updatePlayer,
} from '../db/players.js';
import type { Db } from '../db/sql.js';
import type { AppEnv } from '../env.js';
import { forbidden, notFound, parseId, parseOr400 } from '../http-error.js';

/** Loads `:id` (404 if missing) for a signed-in route. */
async function loadPlayer(c: Context<AppEnv>): Promise<{ db: Db; player: RosterPlayer }> {
  const id = parseId(c.req.param('id') ?? '', 'Player');
  const db = getDb(c.env.DATABASE_URL);
  const player = await getPlayer(db, id);
  if (!player) throw notFound('Player');
  return { db, player };
}

/** Loads `:id` and checks the user owns its roster or is an admin. */
async function loadManagedPlayer(c: Context<AppEnv>) {
  const loaded = await loadPlayer(c);
  if (!canManagePlayer(c.var.user, loaded.player.createdBy)) throw forbidden('Only the roster owner or an admin can change this player');
  return loaded;
}

const body = (c: Context<AppEnv>) => c.req.json().catch(() => null);

export const playersRoute = new Hono<AppEnv>()
  /** All players, one roster (`createdBy`), your own (`mine=true`), or an account's claimed player (`claimedBy`). */
  .get('/', requireUserWhenMine, async (c) => {
    const query = parseOr400(playersQuerySchema, c.req.query());
    const createdBy = query.mine ? c.var.user.id : query.createdBy;
    return c.json(await listPlayers(getDb(c.env.DATABASE_URL), { createdBy, claimedBy: query.claimedBy }));
  })
  .get('/:id', async (c) => {
    const player = await getPlayer(getDb(c.env.DATABASE_URL), parseId(c.req.param('id'), 'Player'));
    if (!player) throw notFound('Player');
    return c.json(player);
  })
  .post('/', requireUser, async (c) => {
    const { name } = parseOr400(createPlayerSchema, await body(c));
    return c.json(await createPlayer(getDb(c.env.DATABASE_URL), c.var.user.id, name), 201);
  })
  /** Rename or archive. Roster owner or admin. */
  .patch('/:id', requireUser, async (c) => {
    const change = parseOr400(updatePlayerSchema, await body(c));
    const { db, player } = await loadManagedPlayer(c);
    return c.json(await updatePlayer(db, player.id, change));
  })
  /** Only players with no games; others are archived or merged. Roster owner or admin. */
  .delete('/:id', requireUser, async (c) => {
    const { db, player } = await loadManagedPlayer(c);
    await deletePlayer(db, player);
    return c.body(null, 204);
  })
  /** "This is me". Any signed-in user, any roster, one player per account. */
  .post('/:id/claim', requireUser, async (c) => {
    const { db, player } = await loadPlayer(c);
    return c.json(await claimPlayer(db, player, c.var.user.id));
  })
  /** The claimant, the roster owner or an admin. */
  .delete('/:id/claim', requireUser, async (c) => {
    const { db, player } = await loadPlayer(c);
    if (player.userId === null) return c.json(player);
    if (!canUnclaimPlayer(c.var.user, player)) throw forbidden('Only the claimant, the roster owner or an admin can remove this claim');
    return c.json(await unclaimPlayer(db, player.id));
  })
  /** Moves `:id`'s seats into `intoPlayerId` (same roster) and deletes `:id`. Roster owner or admin. */
  .post('/:id/merge', requireUser, async (c) => {
    const { intoPlayerId } = parseOr400(mergePlayerSchema, await body(c));
    const { db, player } = await loadManagedPlayer(c);
    const into = await getPlayer(db, intoPlayerId);
    if (!into) throw notFound('Player to merge into');
    return c.json(await mergePlayers(db, player, into));
  });
