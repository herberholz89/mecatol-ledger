import { Hono } from 'hono';
import type { AppEnv } from './env.js';
import { HttpError } from './http-error.js';
import { auth } from './routes/auth.js';
import { factionsRoute } from './routes/factions.js';
import { gamesRoute } from './routes/games.js';
import { health } from './routes/health.js';
import { importsRoute } from './routes/imports.js';
import { me } from './routes/me.js';
import { playersRoute } from './routes/players.js';
import { statsRoute } from './routes/stats.js';

export const app = new Hono<AppEnv>().basePath('/api');

app.route('/health', health);
app.route('/auth', auth);
app.route('/me', me);
app.route('/factions', factionsRoute);
app.route('/players', playersRoute);
app.route('/games', gamesRoute);
app.route('/imports', importsRoute);
app.route('/stats', statsRoute);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, ...err.extra }, err.status);
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});
