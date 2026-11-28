import { z } from 'zod';
import { factionSchema, isoDateSchema, MAX_SEATS, MIN_SEATS, playerSchema } from './games.js';

/**
 * Query of every `GET /api/stats/*` route. Filters apply to games before aggregating. Date filters
 * leave out undated games. `mine` (needs a session) keeps only games you logged, which also means
 * only your roster, since a game's seats come from its logger's roster.
 */
export const statsQuerySchema = z
  .object({
    playerCount: z.coerce.number().int().min(MIN_SEATS).max(MAX_SEATS).optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    mine: z.stringbool().optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['to'], message: '"To" must be on or after "From"' });
export type StatsQuery = z.infer<typeof statsQuerySchema>;

/**
 * Aggregates over a set of seats. Rates are 0–1 and null when there are no games.
 * Expected win rate is the average of 1 / player count: what a coin-flip player would win.
 */
export const statLineShape = {
  games: z.number().int(),
  wins: z.number().int(),
  winRate: z.number().nullable(),
  expectedWinRate: z.number().nullable(),
  avgPoints: z.number().nullable(),
};
export const statLineSchema = z.object(statLineShape);
export type StatLine = z.infer<typeof statLineSchema>;

export const factionStatsSchema = z.object({ faction: factionSchema, ...statLineShape });
export type FactionStats = z.infer<typeof factionStatsSchema>;

export const playerStatsSchema = z.object({ player: playerSchema, ...statLineShape });
export type PlayerStats = z.infer<typeof playerStatsSchema>;

/** One seat's result, oldest game first (undated games before dated ones), for trend charts. */
export const seatResultSchema = z.object({
  gameId: z.number().int(),
  playedOn: isoDateSchema.nullable(),
  playerCount: z.number().int(),
  isWinner: z.boolean(),
});
export type SeatResult = z.infer<typeof seatResultSchema>;

/** `GET /api/stats/factions/:id`: totals, who plays it, and each result. */
export const factionStatsDetailSchema = z.object({
  faction: factionSchema,
  totals: statLineSchema,
  players: z.array(playerStatsSchema),
  results: z.array(seatResultSchema),
});
export type FactionStatsDetail = z.infer<typeof factionStatsDetailSchema>;

/** `GET /api/stats/players/:id`: totals, record by faction, and each result. */
export const playerStatsDetailSchema = z.object({
  player: playerSchema,
  totals: statLineSchema,
  factions: z.array(factionStatsSchema),
  results: z.array(seatResultSchema),
});
export type PlayerStatsDetail = z.infer<typeof playerStatsDetailSchema>;

/** `GET /api/stats/overview`: headline numbers for the dashboard. */
export const statsOverviewSchema = z.object({
  games: z.number().int(),
  players: z.number().int(),
  factionsPlayed: z.number().int(),
  avgPointSpread: z.number().nullable(),
});
export type StatsOverview = z.infer<typeof statsOverviewSchema>;

/** Running win rate after each result, for a trend line. */
export function runningWinRate(results: readonly SeatResult[]): { game: number; winRate: number; expected: number }[] {
  let wins = 0;
  let expected = 0;
  return results.map((r, i) => {
    if (r.isWinner) wins += 1;
    expected += 1 / r.playerCount;
    return { game: i + 1, winRate: wins / (i + 1), expected: expected / (i + 1) };
  });
}
