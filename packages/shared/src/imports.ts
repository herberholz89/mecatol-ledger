import { z } from 'zod';
import { gameFieldsShape, gameRuleIssues, playerNameSchema, POINTS_MAX, seatsArraySchema } from './games.js';

/** Most games one import can hold. The import page enforces it. */
export const IMPORT_MAX_GAMES = 500;
/**
 * Most games per request. The import page sends a batch in chunks this size so each request stays
 * under the Workers free plan's 10 ms CPU (76 games in one request took 8–15 ms).
 */
export const IMPORT_CHUNK_GAMES = 25;
export const SOURCE_NAME_MAX = 200;

const id = (message: string) => z.number({ error: message }).int(message).positive(message);

/** An existing player in the importer's roster, or a new one created by the import. */
export const importPlayerRefSchema = z.union([
  z.object({ id: id('Pick a player') }).strict(),
  z.object({ name: playerNameSchema }).strict(),
]);
export type ImportPlayerRef = z.infer<typeof importPlayerRefSchema>;

/** Two refs with the same key are the same player. New names match ignoring case. */
export function playerRefKey(ref: ImportPlayerRef): string {
  return 'id' in ref ? `id:${ref.id}` : `name:${ref.name.toLowerCase()}`;
}

export const importSeatSchema = z.object({
  player: importPlayerRefSchema,
  factionId: id('Pick a faction'),
  points: z.number().int('Whole points only').min(0, 'At least 0').max(POINTS_MAX, `At most ${POINTS_MAX}`),
});
export type ImportSeat = z.infer<typeof importSeatSchema>;

/** One imported game. Same rules as a logged game; `winner` is a seat index. */
export const importGameSchema = z
  .object({
    ...gameFieldsShape,
    seats: seatsArraySchema(importSeatSchema),
    winner: z.number().int().min(0),
  })
  .superRefine((game, ctx) => {
    const seats = game.seats.map((s) => ({ playerKey: playerRefKey(s.player), factionId: s.factionId, points: s.points }));
    for (const issue of gameRuleIssues(seats, game.winner, game.endedEarly)) {
      const path =
        issue.seat === undefined ? ['winner'] : ['seats', issue.seat, issue.field === 'player' ? 'player' : 'factionId'];
      ctx.addIssue({ code: 'custom', path, message: issue.message });
    }
  });
export type ImportGame = z.infer<typeof importGameSchema>;
export type ImportGameDraft = z.input<typeof importGameSchema>;

const importGamesArraySchema = z
  .array(importGameSchema)
  .min(1, 'Nothing to import')
  .max(IMPORT_CHUNK_GAMES, `At most ${IMPORT_CHUNK_GAMES} games per request`);

/**
 * Body of `POST /api/imports`: creates the batch with its first chunk of games. Each request is
 * all or nothing, and games are written in the order sent.
 */
export const importBatchSchema = z.object({
  sourceName: z.string().trim().min(1, 'Name the import').max(SOURCE_NAME_MAX),
  games: importGamesArraySchema,
});
export type ImportBatchInput = z.infer<typeof importBatchSchema>;
export type ImportBatchDraft = z.input<typeof importBatchSchema>;

/** Body of `POST /api/imports/:id/games`: the next chunk of games for a batch you created. */
export const importChunkSchema = z.object({ games: importGamesArraySchema });
export type ImportChunkInput = z.infer<typeof importChunkSchema>;
export type ImportChunkDraft = z.input<typeof importChunkSchema>;

export const importBatchSummarySchema = z.object({
  id: z.number().int(),
  sourceName: z.string(),
  createdAt: z.string(),
  /** Games still in the batch (some may have been deleted one by one). */
  games: z.number().int(),
});
export type ImportBatchSummary = z.infer<typeof importBatchSummarySchema>;

/** Response of `POST /api/imports` and `POST /api/imports/:id/games`: the batch so far, and the players this request added. */
export const createdImportSchema = importBatchSummarySchema.extend({
  newPlayers: z.number().int(),
});
export type CreatedImport = z.infer<typeof createdImportSchema>;

// ---------------------------------------------------------------------------------------------
// Faction aliases
// ---------------------------------------------------------------------------------------------

export const factionAliasSchema = z.object({ alias: z.string(), factionId: z.number().int() });
export type FactionAlias = z.infer<typeof factionAliasSchema>;

/** Body of `POST /api/factions/aliases` (admin). The alias is stored normalized. */
export const createFactionAliasSchema = z.object({
  alias: z.string().trim().min(1, 'Enter an alias').max(100),
  factionId: id('Pick a faction'),
});
export type CreateFactionAlias = z.infer<typeof createFactionAliasSchema>;
