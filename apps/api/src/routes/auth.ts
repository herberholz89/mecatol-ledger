import { Hono } from 'hono';
import { proxyToNeonAuth } from '../auth/neon-auth.js';
import type { AppEnv } from '../env.js';

/** `/api/auth/*` is passed through to Neon Auth so its cookies are set on our origin. */
export const auth = new Hono<AppEnv>().all('/*', (c) => {
  const subPath = c.req.path.replace(/^\/api\/auth\/?/, '');
  return proxyToNeonAuth(c.req.raw, c.env.NEON_AUTH_BASE_URL, subPath);
});
