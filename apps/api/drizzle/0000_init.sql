CREATE TABLE "faction_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"faction_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"expansion" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "factions_name_unique" UNIQUE("name"),
	CONSTRAINT "factions_expansion_check" CHECK ("factions"."expansion" in ('base', 'pok', 'codex', 'thunders_edge'))
);
--> statement-breakpoint
ALTER TABLE "faction_aliases" ADD CONSTRAINT "faction_aliases_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;