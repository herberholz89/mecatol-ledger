-- One row per seat with its game's derived values attached. Stats queries filter this view
-- (player count, date range, who logged the game) and then group it by faction or player, so the
-- filters apply before aggregating. That's why there are no pre-aggregated faction_stats or
-- player_stats views: a view that already grouped everything couldn't be filtered.
-- Hand-written: drizzle-kit doesn't manage this view. Change it with CREATE OR REPLACE VIEW,
-- adding columns only at the end, so older app code keeps working.
CREATE VIEW "seat_results" AS
SELECT
	gp.game_id,
	gp.player_id,
	gp.faction_id,
	gp.points,
	gp.is_winner,
	gs.player_count,
	gs.played_on,
	gs.created_by
FROM game_players gp
JOIN game_summary gs USING (game_id);
