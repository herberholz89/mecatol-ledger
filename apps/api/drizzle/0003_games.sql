CREATE TABLE "game_players" (
	"game_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"faction_id" integer NOT NULL,
	"points" smallint NOT NULL,
	"is_winner" boolean DEFAULT false NOT NULL,
	CONSTRAINT "game_players_game_id_player_id_pk" PRIMARY KEY("game_id","player_id"),
	CONSTRAINT "game_players_game_faction_unique" UNIQUE("game_id","faction_id"),
	CONSTRAINT "game_players_points_check" CHECK ("game_players"."points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"played_on" date,
	"vp_target" smallint DEFAULT 10 NOT NULL,
	"ended_early" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_vp_target_check" CHECK ("games"."vp_target" between 1 and 20),
	CONSTRAINT "games_notes_check" CHECK (char_length("games"."notes") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"user_id" uuid,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_name_check" CHECK ("players"."name" = btrim("players"."name") and char_length("players"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_winner_per_game" ON "game_players" USING btree ("game_id") WHERE "game_players"."is_winner";--> statement-breakpoint
CREATE INDEX "game_players_player_idx" ON "game_players" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "game_players_faction_idx" ON "game_players" USING btree ("faction_id");--> statement-breakpoint
CREATE INDEX "games_played_on_idx" ON "games" USING btree ("played_on" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "games_created_by_idx" ON "games" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "players_roster_name_unique" ON "players" USING btree ("created_by",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "one_player_per_user" ON "players" USING btree ("user_id") WHERE "players"."user_id" is not null;--> statement-breakpoint
-- Derived per-game values, never stored. Point spread = winner points - second-highest points:
-- the winner has the top score, so the best non-winner is second (0 on an ended-early tie).
-- Hand-written: drizzle-kit doesn't manage this view. Change it with CREATE OR REPLACE VIEW,
-- adding columns only at the end, so older app code keeps working.
CREATE VIEW "game_summary" AS
SELECT
	g.id AS game_id,
	g.played_on,
	g.vp_target,
	g.ended_early,
	g.created_by,
	g.created_at,
	count(*)::int AS player_count,
	(max(gp.points) FILTER (WHERE gp.is_winner)
		- coalesce(max(gp.points) FILTER (WHERE NOT gp.is_winner), 0))::int AS point_spread,
	max(gp.player_id) FILTER (WHERE gp.is_winner) AS winner_player_id,
	max(gp.faction_id) FILTER (WHERE gp.is_winner) AS winner_faction_id,
	max(gp.points) FILTER (WHERE gp.is_winner)::int AS winner_points
FROM games g
JOIN game_players gp ON gp.game_id = g.id
GROUP BY g.id;
