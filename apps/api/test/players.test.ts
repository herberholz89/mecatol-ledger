import { rosterPlayerSchema, type GameInputDraft, type RosterPlayer } from '@mecatol/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { closeTestPool, must, resetDatabase, TEST_DATABASE_URL, testPool } from './test-db.js';

// Roster management: claim, merge, delete. Real routes and SQL; Neon Auth is faked as in games.test.ts.

vi.mock('../src/db/connections.js', async () => {
  const { testDb } = await import('./test-db.js');
  return { getDb: () => testDb() };
});

vi.mock('../src/db/users.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/db/users.js')>();
  const { testPool: pool } = await import('./test-db.js');
  return {
    ...original,
    upsertAppUser: async (_url: string, u: { id: string; email: string; isAdmin: boolean }) =>
      original.toAppUser((await pool().query(original.UPSERT_APP_USER_SQL, [u.id, u.email, u.isAdmin])).rows[0]),
  };
});

const USERS = {
  ana: '11111111-1111-4111-8111-111111111111',
  ben: '22222222-2222-4222-8222-222222222222',
  boss: '33333333-3333-4333-8333-333333333333',
} as const;
type Who = keyof typeof USERS;

vi.mock('../src/auth/neon-auth.js', () => ({
  getNeonSession: async (_base: string, cookie: string) => {
    const id = /session_token=([\w-]+)/.exec(cookie)?.[1];
    const names: Record<string, string> = {
      '11111111-1111-4111-8111-111111111111': 'ana',
      '22222222-2222-4222-8222-222222222222': 'ben',
      '33333333-3333-4333-8333-333333333333': 'boss',
    };
    const name = id && names[id];
    return name ? { user: { id, email: `${name}@example.com`, emailVerified: true }, setCookies: [] } : null;
  },
  proxyToNeonAuth: () => new Response(null, { status: 500 }),
}));

const env = { DATABASE_URL: 'postgres://unused', NEON_AUTH_BASE_URL: 'https://auth.test', ADMIN_EMAILS: 'boss@example.com', ASSETS: {} as Fetcher };

