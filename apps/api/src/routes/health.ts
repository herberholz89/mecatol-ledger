import type { HealthResponse } from '@mecatol/shared';
import { Hono } from 'hono';
import { countFactions } from '../db/health.js';
import type { AppEnv } from '../env.js';

export const health = new Hono<AppEnv>().get('/', async (c) => {
  try {
    const factionCount = await countFactions(c.env.DATABASE_URL);
    return c.json<HealthResponse>({ status: 'ok', database: 'ok', factionCount });
  } catch (err) {
    console.error('health check failed', err);
    return c.json<HealthResponse>({ status: 'error', database: 'error', factionCount: null }, 503);
  }
});
