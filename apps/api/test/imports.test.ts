import { createdImportSchema, importBatchSummarySchema, type ImportBatchDraft, type ImportGameDraft } from '@mecatol/shared';
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

const issuePaths = (body: unknown) => ((body as { issues?: { path: (string | number)[] }[] }).issues ?? []).map((i) => i.path.join('.'));

describe.skipIf(!TEST_DATABASE_URL)('imports API', () => {
  const f: Record<string, number> = {};
  const fid = (name: string) => must(f[name], name);
  let anaEric: number;
  let benEric: number;

  beforeAll(async () => {
    await resetDatabase();
    const { rows } = await testPool().query<{ id: number; name: string }>('select id, name from factions');
    for (const r of rows) f[r.name] = r.id;
    for (const who of ['ana', 'ben', 'boss'] as const) await call('GET', '/me', { as: who });
    anaEric = (must((await call('POST', '/players', { as: 'ana', body: { name: 'Eric' } })).body) as { id: number }).id;
    benEric = (must((await call('POST', '/players', { as: 'ben', body: { name: 'Eric' } })).body) as { id: number }).id;
  });

  afterAll(closeTestPool);

  const game = (over: Partial<ImportGameDraft> = {}): ImportGameDraft => ({
    playedOn: null,
    vpTarget: 10,
    endedEarly: false,
    notes: null,
    seats: [
      { player: { id: anaEric }, factionId: fid('Federation of Sol'), points: 10 },
      { player: { name: 'Marcus' }, factionId: fid('Nekro Virus'), points: 7 },
    ],
    winner: 0,
    ...over,
  });
  const batch = (games: ImportGameDraft[], sourceName = 'Twilight Imperium data.xlsx'): ImportBatchDraft => ({ sourceName, games });

  const gameIdsOf = async (batchId: number) =>
    (await testPool().query<{ id: number }>('select id from games where import_batch_id = $1 order by id', [batchId])).rows.map((r) => r.id);

  let firstBatch: number;

  it('needs a session', async () => {
    expect((await call('POST', '/imports', { body: batch([game()]) })).status).toBe(401);
    expect((await call('GET', '/imports')).status).toBe(401);
  });

  it('imports games in order, creating new roster players once (ignoring case)', async () => {
    const games = [
      game({ playedOn: '2026-05-21', notes: 'Total Annihilation' }),
      game({
        seats: [
          { player: { name: 'marcus' }, factionId: fid('Winnu'), points: 10 },
          { player: { id: anaEric }, factionId: fid('Arborec'), points: 6 },
          { player: { name: 'codey' }, factionId: fid('Clan of Saar'), points: 11 },
        ],
        winner: 2,
      }),
    ];
    const res = await call('POST', '/imports', { as: 'ana', body: batch(games) });
    expect(res.status).toBe(201);
    const created = createdImportSchema.parse(res.body);
    expect(created).toMatchObject({ sourceName: 'Twilight Imperium data.xlsx', games: 2, newPlayers: 2 });
    firstBatch = created.id;

    const roster = (await call('GET', '/players?mine=true', { as: 'ana' })).body as { name: string }[];
    expect(roster.map((p) => p.name)).toEqual(['codey', 'Eric', 'Marcus']);

    const [g1, g2] = await gameIdsOf(created.id);
    const d1 = (await call('GET', `/games/${must(g1)}`)).body;
    expect(d1).toMatchObject({ playedOn: '2026-05-21', notes: 'Total Annihilation', pointSpread: 3, winner: { player: { name: 'Eric' } } });
    const d2 = (await call('GET', `/games/${must(g2)}`)).body;
    expect(d2).toMatchObject({ playedOn: null, playerCount: 3, pointSpread: 1, winner: { player: { name: 'codey' }, points: 11 } });
  });

  it('reuses existing roster players for new names', async () => {
    const res = await call('POST', '/imports', { as: 'ana', body: batch([game({ seats: [
      { player: { name: 'ERIC' }, factionId: fid('Winnu'), points: 10 },
      { player: { name: 'Marcus' }, factionId: fid('Arborec'), points: 2 },
    ] })]) });
    expect(createdImportSchema.parse(res.body).newPlayers).toBe(0);
    const [g] = await gameIdsOf(createdImportSchema.parse(res.body).id);
    expect((await call('GET', `/games/${must(g)}`)).body).toMatchObject({ winner: { player: { id: anaEric } } });
  });

  it('re-validates the domain rules and refuses the whole batch', async () => {
    const before = (await testPool().query('select count(*)::int as n from games')).rows[0];
    const tie = game({ seats: [
      { player: { id: anaEric }, factionId: fid('Winnu'), points: 8 },
      { player: { name: 'Zed' }, factionId: fid('Arborec'), points: 8 },
    ] });
    const res = await call('POST', '/imports', { as: 'ana', body: batch([game(), tie]) });
    expect(res.status).toBe(400);
    expect(issuePaths(res.body)).toEqual(['games.1.winner']);
    expect((await testPool().query('select count(*)::int as n from games')).rows[0]).toEqual(before);
    expect((await testPool().query("select 1 from players where name = 'Zed'")).rows).toHaveLength(0);
  });

  it("refuses someone else's players, unknown factions, and a new name that duplicates a seat", async () => {
    const other = game({ seats: [game().seats[0] ?? never(), { player: { id: benEric }, factionId: fid('Winnu'), points: 1 }] });
    const r1 = await call('POST', '/imports', { as: 'ana', body: batch([other]) });
    expect([r1.status, issuePaths(r1.body)]).toEqual([400, ['games.0.seats.1.player']]);

    const badFaction = game({ seats: [game().seats[0] ?? never(), { player: { name: 'Zed' }, factionId: 99999, points: 1 }] });
    const r2 = await call('POST', '/imports', { as: 'ana', body: batch([badFaction]) });
    expect([r2.status, issuePaths(r2.body)]).toEqual([400, ['games.0.seats.1.factionId']]);

    const dup = game({ seats: [game().seats[0] ?? never(), { player: { name: 'eric' }, factionId: fid('Winnu'), points: 1 }] });
    const r3 = await call('POST', '/imports', { as: 'ana', body: batch([dup]) });
    expect([r3.status, issuePaths(r3.body)]).toEqual([400, ['games.0.seats.1.player']]);
  });

  it('lists your own imports with game counts', async () => {
    const mine = importBatchSummarySchema.array().parse((await call('GET', '/imports', { as: 'ana' })).body);
    expect(mine.map((b) => b.games)).toEqual([1, 2]);
    expect((await call('GET', '/imports', { as: 'ben' })).body).toEqual([]);
  });

  it('lets imported games be edited and deleted like logged ones', async () => {
    const [g1] = await gameIdsOf(firstBatch);
    expect((await call('DELETE', `/games/${must(g1)}`, { as: 'ana' })).status).toBe(204);
    const mine = importBatchSummarySchema.array().parse((await call('GET', '/imports', { as: 'ana' })).body);
    expect(mine.find((b) => b.id === firstBatch)?.games).toBe(1);
  });

  it('undoes a batch: importer or admin only, games and seats go with it, players stay', async () => {
    expect((await call('DELETE', `/imports/${firstBatch}`, { as: 'ben' })).status).toBe(403);
    expect((await call('DELETE', '/imports/999999', { as: 'ana' })).status).toBe(404);
    const [g2] = await gameIdsOf(firstBatch);
    expect((await call('DELETE', `/imports/${firstBatch}`, { as: 'ana' })).status).toBe(204);
    expect(await gameIdsOf(firstBatch)).toEqual([]);
    expect((await call('GET', `/games/${must(g2)}`)).status).toBe(404);
    expect((await testPool().query('select 1 from game_players where game_id = $1', [g2])).rows).toHaveLength(0);
    expect((await call('GET', '/players?mine=true', { as: 'ana' })).body).toHaveLength(3);

    const [other] = importBatchSummarySchema.array().parse((await call('GET', '/imports', { as: 'ana' })).body);
    expect((await call('DELETE', `/imports/${must(other).id}`, { as: 'boss' })).status).toBe(204);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('faction aliases API', () => {
  beforeAll(async () => {
    for (const who of ['ana', 'boss'] as const) await call('GET', '/me', { as: who });
  });
  afterAll(closeTestPool);

  it('lists the seeded aliases publicly', async () => {
    const res = await call('GET', '/factions/aliases');
    expect(res.body).toContainEqual({ alias: 'necro virus', factionId: expect.any(Number) as number });
  });

  it('lets admins add normalized aliases', async () => {
    const { rows } = await testPool().query<{ id: number }>("select id from factions where name = 'Winnu'");
    const factionId = must(rows[0]).id;
    expect((await call('POST', '/factions/aliases', { as: 'ana', body: { alias: 'Winu', factionId } })).status).toBe(403);
    const res = await call('POST', '/factions/aliases', { as: 'boss', body: { alias: '  The   WINU ', factionId } });
    expect([res.status, res.body]).toEqual([201, { alias: 'the winu', factionId }]);
    expect((await call('POST', '/factions/aliases', { as: 'boss', body: { alias: 'the winu', factionId } })).status).toBe(409);
    expect((await call('POST', '/factions/aliases', { as: 'boss', body: { alias: 'x', factionId: 99999 } })).status).toBe(400);
  });
});

function never(): never {
  throw new Error('unreachable');
}
