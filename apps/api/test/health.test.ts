import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthResponseSchema } from '@mecatol/shared';
import { app } from '../src/app.js';
import { countFactions } from '../src/db/health.js';

vi.mock('../src/db/health.js', () => ({ countFactions: vi.fn() }));

const env = { DATABASE_URL: 'postgres://unused', NEON_AUTH_BASE_URL: 'https://auth.example.test', ASSETS: {} as Fetcher };

describe('GET /api/health', () => {
  afterEach(() => vi.resetAllMocks());

  it('reports ok with the faction count', async () => {
    vi.mocked(countFactions).mockResolvedValue(30);
    const res = await app.request('/api/health', {}, env);
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(await res.json())).toEqual({ status: 'ok', database: 'ok', factionCount: 30 });
  });

  it('returns 503 when the database is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(countFactions).mockRejectedValue(new Error('connection refused'));
    const res = await app.request('/api/health', {}, env);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'error', database: 'error', factionCount: null });
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await app.request('/api/nope', {}, env);
    expect(res.status).toBe(404);
  });
});
