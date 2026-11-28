import type { Faction } from '@mecatol/shared';
import { rows, type Queryable } from './sql.js';

export async function listFactions(db: Queryable): Promise<Faction[]> {
  return rows<Faction>(db, 'select id, name, expansion, archived from factions order by name');
}
