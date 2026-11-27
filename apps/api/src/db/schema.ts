import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

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
