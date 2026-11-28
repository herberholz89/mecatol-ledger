import { adminUserSchema, factionAliasSchema, factionSchema } from '@mecatol/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { closeTestPool, resetDatabase, TEST_DATABASE_URL } from './test-db.js';

// Admin: factions, aliases, users & roles. Real routes and SQL; Neon Auth is faked as in games.test.ts.

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

describe.skipIf(!TEST_DATABASE_URL)('admin API', () => {
  beforeAll(async () => {
    await resetDatabase();
    for (const who of ['ana', 'ben', 'boss'] as const) await call('GET', '/me', { as: who });
  });

  afterAll(closeTestPool);

  describe('factions', () => {
    let id: number;

    it('lets only admins add one, refusing a taken name ignoring case', async () => {
      expect((await call('POST', '/factions', { body: { name: 'Hylar', expansion: 'codex' } })).status).toBe(401);
      expect((await call('POST', '/factions', { as: 'ana', body: { name: 'Hylar', expansion: 'codex' } })).status).toBe(403);
      const res = await call('POST', '/factions', { as: 'boss', body: { name: '  Hylar ', expansion: 'codex' } });
      expect(res.status).toBe(201);
      const faction = factionSchema.parse(res.body);
      expect(faction).toMatchObject({ name: 'Hylar', expansion: 'codex', archived: false });
      id = faction.id;
      expect((await call('POST', '/factions', { as: 'boss', body: { name: 'ARBOREC', expansion: 'base' } })).status).toBe(409);
      expect((await call('POST', '/factions', { as: 'boss', body: { name: 'X', expansion: 'nope' } })).status).toBe(400);
      expect((await call('GET', '/factions')).body).toHaveLength(31);
    });

    it('renames, moves and archives, refusing taken names and unknown ids', async () => {
      expect((await call('PATCH', `/factions/${id}`, { as: 'ana', body: { archived: true } })).status).toBe(403);
      const renamed = await call('PATCH', `/factions/${id}`, { as: 'boss', body: { name: 'The Hylar', expansion: 'thunders_edge' } });
      expect(renamed.body).toMatchObject({ id, name: 'The Hylar', expansion: 'thunders_edge', archived: false });
      expect((await call('PATCH', `/factions/${id}`, { as: 'boss', body: { archived: true } })).body).toMatchObject({ name: 'The Hylar', archived: true });
      const taken = await call('PATCH', `/factions/${id}`, { as: 'boss', body: { name: 'winnu' } });
      expect(taken.status).toBe(409);
      expect(errorOf(taken.body)).toBe("There's already a faction called winnu");
      // Changing only the case of its own name is fine.
      expect((await call('PATCH', `/factions/${id}`, { as: 'boss', body: { name: 'the hylar' } })).status).toBe(200);
      expect((await call('PATCH', `/factions/${id}`, { as: 'boss', body: {} })).status).toBe(400);
      expect((await call('PATCH', '/factions/999999', { as: 'boss', body: { archived: true } })).status).toBe(404);
    });
  });

  describe('aliases', () => {
    it('lets only admins delete one, by its typed or normalized form', async () => {
      expect((await call('DELETE', `/factions/aliases/${encodeURIComponent('Necro Virus')}`, { as: 'ana' })).status).toBe(403);
      expect((await call('DELETE', `/factions/aliases/${encodeURIComponent('  Necro   VIRUS ')}`, { as: 'boss' })).status).toBe(204);
      expect((await call('DELETE', `/factions/aliases/${encodeURIComponent('necro virus')}`, { as: 'boss' })).status).toBe(404);
      const aliases = factionAliasSchema.array().parse((await call('GET', '/factions/aliases')).body);
      expect(aliases.map((a) => a.alias)).not.toContain('necro virus');
      expect((await call('DELETE', `/factions/aliases/${encodeURIComponent("the vuil'rairh cabal")}`, { as: 'boss' })).status).toBe(204);
    });
  });

  describe('users and roles', () => {
    it('lists users with counts for admins only', async () => {
      expect((await call('GET', '/users')).status).toBe(401);
      expect((await call('GET', '/users', { as: 'ana' })).status).toBe(403);
      await call('POST', '/players', { as: 'ana', body: { name: 'Cody' } });
      const users = adminUserSchema.array().parse((await call('GET', '/users', { as: 'boss' })).body);
      expect(users.map((u) => [u.email, u.role, u.adminByEmail, u.players])).toEqual([
        ['boss@example.com', 'admin', true, 0],
        ['ana@example.com', 'user', false, 1],
        ['ben@example.com', 'user', false, 0],
      ]);
    });

    it('promotes and demotes, and the change applies on the next request', async () => {
      const promoted = await call('PATCH', `/users/${USERS.ana}`, { as: 'boss', body: { role: 'admin' } });
      expect(promoted.body).toMatchObject({ email: 'ana@example.com', role: 'admin' });
      expect((await call('GET', '/users', { as: 'ana' })).status).toBe(200);
      expect((await call('PATCH', `/users/${USERS.ana}`, { as: 'boss', body: { role: 'user' } })).body).toMatchObject({ role: 'user' });
      expect((await call('GET', '/users', { as: 'ana' })).status).toBe(403);
    });

    it("refuses your own role, ADMIN_EMAILS users, bad roles and unknown users", async () => {
      expect((await call('PATCH', `/users/${USERS.boss}`, { as: 'boss', body: { role: 'user' } })).status).toBe(400);
      await call('PATCH', `/users/${USERS.ben}`, { as: 'boss', body: { role: 'admin' } });
      const pinned = await call('PATCH', `/users/${USERS.boss}`, { as: 'ben', body: { role: 'user' } });
      expect(pinned.status).toBe(409);
      expect(errorOf(pinned.body)).toContain('ADMIN_EMAILS');
      expect((await call('PATCH', `/users/${USERS.ana}`, { as: 'boss', body: { role: 'owner' } })).status).toBe(400);
      expect((await call('PATCH', '/users/44444444-4444-4444-8444-444444444444', { as: 'boss', body: { role: 'admin' } })).status).toBe(404);
      expect((await call('PATCH', '/users/not-a-uuid', { as: 'boss', body: { role: 'admin' } })).status).toBe(404);
    });
  });
});
