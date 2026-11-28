import { z } from 'zod';
import { EXPANSIONS } from './factions.js';

// ---------------------------------------------------------------------------------------------
// Limits (mirrored by database checks in apps/api/src/db/schema.ts)
// ---------------------------------------------------------------------------------------------

export const PLAYER_NAME_MAX = 40;
export const NOTES_MAX = 2000;
export const MIN_SEATS = 2;
export const MAX_SEATS = 8;
export const VP_TARGET_MIN = 1;
export const VP_TARGET_MAX = 20;
export const POINTS_MAX = 99;

const id = (message: string) => z.number({ error: message }).int(message).positive(message);

// ---------------------------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------------------------

export const factionSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  expansion: z.enum(EXPANSIONS),
  archived: z.boolean(),
});
export type Faction = z.infer<typeof factionSchema>;

export const EXPANSION_LABELS: Readonly<Record<(typeof EXPANSIONS)[number], string>> = {
  base: 'Base game',
  pok: 'Prophecy of Kings',
  codex: 'Codex',
  thunders_edge: "Thunder's Edge",
};

// ---------------------------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------------------------

export const playerNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(PLAYER_NAME_MAX, `At most ${PLAYER_NAME_MAX} characters`);

/** Body of `POST /api/players`. */
export const createPlayerSchema = z.object({ name: playerNameSchema });
export type CreatePlayer = z.infer<typeof createPlayerSchema>;

/** Body of `PATCH /api/players/:id`: rename and/or archive. */
export const updatePlayerSchema = z
  .object({ name: playerNameSchema.optional(), archived: z.boolean().optional() })
  .refine((v) => v.name !== undefined || v.archived !== undefined, 'Nothing to change');
export type UpdatePlayer = z.infer<typeof updatePlayerSchema>;

export const playerSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  archived: z.boolean(),
  /** The roster owner (app_users id). */
  createdBy: z.uuid(),
  /** The roster owner's display name, to tell apart players with the same name in different rosters. */
  ownerName: z.string().nullable(),
});
export type Player = z.infer<typeof playerSchema>;

/** Query of `GET /api/players`. `mine` needs a session. */
export const playersQuerySchema = z.object({
  mine: z.stringbool().optional(),
  createdBy: z.uuid().optional(),
});

// ---------------------------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------------------------

/** `YYYY-MM-DD` that is a real calendar date. */
export const isoDateSchema = z.iso.date('Enter a valid date');

export const seatInputSchema = z.object({
  playerId: id('Pick a player'),
  factionId: id('Pick a faction'),
  points: z
    .number({ error: 'Enter points' })
    .int('Whole points only')
    .min(0, 'At least 0')
    .max(POINTS_MAX, `At most ${POINTS_MAX}`),
});
export type SeatInput = z.infer<typeof seatInputSchema>;

/** Players tied for the most points. Empty when there are no seats. */
export function topScorers(seats: readonly { playerId: number; points: number }[]): number[] {
  const scored = seats.filter((s) => Number.isFinite(s.points));
  if (scored.length === 0) return [];
  const top = Math.max(...scored.map((s) => s.points));
  return scored.filter((s) => s.points === top).map((s) => s.playerId);
}

export interface RuleSeat {
  /** Identifies the player: two seats with the same key are the same player. */
  playerKey: string | number;
  factionId: number;
  points: number;
}

export interface RuleIssue {
  /** The seat the issue is about; undefined for the winner. */
  seat?: number;
  field: 'player' | 'faction' | 'winner';
  message: string;
}

/**
 * The domain rules shared by logged and imported games: no player or faction twice, the winner has
 * the most points, and a tie for the most points only when the game ended early. `winner` is a seat
 * index (-1 when the winner isn't one of the seats). Seat count is checked by the schemas.
 */
export function gameRuleIssues(seats: readonly RuleSeat[], winner: number, endedEarly: boolean): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const seenPlayers = new Set<string | number>();
  const seenFactions = new Set<number>();
  seats.forEach((seat, i) => {
    if (seenPlayers.has(seat.playerKey)) issues.push({ seat: i, field: 'player', message: 'This player is already in the game' });
    if (seenFactions.has(seat.factionId)) issues.push({ seat: i, field: 'faction', message: 'This faction is already in the game' });
    seenPlayers.add(seat.playerKey);
    seenFactions.add(seat.factionId);
  });

  const winnerSeat = seats[winner];
  if (!winnerSeat) {
    issues.push({ field: 'winner', message: 'The winner must be one of the players' });
    return issues;
  }
  const top = Math.max(...seats.map((s) => s.points));
  const tied = seats.filter((s) => s.points === top).length;
  if (winnerSeat.points !== top) {
    issues.push({ field: 'winner', message: 'The winner must have the most points' });
  } else if (tied > 1 && !endedEarly) {
    issues.push({ field: 'winner', message: 'A tie for the most points is only allowed when the game ended early' });
  }
  return issues;
}

