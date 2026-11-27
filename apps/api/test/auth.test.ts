import { afterEach, describe, expect, it, vi } from 'vitest';
import { meResponseSchema } from '@mecatol/shared';
import { app } from '../src/app.js';
import type { AppUser } from '../src/db/schema.js';
import { updateDisplayName, upsertAppUser } from '../src/db/users.js';

vi.mock('../src/db/users.js', () => ({ upsertAppUser: vi.fn(), updateDisplayName: vi.fn() }));

const AUTH = 'https://auth.example.test/neondb/auth';
const env = { DATABASE_URL: 'postgres://unused', NEON_AUTH_BASE_URL: AUTH, ADMIN_EMAILS: 'boss@example.com', ASSETS: {} as Fetcher };
const USER_ID = '57196779-a30c-4b00-816e-fd683d01c6d4';
const COOKIE = '__Secure-neon-auth.session_token=abc';

const row = (over: Partial<AppUser> = {}): AppUser => ({
  id: USER_ID,
  email: 'me@example.com',
  displayName: null,
  role: 'user',
  createdAt: new Date('2026-11-27T00:00:00Z'),
  ...over,
});

function mockFetch(handler: (req: Request) => Response | Promise<Response>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(new Request(input, init))));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const sessionFor = (email: string, setCookie?: string) => () =>
  Response.json(
    { session: { id: 's' }, user: { id: USER_ID, email, emailVerified: true } },
    setCookie ? { headers: { 'set-cookie': setCookie } } : {},
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('/api/auth proxy', () => {
  it('forwards method, path, query, body and cookies, and returns Set-Cookie', async () => {
    const fetchMock = mockFetch(async (req) => {
      expect(req.url).toBe(`${AUTH}/sign-in/email-otp?x=1`);
      expect(req.method).toBe('POST');
      expect(req.headers.get('origin')).toBe('http://localhost:5173');
      expect(req.headers.get('cookie')).toBe('a=b');
      expect(req.headers.get('cf-connecting-ip')).toBeNull();
      expect(await req.json()).toEqual({ email: 'me@example.com', otp: '123456' });
      return Response.json({ ok: true }, { headers: { 'set-cookie': `${COOKIE}; Path=/; HttpOnly; Secure` } });
    });
    const res = await app.request(
      '/api/auth/sign-in/email-otp?x=1',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5173', cookie: 'a=b', 'cf-connecting-ip': '1.2.3.4' },
        body: JSON.stringify({ email: 'me@example.com', otp: '123456' }),
      },
      env,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('__Secure-neon-auth.session_token=abc');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('passes upstream errors through', async () => {
    mockFetch(() => Response.json({ message: 'Invalid OTP' }, { status: 400 }));
    const res = await app.request('/api/auth/sign-in/email-otp', { method: 'POST', body: '{}' }, env);
    expect(res.status).toBe(400);
  });
});

describe('/api/me', () => {
  it('returns 401 without a session cookie, without calling Neon Auth', async () => {
    const fetchMock = mockFetch(() => new Response(null));
    const res = await app.request('/api/me', {}, env);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 when Neon Auth has no session for the cookie', async () => {
    mockFetch(() => Response.json(null));
    const res = await app.request('/api/me', { headers: { cookie: COOKIE } }, env);
    expect(res.status).toBe(401);
    expect(upsertAppUser).not.toHaveBeenCalled();
  });

  it('upserts and returns the user, passing refreshed cookies on', async () => {
    const fetchMock = mockFetch(sessionFor('Me@Example.com', `${COOKIE}2; Path=/`));
    vi.mocked(upsertAppUser).mockResolvedValue(row());
    const res = await app.request('/api/me', { headers: { cookie: COOKIE } }, env);
    expect(res.status).toBe(200);
    const sent = fetchMock.mock.calls[0]?.[0];
    expect(String(sent)).toBe(`${AUTH}/get-session`);
    expect(upsertAppUser).toHaveBeenCalledWith('postgres://unused', { id: USER_ID, email: 'me@example.com', isAdmin: false });
    expect(res.headers.get('set-cookie')).toContain('session_token=abc2');
    expect(meResponseSchema.parse(await res.json())).toMatchObject({ id: USER_ID, role: 'user', displayName: null });
  });

  it('promotes emails listed in ADMIN_EMAILS', async () => {
    mockFetch(sessionFor('BOSS@example.com'));
    vi.mocked(upsertAppUser).mockResolvedValue(row({ email: 'boss@example.com', role: 'admin' }));
    await app.request('/api/me', { headers: { cookie: COOKIE } }, env);
    expect(upsertAppUser).toHaveBeenCalledWith('postgres://unused', { id: USER_ID, email: 'boss@example.com', isAdmin: true });
  });

  it('updates the display name', async () => {
    mockFetch(sessionFor('me@example.com'));
    vi.mocked(upsertAppUser).mockResolvedValue(row());
    vi.mocked(updateDisplayName).mockResolvedValue(row({ displayName: 'Cody' }));
    const res = await app.request(
      '/api/me',
      { method: 'PATCH', headers: { cookie: COOKIE, 'content-type': 'application/json' }, body: JSON.stringify({ displayName: ' Cody ' }) },
      env,
    );
    expect(res.status).toBe(200);
    expect(updateDisplayName).toHaveBeenCalledWith('postgres://unused', USER_ID, 'Cody');
    expect(await res.json()).toMatchObject({ displayName: 'Cody' });
  });

  it('rejects an invalid display name', async () => {
    mockFetch(sessionFor('me@example.com'));
    vi.mocked(upsertAppUser).mockResolvedValue(row());
    const res = await app.request(
      '/api/me',
      { method: 'PATCH', headers: { cookie: COOKIE, 'content-type': 'application/json' }, body: JSON.stringify({ displayName: '  ' }) },
      env,
    );
    expect(res.status).toBe(400);
    expect(updateDisplayName).not.toHaveBeenCalled();
  });
});
