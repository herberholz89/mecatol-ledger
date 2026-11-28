import {
  createdImportSchema,
  factionAliasSchema,
  factionSchema,
  IMPORT_CHUNK_GAMES,
  importBatchSummarySchema,
  gameDetailSchema,
  gamesPageSchema,
  healthResponseSchema,
  meResponseSchema,
  rosterPlayerSchema,
  factionStatsDetailSchema,
  factionStatsSchema,
  playerStatsDetailSchema,
  playerStatsSchema,
  statsOverviewSchema,
  type CreateFactionAlias,
  type CreatePlayer,
  type GameInput,
  type MergePlayer,
  type GamesPage,
  type HealthResponse,
  type CreatedImport,
  type ImportBatchInput,
  type ImportChunkInput,
  type ImportGame,
  type MeResponse,
  type RosterPlayer,
  type UpdatePlayer,
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

export interface PlayersFilter {
  mine?: boolean;
  createdBy?: string;
  claimedBy?: string;
}

export function fetchPlayers(filter: PlayersFilter = {}): Promise<RosterPlayer[]> {
  const qs = new URLSearchParams();
  if (filter.mine) qs.set('mine', 'true');
  if (filter.createdBy) qs.set('createdBy', filter.createdBy);
  if (filter.claimedBy) qs.set('claimedBy', filter.claimedBy);
  return request(`/players${qs.size ? `?${qs}` : ''}`, rosterPlayerSchema.array());
}

export const fetchPlayer = (id: number) => request(`/players/${id}`, rosterPlayerSchema);
export const createPlayer = (body: CreatePlayer) => request('/players', rosterPlayerSchema, json('POST', body));
export const updatePlayer = (id: number, body: UpdatePlayer) => request(`/players/${id}`, rosterPlayerSchema, json('PATCH', body));
export const deletePlayer = (id: number) => request(`/players/${id}`, z.null(), { method: 'DELETE' });
export const claimPlayer = (id: number) => request(`/players/${id}/claim`, rosterPlayerSchema, { method: 'POST' });
export const unclaimPlayer = (id: number) => request(`/players/${id}/claim`, rosterPlayerSchema, { method: 'DELETE' });
export const mergePlayer = (id: number, body: MergePlayer) => request(`/players/${id}/merge`, rosterPlayerSchema, json('POST', body));

export interface GamesFilter {
  playerId?: number | undefined;
  factionId?: number | undefined;
  playerCount?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  mine?: boolean | undefined;
}

/** Query string from a filter object, leaving out unset and false values. Starts with `?` unless empty. */
function queryString(filter: object, extra: Record<string, string> = {}): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(filter) as [string, unknown][]) {
    if (value !== undefined && value !== false && value !== '') qs.set(key, String(value));
  }
  for (const [key, value] of Object.entries(extra)) qs.set(key, value);
  return qs.size ? `?${qs}` : '';
}

export function fetchGames(filter: GamesFilter, offset: number, limit?: number): Promise<GamesPage> {
  const extra: Record<string, string> = {};
  if (offset) extra.offset = String(offset);
  if (limit) extra.limit = String(limit);
  return request(`/games${queryString(filter, extra)}`, gamesPageSchema);
}

export const fetchGame = (id: number) => request(`/games/${id}`, gameDetailSchema);
export const createGame = (body: GameInput) => request('/games', gameDetailSchema, json('POST', body));
export const updateGame = (id: number, body: GameInput) => request(`/games/${id}`, gameDetailSchema, json('PUT', body));
export const deleteGame = (id: number) => request(`/games/${id}`, z.null(), { method: 'DELETE' });

// ---------------------------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------------------------

export interface StatsFilter {
  playerCount?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  mine?: boolean | undefined;
}

export const fetchStatsOverview = (f: StatsFilter) => request(`/stats/overview${queryString(f)}`, statsOverviewSchema);
export const fetchFactionStats = (f: StatsFilter) => request(`/stats/factions${queryString(f)}`, factionStatsSchema.array());
export const fetchPlayerStats = (f: StatsFilter) => request(`/stats/players${queryString(f)}`, playerStatsSchema.array());
export const fetchFactionStatsDetail = (id: number, f: StatsFilter) =>
  request(`/stats/factions/${id}${queryString(f)}`, factionStatsDetailSchema);
export const fetchPlayerStatsDetail = (id: number, f: StatsFilter) =>
  request(`/stats/players/${id}${queryString(f)}`, playerStatsDetailSchema);

// ---------------------------------------------------------------------------------------------
// Imports and faction aliases
// ---------------------------------------------------------------------------------------------

export const fetchFactionAliases = () => request('/factions/aliases', factionAliasSchema.array());
export const createFactionAlias = (body: CreateFactionAlias) => request('/factions/aliases', factionAliasSchema, json('POST', body));

export const fetchImports = () => request('/imports', importBatchSummarySchema.array());
export const createImport = (body: ImportBatchInput) => request('/imports', createdImportSchema, json('POST', body));
export const addImportGames = (id: number, body: ImportChunkInput) => request(`/imports/${id}/games`, createdImportSchema, json('POST', body));
export const deleteImport = (id: number) => request(`/imports/${id}`, z.null(), { method: 'DELETE' });

/**
 * Imports games in chunks of IMPORT_CHUNK_GAMES so each request stays under the Worker's CPU limit.
 * The first chunk creates the batch and the rest are added to it, in order. If a chunk fails, the
 * batch is deleted again so the import stays all or nothing.
 */
export async function importInChunks(
  sourceName: string,
  games: ImportGame[],
  onProgress: (saved: number) => void,
): Promise<CreatedImport> {
  const chunks: ImportGame[][] = [];
  for (let i = 0; i < games.length; i += IMPORT_CHUNK_GAMES) chunks.push(games.slice(i, i + IMPORT_CHUNK_GAMES));
  const [first, ...rest] = chunks;
  if (!first) throw new Error('Nothing to import');

  let result = await createImport({ sourceName, games: first });
  let newPlayers = result.newPlayers;
  onProgress(result.games);
  try {
    for (const chunk of rest) {
      result = await addImportGames(result.id, { games: chunk });
      newPlayers += result.newPlayers;
      onProgress(result.games);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      await deleteImport(result.id);
    } catch {
      throw new Error(`The import stopped after ${result.games} of ${games.length} games (${reason}). Undo it from your account page and try again.`, {
        cause: err,
      });
    }
    throw new Error(`The import stopped partway and was undone: ${reason}`, { cause: err });
  }
  return { ...result, newPlayers };
}