async function call(method: string, path: string, opts: { as?: Who; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.as) headers.cookie = `__Secure-neon-auth.session_token=${USERS[opts.as]}`;
  const res = await app.request(`/api${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as unknown) : null };
}

const errorOf = (body: unknown) => (body as { error: string }).error;

describe.skipIf(!TEST_DATABASE_URL)('roster management API', () => {
  const f: Record<string, number> = {};
  const p: Record<string, number> = {};
  const fid = (name: string) => must(f[name], name);
  const pid = (name: string) => must(p[name], name);
  let benEric: number;

  async function addPlayer(who: Who, name: string) {
    const res = await call('POST', '/players', { as: who, body: { name } });
    expect(res.status).toBe(201);
    return rosterPlayerSchema.parse(res.body).id;
  }

  async function logGame(winner: [string, string, number], loser: [string, string, number]) {
    const game: GameInputDraft = {
      playedOn: '2026-05-21',
      vpTarget: 10,
      endedEarly: false,
      notes: null,
      seats: [winner, loser].map(([player, faction, points]) => ({ playerId: pid(player), factionId: fid(faction), points })),
      winnerPlayerId: pid(winner[0]),
    };
    const res = await call('POST', '/games', { as: 'ana', body: game });
    expect(res.status).toBe(201);
    return (res.body as { id: number }).id;
  }

  async function player(id: number): Promise<RosterPlayer> {
    const res = await call('GET', `/players/${id}`);
    expect(res.status).toBe(200);
    return rosterPlayerSchema.parse(res.body);
  }

  beforeAll(async () => {
    await resetDatabase();
    const { rows } = await testPool().query<{ id: number; name: string }>('select id, name from factions');
    for (const r of rows) f[r.name] = r.id;
    for (const who of ['ana', 'ben', 'boss'] as const) await call('GET', '/me', { as: who });
    await testPool().query(`update app_users set display_name = initcap(split_part(email, '@', 1))`);
    for (const name of ['Cody', 'Marcus', 'Marc', 'Eric', 'Typo']) p[name] = await addPlayer('ana', name);
    benEric = await addPlayer('ben', 'Eric');
    await logGame(['Cody', 'Federation of Sol', 10], ['Marcus', 'Nekro Virus', 7]);
    await logGame(['Cody', 'Federation of Sol', 10], ['Marc', 'Clan of Saar', 6]);
    await logGame(['Eric', 'Emirates of Hacan', 10], ['Cody', 'Winnu', 4]);
  });

  afterAll(closeTestPool);

  it('lists game counts and claims with each player', async () => {
    expect(await player(pid('Cody'))).toMatchObject({ games: 3, userId: null, claimedByName: null, ownerName: 'Ana' });
    expect(await player(pid('Typo'))).toMatchObject({ games: 0 });
  });

  describe('claim', () => {
    it('needs a session', async () => {
      expect((await call('POST', `/players/${pid('Cody')}/claim`)).status).toBe(401);
    });

    it("lets anyone claim an unclaimed player in any roster, once", async () => {
      const res = await call('POST', `/players/${pid('Cody')}/claim`, { as: 'ben' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: pid('Cody'), userId: USERS.ben, claimedByName: 'Ben' });
      expect((await call('POST', `/players/${pid('Cody')}/claim`, { as: 'ben' })).status).toBe(200);
    });

    it('refuses a player someone else claimed, and a second player for the same account', async () => {
      const taken = await call('POST', `/players/${pid('Cody')}/claim`, { as: 'ana' });
      expect(taken.status).toBe(409);
      expect(errorOf(taken.body)).toBe('Cody is already claimed by Ben');
      const second = await call('POST', `/players/${pid('Eric')}/claim`, { as: 'ben' });
      expect(second.status).toBe(409);
      expect(errorOf(second.body)).toContain("You've already claimed Cody");
      expect((await call('POST', '/players/999999/claim', { as: 'ben' })).status).toBe(404);
    });

    it("finds an account's claimed player", async () => {
      const res = await call('GET', `/players?claimedBy=${USERS.ben}`);
      expect(rosterPlayerSchema.array().parse(res.body).map((x) => x.id)).toEqual([pid('Cody')]);
    });

    it('lets the claimant, roster owner or an admin remove a claim, and nobody else', async () => {
      expect((await call('DELETE', `/players/${pid('Cody')}/claim`, { as: 'ana' })).body).toMatchObject({ userId: null });
      expect((await call('POST', `/players/${pid('Marcus')}/claim`, { as: 'ana' })).status).toBe(200);
      expect((await call('DELETE', `/players/${pid('Marcus')}/claim`, { as: 'ben' })).status).toBe(403);
      expect((await call('DELETE', `/players/${pid('Marcus')}/claim`, { as: 'boss' })).body).toMatchObject({ userId: null });
      expect((await call('POST', `/players/${benEric}/claim`, { as: 'ben' })).status).toBe(200);
      expect((await call('DELETE', `/players/${benEric}/claim`, { as: 'ben' })).body).toMatchObject({ userId: null });
    });
  });

  describe('merge', () => {
    const merge = (from: number, into: number, as: Who) => call('POST', `/players/${from}/merge`, { as, body: { intoPlayerId: into } });

    it('is for the roster owner or an admin, within one roster', async () => {
      expect((await merge(pid('Marc'), pid('Marcus'), 'ben')).status).toBe(403);
      expect((await merge(pid('Eric'), benEric, 'ana')).status).toBe(400);
      expect((await merge(pid('Marc'), pid('Marc'), 'ana')).status).toBe(400);
      expect((await merge(pid('Marc'), 999999, 'ana')).status).toBe(404);
      expect((await call('POST', `/players/${pid('Marc')}/merge`, { as: 'ana', body: {} })).status).toBe(400);
    });

    it('refuses players who were in the same game', async () => {
      const res = await merge(pid('Eric'), pid('Cody'), 'ana');
      expect(res.status).toBe(409);
      expect(errorOf(res.body)).toContain('played in the same game');
    });

    it('refuses when both players are claimed', async () => {
      await call('POST', `/players/${pid('Marc')}/claim`, { as: 'ana' });
      await call('POST', `/players/${pid('Marcus')}/claim`, { as: 'ben' });
      const res = await merge(pid('Marc'), pid('Marcus'), 'ana');
      expect(res.status).toBe(409);
      expect(errorOf(res.body)).toContain('Both players are claimed');
      await call('DELETE', `/players/${pid('Marcus')}/claim`, { as: 'ben' });
    });

    it("moves the seats and the claim, and deletes the merged player", async () => {
      const res = await merge(pid('Marc'), pid('Marcus'), 'ana');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: pid('Marcus'), name: 'Marcus', games: 2, userId: USERS.ana });
      expect((await call('GET', `/players/${pid('Marc')}`)).status).toBe(404);
      const stats = await call('GET', `/stats/players/${pid('Marcus')}`);
      expect(stats.body).toMatchObject({ totals: { games: 2, wins: 0 } });
    });
  });

  describe('delete', () => {
    it('removes a player with no games, for the roster owner or an admin', async () => {
      expect((await call('DELETE', `/players/${pid('Typo')}`, { as: 'ben' })).status).toBe(403);
      expect((await call('DELETE', `/players/${pid('Typo')}`, { as: 'ana' })).status).toBe(204);
      expect((await call('DELETE', `/players/${pid('Typo')}`, { as: 'ana' })).status).toBe(404);
      const temp = await addPlayer('ana', 'Temp');
      expect((await call('DELETE', `/players/${temp}`, { as: 'boss' })).status).toBe(204);
    });

    it('refuses a player who is in games', async () => {
      const res = await call('DELETE', `/players/${pid('Cody')}`, { as: 'ana' });
      expect(res.status).toBe(409);
      expect(errorOf(res.body)).toContain('Archive or merge them instead');
      expect((await player(pid('Cody'))).games).toBe(3);
    });
  });
});
