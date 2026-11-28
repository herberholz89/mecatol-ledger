import { normalizeAlias, type Expansion, type Faction, type FactionAlias } from '@mecatol/shared';
import { HttpError } from '../http-error.js';
import { isUniqueViolation, rows, type Queryable } from './sql.js';

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

const FACTION_COLUMNS = 'id, name, expansion, archived';

const duplicateFaction = (name: string) =>
  new HttpError(409, `There's already a faction called ${name}`, {
    issues: [{ code: 'custom', path: ['name'], message: 'That name is taken' }],
  });

/** Admin only (checked by the route). 409 if the name is taken, ignoring case. */
export async function createFaction(db: Queryable, name: string, expansion: Expansion): Promise<Faction> {
  const [row] = await rows<Faction>(
    db,
    `insert into factions (name, expansion) select $1, $2
     where not exists (select 1 from factions where lower(name) = lower($1))
     on conflict (name) do nothing
     returning ${FACTION_COLUMNS}`,
    [name, expansion],
  );
  if (!row) throw duplicateFaction(name);
  return row;
}

/** Admin only. Rename, change expansion, archive or unarchive. 404 if missing, 409 if the new name is taken. */
export async function updateFaction(
  db: Queryable,
  id: number,
  change: { name?: string | undefined; expansion?: Expansion | undefined; archived?: boolean | undefined },
): Promise<Faction> {
  // The same name saved at the same moment trips the unique constraint instead.
  const [row] = await rows<{ found: boolean; taken: boolean; faction: Faction | null }>(
    db,
    `with taken as (
       select exists (select 1 from factions where $2::text is not null and lower(name) = lower($2) and id <> $1) as taken
     ),
     upd as (
       update factions set name = coalesce($2, name), expansion = coalesce($3, expansion), archived = coalesce($4, archived)
       where id = $1 and not (select taken from taken)
       returning ${FACTION_COLUMNS}
     )
     select exists (select 1 from factions where id = $1) as found, (select taken from taken) as taken,
            (select row_to_json(upd) from upd) as faction`,
    [id, change.name ?? null, change.expansion ?? null, change.archived ?? null],
  ).catch((err: unknown) => {
    if (isUniqueViolation(err)) throw duplicateFaction(change.name ?? 'that name');
    throw err;
  });
  if (!row?.found) throw new HttpError(404, 'Faction not found');
  if (row.taken || !row.faction) throw duplicateFaction(change.name ?? 'that name');
  return row.faction;
}

/** Admin only. Takes the alias as typed and removes its normalized form. 404 if there's no such alias. */
export async function deleteFactionAlias(db: Queryable, alias: string): Promise<void> {
  const deleted = await rows<{ alias: string }>(db, 'delete from faction_aliases where alias = $1 returning alias', [
    normalizeAlias(alias),
  ]);
  if (deleted.length === 0) throw new HttpError(404, 'Alias not found');
}
