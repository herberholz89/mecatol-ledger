import { Hono } from 'hono';
import { getDb } from '../db/connections.js';
import { listFactions } from '../db/factions.js';
import type { AppEnv } from '../env.js';

export const factionsRoute = new Hono<AppEnv>().get('/', async (c) => c.json(await listFactions(getDb(c.env.DATABASE_URL))));
