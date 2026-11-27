import { z } from 'zod';

/** Request headers never forwarded to Neon Auth. `host` must match the upstream; the rest are Cloudflare's. */
const DROP_REQUEST_HEADERS = ['host', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'cf-worker', 'x-real-ip'];

function upstreamUrl(baseUrl: string, subPath: string, search = ''): string {
  return `${baseUrl.replace(/\/+$/, '')}/${subPath.replace(/^\/+/, '')}${search}`;
}

/**
 * Forwards a request unchanged to Neon Auth, rewriting only the URL. Set-Cookie headers come back on
 * the app's own origin, so the session cookie is first-party. No crypto here: just a fetch.
 */
export async function proxyToNeonAuth(req: Request, baseUrl: string, subPath: string): Promise<Response> {
  const headers = new Headers(req.headers);
  for (const h of DROP_REQUEST_HEADERS) headers.delete(h);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const upstream = await fetch(upstreamUrl(baseUrl, subPath, new URL(req.url).search), {
    method: req.method,
    headers,
    // Auth bodies are tiny JSON; buffering avoids streaming-body (`duplex`) differences between runtimes.
    body: hasBody ? await req.arrayBuffer() : undefined,
    redirect: 'manual',
  });
  // Copy into a fresh Response so headers are mutable and the body streams through.
  return new Response(upstream.body, upstream);
}

const sessionSchema = z
  .object({
    user: z.object({ id: z.uuid(), email: z.string(), emailVerified: z.boolean() }),
  })
  .nullable();

export interface NeonSession {
  user: { id: string; email: string; emailVerified: boolean };
  /** Refreshed session cookies Neon Auth sent back, to pass on to the browser. */
  setCookies: string[];
}

/** Asks Neon Auth who the cookie belongs to. Returns null when there's no valid session. */
export async function getNeonSession(baseUrl: string, cookie: string): Promise<NeonSession | null> {
  const res = await fetch(upstreamUrl(baseUrl, 'get-session'), {
    headers: { cookie, accept: 'application/json' },
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Neon Auth get-session failed: ${res.status}`);
  const body = sessionSchema.parse(await res.json());
  if (!body) return null;
  return { user: body.user, setCookies: res.headers.getSetCookie() };
}
