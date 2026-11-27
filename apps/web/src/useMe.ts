import { useQuery } from '@tanstack/react-query';
import { fetchMe } from './api.js';

export const ME_QUERY_KEY = ['me'] as const;

export function useMe() {
  return useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, staleTime: 5 * 60_000 });
}
