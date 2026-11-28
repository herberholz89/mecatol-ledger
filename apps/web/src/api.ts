import {
  factionSchema,
  gameDetailSchema,
  gamesPageSchema,
  healthResponseSchema,
  meResponseSchema,
  playerSchema,
  type CreatePlayer,
  type GameInput,
  type GamesPage,
  type HealthResponse,
  type MeResponse,
  type Player,
  type UpdateMe,
} from '@mecatol/shared';
import { z } from 'zod';

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  // 503 still carries a valid health body.
  if (!res.ok && res.status !== 503) throw new Error(`Health check failed: ${res.status}`);
  return healthResponseSchema.parse(await res.json());
}

/** The signed-in user, or null when signed out. */
export async function fetchMe(): Promise<MeResponse | null> {
  const res = await fetch('/api/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Loading your account failed: ${res.status}`);
  return meResponseSchema.parse(await res.json());
}

export async function updateMe(body: UpdateMe): Promise<MeResponse> {
  const res = await fetch('/api/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Saving failed: ${res.status}`);
  return meResponseSchema.parse(await res.json());
}

// ---------------------------------------------------------------------------------------------
// Players, factions, games
// ---------------------------------------------------------------------------------------------

export interface ApiIssue {
  path: (string | number)[];
  message: string;
}

/** A non-2xx API response. `issues` carries per-field validation errors when the API sent them. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: ApiIssue[] = [],
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

async function request<S extends z.ZodType>(path: string, schema: S, init?: RequestInit): Promise<z.output<S>> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const { error, issues } = (body ?? {}) as { error?: string; issues?: ApiIssue[] };
    throw new ApiError(res.status, error ?? `Request failed: ${res.status}`, issues ?? [], body);
  }
  return schema.parse(res.status === 204 ? null : await res.json());
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const fetchFactions = () => request('/factions', factionSchema.array());

export function fetchPlayers(filter: { mine?: boolean; createdBy?: string } = {}): Promise<Player[]> {
  const qs = new URLSearchParams();
  if (filter.mine) qs.set('mine', 'true');
  if (filter.createdBy) qs.set('createdBy', filter.createdBy);
  return request(`/players${qs.size ? `?${qs}` : ''}`, playerSchema.array());
}

export const createPlayer = (body: CreatePlayer) => request('/players', playerSchema, json('POST', body));

export interface GamesFilter {
  playerId?: number | undefined;
  factionId?: number | undefined;
  playerCount?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  mine?: boolean | undefined;
}

export function fetchGames(filter: GamesFilter, offset: number): Promise<GamesPage> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== false && value !== '') qs.set(key, String(value));
  }
  if (offset) qs.set('offset', String(offset));
  return request(`/games${qs.size ? `?${qs}` : ''}`, gamesPageSchema);
}

export const fetchGame = (id: number) => request(`/games/${id}`, gameDetailSchema);
export const createGame = (body: GameInput) => request('/games', gameDetailSchema, json('POST', body));
export const updateGame = (id: number, body: GameInput) => request(`/games/${id}`, gameDetailSchema, json('PUT', body));
export const deleteGame = (id: number) => request(`/games/${id}`, z.null(), { method: 'DELETE' });
