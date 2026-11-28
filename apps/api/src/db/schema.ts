import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const factions = pgTable(
  'factions',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull().unique(),
    expansion: text('expansion', { enum: ['base', 'pok', 'codex', 'thunders_edge'] }).notNull(),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [check('factions_expansion_check', sql`${t.expansion} in ('base', 'pok', 'codex', 'thunders_edge')`)],
);

/** Alternate spellings, used by the importer and search. `alias` is stored lowercased and trimmed. */
export const factionAliases = pgTable('faction_aliases', {
  alias: text('alias').primaryKey(),
  factionId: integer('faction_id')
    .notNull()
    .references(() => factions.id),
});

/**
 * The app's own record of a signed-in user. Identity (email, sessions, codes) lives in Neon Auth's
 * managed `neon_auth` schema; `id` is the Neon Auth user id, but there is deliberately no foreign key
 * into `neon_auth`. Rows are upserted on a user's first authenticated request.
 */
export const appUsers = pgTable(
  'app_users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull().unique(),
    displayName: text('display_name'),
    role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('app_users_role_check', sql`${t.role} in ('user', 'admin')`)],
);

export type AppUser = typeof appUsers.$inferSelect;

/**
 * A name that appears in games. Each user has their own roster (`created_by`); the same name can
 * exist in different rosters. `user_id` is set when an account claims the player (milestone 6).
 */
export const players = pgTable(
  'players',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUsers.id),
    userId: uuid('user_id').references(() => appUsers.id),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "Eric" and "eric" can't both be in one roster.
    uniqueIndex('players_roster_name_unique').on(t.createdBy, sql`lower(${t.name})`),
    uniqueIndex('one_player_per_user').on(t.userId).where(sql`${t.userId} is not null`),
    check('players_name_check', sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 40`),
  ],
);

/** One spreadsheet import. Deleting a batch deletes its games (undo). */
export const importBatches = pgTable(
  'import_batches',
  {
    id: serial('id').primaryKey(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUsers.id),
    sourceName: text('source_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('import_batches_source_name_check', sql`char_length(${t.sourceName}) between 1 and 200`),
    index('import_batches_created_by_idx').on(t.createdBy),
  ],
);

export const games = pgTable(
  'games',
  {
    id: serial('id').primaryKey(),
    /** Nullable: much spreadsheet history has no date. */
    playedOn: date('played_on'),
    vpTarget: smallint('vp_target').notNull().default(10),
    endedEarly: boolean('ended_early').notNull().default(false),
    notes: text('notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUsers.id),
    /** Set for imported games; undoing the import deletes them. */
    importBatchId: integer('import_batch_id').references(() => importBatches.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('games_vp_target_check', sql`${t.vpTarget} between 1 and 20`),
    check('games_notes_check', sql`char_length(${t.notes}) <= 2000`),
    index('games_played_on_idx').on(t.playedOn.desc().nullsLast(), t.id.desc()),
    index('games_created_by_idx').on(t.createdBy),
    index('games_import_batch_idx').on(t.importBatchId),
  ],
);

/**
 * One row per seat. Seat-count (2–8) and winner-has-most-points rules are checked in the app,
 * inside the write transaction; the database guarantees at most one winner per game.
 */
export const gamePlayers = pgTable(
  'game_players',
  {
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    factionId: integer('faction_id')
      .notNull()
      .references(() => factions.id),
    points: smallint('points').notNull(),
    isWinner: boolean('is_winner').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.playerId] }),
    unique('game_players_game_faction_unique').on(t.gameId, t.factionId),
    uniqueIndex('one_winner_per_game').on(t.gameId).where(sql`${t.isWinner}`),
    check('game_players_points_check', sql`${t.points} >= 0`),
    index('game_players_player_idx').on(t.playerId),
    index('game_players_faction_idx').on(t.factionId),
  ],
);

// The `game_summary` view (player count, winner, point spread) is created in SQL in
// drizzle/0003_games.sql. Queries read it with plain SQL, so it isn't modeled here.
