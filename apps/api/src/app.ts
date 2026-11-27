import { Hono } from 'hono';
import type { AppEnv } from './env.js';
import { auth } from './routes/auth.js';
import { health } from './routes/health.js';
import { me } from './routes/me.js';

export const app = new Hono<AppEnv>().basePath('/api');

app.route('/health', health);
app.route('/auth', auth);
app.route('/me', me);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});
