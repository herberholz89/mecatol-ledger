import { normalizeAlias, type Faction, type FactionAlias } from '@mecatol/shared';
import { HttpError } from '../http-error.js';
import { rows, type Queryable } from './sql.js';

export async function listFactions(db: Queryable): Promise<Faction[]> {
  return rows<Faction>(db, 'select id, name, expansion, archived from factions order by name');
}

export async function listFactionAliases(db: Queryable): Promise<FactionAlias[]> {
  return rows<FactionAlias>(db, 'select alias, faction_id as "factionId" from faction_aliases order by alias');
}

/** Admin only (checked by the route). Stores the alias normalized; 409 if it's already taken. */
export async function createFactionAlias(db: Queryable, alias: string, factionId: number): Promise<FactionAlias> {
  const normalized = normalizeAlias(alias);
  const [row] = await rows<{ faction_exists: boolean; alias: string | null; factionId: number | null }>(
    db,
    `with f as (select id from factions where id = $2),
          ins as (insert into faction_aliases (alias, faction_id) select $1, id from f
                  on conflict (alias) do nothing returning alias, faction_id)
     select (select count(*) from f) > 0 as faction_exists, ins.alias, ins.faction_id as "factionId"
     from (select 1) one left join ins on true`,
    [normalized, factionId],
  );
  if (!row?.faction_exists) {
    throw new HttpError(400, 'Unknown faction', { issues: [{ code: 'custom', path: ['factionId'], message: 'Unknown faction' }] });
  }
  if (row.alias === null || row.factionId === null) throw new HttpError(409, `"${normalized}" is already an alias`);
  return { alias: row.alias, factionId: row.factionId };
}
