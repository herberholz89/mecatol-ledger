import { factionStatsDetailSchema, factionStatsSchema, playerStatsDetailSchema, playerStatsSchema, statsOverviewSchema, type GameInputDraft } from '@mecatol/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { closeTestPool, must, resetDatabase, TEST_DATABASE_URL, testPool } from './test-db.js';

// Real routes and SQL against the test database; Neon Auth is faked as in games.test.ts.

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

describe.skipIf(!TEST_DATABASE_URL)('stats API', () => {
  const f: Record<string, number> = {};
  const p: Record<string, number> = {};
  const fid = (name: string) => must(f[name], name);
  const pid = (name: string) => must(p[name], name);

  async function addPlayer(who: Who, name: string) {
    p[name] = (must((await call('POST', '/players', { as: who, body: { name } })).body) as { id: number }).id;
  }

  /** Seats as [player, faction, points]; the first seat wins. */
  async function logGame(who: Who, playedOn: string | null, seats: [string, string, number][]) {
    const body: GameInputDraft = {
      playedOn,
      vpTarget: 10,
      endedEarly: false,
      notes: null,
      seats: seats.map(([player, faction, points]) => ({ playerId: pid(player), factionId: fid(faction), points })),
      winnerPlayerId: pid(must(seats[0])[0]),
    };
    const res = await call('POST', '/games', { as: who, body });
    expect(res.status).toBe(201);
  }

  beforeAll(async () => {
    await resetDatabase();
    const { rows } = await testPool().query<{ id: number; name: string }>('select id, name from factions');
    for (const r of rows) f[r.name] = r.id;
    for (const who of ['ana', 'ben'] as const) await call('GET', '/me', { as: who });
    for (const name of ['Cody', 'Marcus', 'Eric']) await addPlayer('ana', name);
    for (const name of ['Eve', 'Finn']) await addPlayer('ben', name);

    await logGame('ana', '2026-05-01', [['Cody', 'Federation of Sol', 10], ['Marcus', 'Nekro Virus', 7]]);
    await logGame('ana', '2026-06-01', [['Marcus', 'Federation of Sol', 10], ['Cody', 'Arborec', 8], ['Eric', 'Winnu', 4]]);
    await logGame('ana', null, [['Cody', 'Nekro Virus', 10], ['Eric', 'Federation of Sol', 6]]);
    await logGame('ben', '2026-07-01', [['Finn', 'Winnu', 10], ['Eve', 'Federation of Sol', 9]]);
  });

  afterAll(closeTestPool);

  const factions = async (qs = '', as?: Who) => factionStatsSchema.array().parse((await call('GET', `/stats/factions${qs}`, { as })).body);
  const sol = async (qs = '', as?: Who) => must((await factions(qs, as)).find((r) => r.faction.name === 'Federation of Sol'));

  it('aggregates faction stats with expected win rate, most-played first', async () => {
    const rows = await factions();
    expect(rows).toHaveLength(30);
    expect(rows[0]).toMatchObject({ faction: { name: 'Federation of Sol' }, games: 4, wins: 2, winRate: 0.5, avgPoints: 8.75 });
    expect(rows[0]?.expectedWinRate).toBeCloseTo((1 / 2 + 1 / 3 + 1 / 2 + 1 / 2) / 4);
    expect(rows.find((r) => r.faction.name === 'Winnu')).toMatchObject({ games: 2, wins: 1 });
    expect(rows.find((r) => r.faction.name === 'Empyrean')).toMatchObject({ games: 0, wins: 0, winRate: null, expectedWinRate: null, avgPoints: null });
  });

  it('filters before aggregating: player count, dates (dropping undated games), mine', async () => {
    expect(await sol('?playerCount=2')).toMatchObject({ games: 3, wins: 1 });
    expect(await sol('?from=2026-05-15')).toMatchObject({ games: 2, wins: 1 });
    expect(await sol('?to=2026-06-01')).toMatchObject({ games: 2, wins: 2 });
    expect(await sol('?mine=true', 'ana')).toMatchObject({ games: 3, wins: 2 });
    expect(await sol('?mine=true', 'ben')).toMatchObject({ games: 1, wins: 0 });
  });

  it('needs a session for mine, and validates filters', async () => {
    expect((await call('GET', '/stats/factions?mine=true')).status).toBe(401);
    expect((await call('GET', '/stats/players?playerCount=9')).status).toBe(400);
    expect((await call('GET', '/stats/players?from=2026-07-01&to=2026-06-01')).status).toBe(400);
  });

  it('hides archived factions only when they have no games', async () => {
    await testPool().query('update factions set archived = true where id = any($1)', [[fid('Empyrean'), fid('Winnu')]]);
    const rows = await factions();
    expect(rows.map((r) => r.faction.name)).not.toContain('Empyrean');
    expect(rows.find((r) => r.faction.name === 'Winnu')).toMatchObject({ games: 2, faction: { archived: true } });
    await testPool().query('update factions set archived = false');
  });

  it('aggregates player stats for players with games', async () => {
    const rows = playerStatsSchema.array().parse((await call('GET', '/stats/players')).body);
    expect(rows.map((r) => [r.player.name, r.games, r.wins])).toEqual([
      ['Cody', 3, 2],
      ['Marcus', 2, 1],
      ['Eric', 2, 0],
      ['Finn', 1, 1],
      ['Eve', 1, 0],
    ]);
    const mine = playerStatsSchema.array().parse((await call('GET', '/stats/players?mine=true', { as: 'ben' })).body);
    expect(mine.map((r) => r.player.name)).toEqual(['Finn', 'Eve']);
  });

  it('details a faction: totals, who plays it, results oldest first with undated games first', async () => {
    const res = await call('GET', `/stats/factions/${fid('Federation of Sol')}`);
    const detail = factionStatsDetailSchema.parse(res.body);
    expect(detail.totals).toMatchObject({ games: 4, wins: 2 });
    expect(detail.players.map((r) => [r.player.name, r.games, r.wins])).toEqual([
      ['Cody', 1, 1],
      ['Marcus', 1, 1],
      ['Eric', 1, 0],
      ['Eve', 1, 0],
    ]);
    expect(detail.results.map((r) => [r.playedOn, r.isWinner, r.playerCount])).toEqual([
      [null, false, 2],
      ['2026-05-01', true, 2],
      ['2026-06-01', true, 3],
      ['2026-07-01', false, 2],
    ]);
    const filtered = factionStatsDetailSchema.parse((await call('GET', `/stats/factions/${fid('Federation of Sol')}?playerCount=3`)).body);
    expect(filtered.totals).toMatchObject({ games: 1, wins: 1 });
    expect(filtered.results).toHaveLength(1);
  });

  it('details a faction nobody has played', async () => {
    const detail = factionStatsDetailSchema.parse((await call('GET', `/stats/factions/${fid('Empyrean')}`)).body);
    expect(detail).toMatchObject({ totals: { games: 0, wins: 0, winRate: null }, players: [], results: [] });
  });

  it('details a player: totals and record by faction', async () => {
    const detail = playerStatsDetailSchema.parse((await call('GET', `/stats/players/${pid('Cody')}`)).body);
    expect(detail.player).toMatchObject({ name: 'Cody', ownerName: null });
    expect(detail.totals).toMatchObject({ games: 3, wins: 2 });
    expect(detail.factions.map((r) => [r.faction.name, r.games, r.wins])).toEqual([
      ['Federation of Sol', 1, 1],
      ['Nekro Virus', 1, 1],
      ['Arborec', 1, 0],
    ]);
    expect(detail.results.map((r) => r.isWinner)).toEqual([true, true, false]);
  });

  it('404s unknown factions and players', async () => {
    expect((await call('GET', '/stats/factions/999999')).status).toBe(404);
    expect((await call('GET', '/stats/players/999999')).status).toBe(404);
    expect((await call('GET', '/stats/players/abc')).status).toBe(404);
  });

  it('gives overview numbers', async () => {
    const all = statsOverviewSchema.parse((await call('GET', '/stats/overview')).body);
    expect(all).toEqual({ games: 4, players: 5, factionsPlayed: 4, avgPointSpread: 2.5 });
    const mine = statsOverviewSchema.parse((await call('GET', '/stats/overview?mine=true', { as: 'ana' })).body);
    expect(mine).toEqual({ games: 3, players: 3, factionsPlayed: 4, avgPointSpread: 3 });
    const none = statsOverviewSchema.parse((await call('GET', '/stats/overview?playerCount=8')).body);
    expect(none).toEqual({ games: 0, players: 0, factionsPlayed: 0, avgPointSpread: null });
  });
});