/** Fields every game has, logged or imported. */
export const gameFieldsShape = {
  playedOn: isoDateSchema.nullable(),
  vpTarget: z
    .number({ error: 'Enter a VP target' })
    .int()
    .min(VP_TARGET_MIN, `At least ${VP_TARGET_MIN}`)
    .max(VP_TARGET_MAX, `At most ${VP_TARGET_MAX}`),
  endedEarly: z.boolean(),
  notes: z
    .string()
    .trim()
    .max(NOTES_MAX, `At most ${NOTES_MAX} characters`)
    .nullable()
    .transform((v) => (v ? v : null)),
};

export const seatsArraySchema = <T extends z.ZodType>(seat: T) =>
  z
    .array(seat)
    .min(MIN_SEATS, `At least ${MIN_SEATS} players`)
    .max(MAX_SEATS, `At most ${MAX_SEATS} players`);

/**
 * Body of `POST /api/games` and `PUT /api/games/:id`. Enforces the domain rules:
 * 2–8 seats, no player or faction twice, exactly one winner who has the most points,
 * and a tie for the most points only when the game ended early.
 */
export const gameInputSchema = z
  .object({
    ...gameFieldsShape,
    seats: seatsArraySchema(seatInputSchema),
    winnerPlayerId: id('Pick the winner'),
  })
  .superRefine((game, ctx) => {
    const seats = game.seats.map((s) => ({ playerKey: s.playerId, factionId: s.factionId, points: s.points }));
    const winner = game.seats.findIndex((s) => s.playerId === game.winnerPlayerId);
    for (const issue of gameRuleIssues(seats, winner, game.endedEarly)) {
      const path =
        issue.seat === undefined
          ? ['winnerPlayerId']
          : ['seats', issue.seat, issue.field === 'player' ? 'playerId' : 'factionId'];
      ctx.addIssue({ code: 'custom', path, message: issue.message });
    }
  });
export type GameInput = z.infer<typeof gameInputSchema>;
export type GameInputDraft = z.input<typeof gameInputSchema>;

/** Query of `GET /api/games`. `mine` needs a session. */
export const gamesQuerySchema = z
  .object({
    playerId: z.coerce.number().int().positive().optional(),
    factionId: z.coerce.number().int().positive().optional(),
    playerCount: z.coerce.number().int().min(MIN_SEATS).max(MAX_SEATS).optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    mine: z.stringbool().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['to'], message: '"To" must be on or after "From"' });
export type GamesQuery = z.infer<typeof gamesQuerySchema>;

const personRef = z.object({ id: z.number().int(), name: z.string() });

export const gameSummarySchema = z.object({
  id: z.number().int(),
  playedOn: isoDateSchema.nullable(),
  vpTarget: z.number().int(),
  endedEarly: z.boolean(),
  playerCount: z.number().int(),
  pointSpread: z.number().int(),
  winner: z.object({ player: personRef, faction: personRef, points: z.number().int() }),
  createdBy: z.object({ id: z.uuid(), displayName: z.string().nullable() }),
  createdAt: z.string(),
});
export type GameSummary = z.infer<typeof gameSummarySchema>;

export const gamesPageSchema = z.object({
  games: z.array(gameSummarySchema),
  /** Pass as `offset` to load the next page; null on the last page. */
  nextOffset: z.number().int().nullable(),
});
export type GamesPage = z.infer<typeof gamesPageSchema>;

export const gameSeatSchema = z.object({
  player: personRef.extend({ archived: z.boolean() }),
  faction: personRef.extend({ archived: z.boolean() }),
  points: z.number().int(),
  isWinner: z.boolean(),
});
export type GameSeat = z.infer<typeof gameSeatSchema>;

export const gameDetailSchema = gameSummarySchema.extend({
  notes: z.string().nullable(),
  updatedAt: z.string(),
  /** Highest points first. */
  seats: z.array(gameSeatSchema),
});
export type GameDetail = z.infer<typeof gameDetailSchema>;

/** Who may edit or delete a game: its creator or an admin. */
export function canEditGame(user: { id: string; role: string } | null | undefined, createdBy: string): boolean {
  return !!user && (user.role === 'admin' || user.id === createdBy);
}
