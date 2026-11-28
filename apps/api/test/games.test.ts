import { gameDetailSchema, gamesPageSchema, playerSchema, type GameInputDraft, type Player } from '@mecatol/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { closeTestPool, must, resetDatabase, TEST_DATABASE_URL, testPool } from './test-db.js';

// Real routes and SQL against the test database. Only Neon Auth is faked: the session cookie's
// value is the user's id, and their email is `<name>@example.com`.

vi.mock('../src/db/connections.js', async () => {
  const { testPool: pool } = await import('./test-db.js');
  const { runTransaction } = await import('../src/db/sql.js');
  return {
    readDb: () => pool(),
    withTransaction: (_url: string, fn: Parameters<typeof runTransaction>[1]) => runTransaction(pool(), fn),
  };
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
const issuePaths = (body: unknown) => ((body as { issues?: { path: (string | number)[] }[] }).issues ?? []).map((i) => i.path.join('.'));

describe.skipIf(!TEST_DATABASE_URL)('players and games API', () => {
  const f: Record<string, number> = {};
  const anaRoster: Record<string, Player> = {};
  const ana = (name: string) => must(anaRoster[name], name);
  const fid = (name: string) => must(f[name], name);
  const seatAt = (i: number) => must(game().seats[i]);
  let benEric: Player;

  beforeAll(async () => {
    await resetDatabase();
    const { rows } = await testPool().query<{ id: number; name: string }>('select id, name from factions');
    for (const r of rows) f[r.name] = r.id;
    for (const who of ['ana', 'ben', 'boss'] as const) await call('GET', '/me', { as: who });
  });

  afterAll(closeTestPool);

  const game = (over: Partial<GameInputDraft> = {}): GameInputDraft => ({
    playedOn: '2026-05-21',
    vpTarget: 10,
    endedEarly: false,
    notes: null,
    seats: [
      { playerId: ana('Cody').id, factionId: fid('Federation of Sol'), points: 10 },
      { playerId: ana('Marcus').id, factionId: fid('Nekro Virus'), points: 7 },
    ],
    winnerPlayerId: ana('Cody').id,
    ...over,
  });

  describe('factions', () => {
    it('lists all 30 publicly', async () => {
      const res = await call('GET', '/factions');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(30);
    });
  });

  describe('players', () => {
    it('needs a session to create', async () => {
      expect((await call('POST', '/players', { body: { name: 'X' } })).status).toBe(401);
    });

    it('creates players in your own roster, trimming names', async () => {
      for (const name of ['Cody', ' Marcus ', 'Eric', 'Jess']) {
        const res = await call('POST', '/players', { as: 'ana', body: { name } });
        expect(res.status).toBe(201);
        const p = playerSchema.parse(res.body);
        anaRoster[p.name] = p;
      }
      expect(Object.keys(anaRoster)).toEqual(['Cody', 'Marcus', 'Eric', 'Jess']);
      const res = await call('POST', '/players', { as: 'ben', body: { name: 'Eric' } });
      expect(res.status).toBe(201);
      benEric = playerSchema.parse(res.body);
    });

    it('refuses the same name twice in one roster, ignoring case, and returns the existing player', async () => {
      const res = await call('POST', '/players', { as: 'ana', body: { name: 'eric' } });
      expect(res.status).toBe(409);
      expect((res.body as { player: Player }).player.id).toBe(ana('Eric').id);
    });

    it('lists everyone publicly, or just your roster with mine=true', async () => {
      const all = playerSchema.array().parse((await call('GET', '/players')).body);
      expect(all.map((p) => p.name)).toEqual(['Cody', 'Eric', 'Eric', 'Jess', 'Marcus']);
      const mine = playerSchema.array().parse((await call('GET', '/players?mine=true', { as: 'ben' })).body);
      expect(mine.map((p) => p.id)).toEqual([benEric.id]);
      expect((await call('GET', '/players?mine=true')).status).toBe(401);
      const byOwner = playerSchema.array().parse((await call('GET', `/players?createdBy=${USERS.ana}`)).body);
      expect(byOwner).toHaveLength(4);
    });

    it('lets only the roster owner or an admin rename or archive', async () => {
      const id = ana('Jess').id;
      expect((await call('PATCH', `/players/${id}`, { as: 'ben', body: { name: 'Nope' } })).status).toBe(403);
      expect((await call('PATCH', `/players/${id}`, { as: 'ana', body: { name: 'Cody' } })).status).toBe(409);
      const renamed = await call('PATCH', `/players/${id}`, { as: 'ana', body: { name: 'Jessica' } });
      expect(renamed.body).toMatchObject({ name: 'Jessica', archived: false });
      const archived = await call('PATCH', `/players/${id}`, { as: 'boss', body: { archived: true } });
      expect(archived.body).toMatchObject({ name: 'Jessica', archived: true });
      expect((await call('PATCH', '/players/999999', { as: 'ana', body: { archived: true } })).status).toBe(404);
    });
  });

  describe('games', () => {
    let gameId: number;

    it('needs a session to log a game', async () => {
      expect((await call('POST', '/games', { body: game() })).status).toBe(401);
    });

    it('logs a game and returns its detail with derived values', async () => {
      const res = await call('POST', '/games', { as: 'ana', body: game({ notes: ' Total Annihilation ' }) });
      expect(res.status).toBe(201);
      const detail = gameDetailSchema.parse(res.body);
      gameId = detail.id;
      expect(detail).toMatchObject({
        playedOn: '2026-05-21',
        playerCount: 2,
        pointSpread: 3,
        notes: 'Total Annihilation',
        winner: { player: { name: 'Cody' }, faction: { name: 'Federation of Sol' }, points: 10 },
        createdBy: { id: USERS.ana },
      });
      expect(detail.seats.map((s) => [s.player.name, s.points, s.isWinner])).toEqual([
        ['Cody', 10, true],
        ['Marcus', 7, false],
      ]);
    });

    it('re-validates the domain rules', async () => {
      const tie = game({ seats: [seatAt(0), { ...seatAt(1), points: 10 }] });
      const res = await call('POST', '/games', { as: 'ana', body: tie });
      expect(res.status).toBe(400);
      expect(issuePaths(res.body)).toEqual(['winnerPlayerId']);
      expect((await call('POST', '/games', { as: 'ana', body: { ...tie, endedEarly: true } })).status).toBe(201);
    });

    it("refuses players from someone else's roster and archived players", async () => {
      const seats = [seatAt(0), { playerId: benEric.id, factionId: fid('Winnu'), points: 3 }];
      const res = await call('POST', '/games', { as: 'ana', body: game({ seats }) });
      expect(res.status).toBe(400);
      expect(issuePaths(res.body)).toEqual(['seats.1.playerId']);

      const archived = [seatAt(0), { playerId: ana('Jess').id, factionId: fid('Winnu'), points: 3 }];
      const res2 = await call('POST', '/games', { as: 'ana', body: game({ seats: archived }) });
      expect(errorOf(res2.body)).toBe('Jessica is archived');
    });

    it('shows a game to anyone, and 404s unknown ids', async () => {
      expect((await call('GET', `/games/${gameId}`)).status).toBe(200);
      expect((await call('GET', '/games/999999')).status).toBe(404);
      expect((await call('GET', '/games/abc')).status).toBe(404);
    });

    it('lets the creator edit, replacing the seats', async () => {
      const seats = [
        { playerId: ana('Marcus').id, factionId: fid('Nekro Virus'), points: 12 },
        { playerId: ana('Cody').id, factionId: fid('Arborec'), points: 9 },
        { playerId: ana('Eric').id, factionId: fid('Winnu'), points: 4 },
      ];
      const res = await call('PUT', `/games/${gameId}`, {
        as: 'ana',
        body: game({ seats, winnerPlayerId: ana('Marcus').id, vpTarget: 14, playedOn: null }),
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ playerCount: 3, pointSpread: 3, vpTarget: 14, playedOn: null, notes: null });
      expect(gameDetailSchema.parse(res.body).seats.map((s) => s.player.name)).toEqual(['Marcus', 'Cody', 'Eric']);
    });

    it("stops other users editing or deleting; admins can, using the creator's roster", async () => {
      expect((await call('PUT', `/games/${gameId}`, { as: 'ben', body: game() })).status).toBe(403);
      expect((await call('DELETE', `/games/${gameId}`, { as: 'ben' })).status).toBe(403);
      const bossSeats = [seatAt(0), { playerId: benEric.id, factionId: fid('Winnu'), points: 1 }];
      expect((await call('PUT', `/games/${gameId}`, { as: 'boss', body: game({ seats: bossSeats }) })).status).toBe(400);
      expect((await call('PUT', `/games/${gameId}`, { as: 'boss', body: game() })).status).toBe(200);
    });

    it('keeps an archived player who was already in the game', async () => {
      const seats = [seatAt(0), { playerId: ana('Marcus').id, factionId: fid('Winnu'), points: 2 }];
      const created = gameDetailSchema.parse((await call('POST', '/games', { as: 'ana', body: game({ seats }) })).body);
      await call('PATCH', `/players/${ana('Marcus').id}`, { as: 'ana', body: { archived: true } });
      const res = await call('PUT', `/games/${created.id}`, { as: 'ana', body: game({ seats, notes: 'edited' }) });
      expect(res.status).toBe(200);
      await call('PATCH', `/players/${ana('Marcus').id}`, { as: 'ana', body: { archived: false } });
    });

    it('filters and pages the list, newest first with undated games last', async () => {
      await call('POST', '/games', { as: 'ben', body: game({ seats: [
        { playerId: benEric.id, factionId: fid('Winnu'), points: 10 },
        { playerId: (await call('POST', '/players', { as: 'ben', body: { name: 'Zed' } }) as { body: Player }).body.id, factionId: fid('Arborec'), points: 2 },
      ], winnerPlayerId: benEric.id, playedOn: '2026-07-01' }) });

      const all = gamesPageSchema.parse((await call('GET', '/games')).body);
      expect(all.games.map((g) => g.playedOn)).toEqual(['2026-07-01', '2026-05-21', '2026-05-21', '2026-05-21']);
      expect(all.nextOffset).toBeNull();

      const page = gamesPageSchema.parse((await call('GET', '/games?limit=2')).body);
      expect(page.games).toHaveLength(2);
      expect(page.nextOffset).toBe(2);
      const page2 = gamesPageSchema.parse((await call('GET', '/games?limit=2&offset=2')).body);
      expect(page2.nextOffset).toBeNull();

      const q = async (qs: string, as?: Who) => gamesPageSchema.parse((await call('GET', `/games?${qs}`, { as })).body).games;
      expect(await q(`playerId=${benEric.id}`)).toHaveLength(1);
      expect(await q(`factionId=${fid('Winnu')}`)).toHaveLength(2);
      expect(await q('playerCount=3')).toHaveLength(0);
      expect(await q('from=2026-06-01')).toHaveLength(1);
      expect(await q('to=2026-06-01')).toHaveLength(3);
      expect(await q('mine=true', 'ben')).toHaveLength(1);
      expect((await call('GET', '/games?mine=true')).status).toBe(401);
      expect((await call('GET', '/games?playerCount=9')).status).toBe(400);
    });

    it('lets the creator delete, taking the seats with it', async () => {
      expect((await call('DELETE', `/games/${gameId}`, { as: 'ana' })).status).toBe(204);
      expect((await call('GET', `/games/${gameId}`)).status).toBe(404);
      expect((await call('DELETE', `/games/${gameId}`, { as: 'ana' })).status).toBe(404);
      const { rows } = await testPool().query('select 1 from game_players where game_id = $1', [gameId]);
      expect(rows).toHaveLength(0);
    });
  });
});
