import { useQuery } from '@tanstack/react-query';
import { fetchFactionAliases, fetchFactions, fetchPlayers } from './api.js';

export const queryKeys = {
  factions: ['factions'] as const,
  factionAliases: ['factions', 'aliases'] as const,
  imports: ['imports'] as const,
  players: (filter: { mine?: boolean; createdBy?: string } = {}) => ['players', filter] as const,
  allPlayers: ['players'] as const,
  games: ['games'] as const,
  game: (id: number) => ['game', id] as const,
};

/** Factions change only through admin action, so they're cached for the session. */
export function useFactions() {
  return useQuery({ queryKey: queryKeys.factions, queryFn: fetchFactions, staleTime: Infinity });
}

/** All players, or one roster by owner id. */
export function usePlayers(createdBy?: string) {
  const filter = createdBy ? { createdBy } : {};
  return useQuery({ queryKey: queryKeys.players(filter), queryFn: () => fetchPlayers(filter) });
}

export function useFactionAliases() {
  return useQuery({ queryKey: queryKeys.factionAliases, queryFn: fetchFactionAliases, staleTime: Infinity });
}
