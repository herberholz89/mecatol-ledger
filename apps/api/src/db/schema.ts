import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
