import { useQuery } from '@tanstack/react-query';
import { fetchFactionAliases, fetchFactions, fetchPlayers, type PlayersFilter } from './api.js';

export const queryKeys = {
  factions: ['factions'] as const,
  factionAliases: ['factions', 'aliases'] as const,
  imports: ['imports'] as const,
  players: (filter: PlayersFilter = {}) => ['players', filter] as const,
  allPlayers: ['players'] as const,
  /** Under `players`, so anything that invalidates players refreshes it. */
  player: (id: number) => ['players', 'one', id] as const,
  games: ['games'] as const,
  /** Under `games`, so anything that invalidates games refreshes stats too. */
  stats: (kind: string, ...args: unknown[]) => ['games', 'stats', kind, ...args] as const,
  game: (id: number) => ['game', id] as const,
  users: ['users'] as const,
};

/** Factions change only through admin action, so they're cached for the session. */
export function useFactions() {
  return useQuery({ queryKey: queryKeys.factions, queryFn: fetchFactions, staleTime: Infinity });
}

/** All players, or one roster by owner id. */
export function usePlayers(createdBy?: string) {
  return usePlayerList(createdBy ? { createdBy } : {});
}

export function usePlayerList(filter: PlayersFilter, enabled = true) {
  return useQuery({ queryKey: queryKeys.players(filter), queryFn: () => fetchPlayers(filter), enabled });
}

export function useFactionAliases() {
  return useQuery({ queryKey: queryKeys.factionAliases, queryFn: fetchFactionAliases, staleTime: Infinity });
}
