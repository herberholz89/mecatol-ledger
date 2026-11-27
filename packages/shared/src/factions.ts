export const EXPANSIONS = ['base', 'pok', 'codex', 'thunders_edge'] as const;
export type Expansion = (typeof EXPANSIONS)[number];

export interface FactionSeed {
  name: string;
  expansion: Expansion;
}

/** The 30 v1 factions, named as in the spreadsheet's Races tab. */
export const FACTION_SEED: readonly FactionSeed[] = [
  // Base game (17)
  { name: 'Arborec', expansion: 'base' },
  { name: 'Barony of Letnev', expansion: 'base' },
  { name: 'Clan of Saar', expansion: 'base' },
  { name: 'Embers of Muaat', expansion: 'base' },
  { name: 'Emirates of Hacan', expansion: 'base' },
  { name: 'Federation of Sol', expansion: 'base' },
  { name: 'Ghosts of Creuss', expansion: 'base' },
  { name: 'L1Z1X Mindnet', expansion: 'base' },
  { name: 'Mentak Coalition', expansion: 'base' },
  { name: 'Naalu Collective', expansion: 'base' },
  { name: 'Nekro Virus', expansion: 'base' },
  { name: "Sardakk N'orr", expansion: 'base' },
  { name: 'Universities of Jol-Nar', expansion: 'base' },
  { name: 'Winnu', expansion: 'base' },
  { name: 'Xxcha Kingdom', expansion: 'base' },
  { name: 'Yin Brotherhood', expansion: 'base' },
  { name: 'Yssaril Tribes', expansion: 'base' },
  // Prophecy of Kings (7)
  { name: 'Argent Flight', expansion: 'pok' },
  { name: 'Empyrean', expansion: 'pok' },
  { name: 'Mahact Gene-Sorcerers', expansion: 'pok' },
  { name: 'Naaz-Rokha Alliance', expansion: 'pok' },
  { name: 'Nomad', expansion: 'pok' },
  { name: 'Titans of Ul', expansion: 'pok' },
  { name: "Vuil'raith Cabal", expansion: 'pok' },
  // Codex (1)
  { name: 'Council Keleres', expansion: 'codex' },
  // Thunder's Edge (5)
  { name: 'Crimson Rebellion', expansion: 'thunders_edge' },
  { name: 'Deepwrought Scholarate', expansion: 'thunders_edge' },
  { name: 'Firmament / Obsidian', expansion: 'thunders_edge' },
  { name: 'Last Bastion', expansion: 'thunders_edge' },
  { name: 'Ral Nel Consortium', expansion: 'thunders_edge' },
];

/** Misspellings found in the spreadsheet. Keys are already normalized. */
export const FACTION_ALIAS_SEED: Readonly<Record<string, string>> = {
  'necro virus': 'Nekro Virus',
  'the yssaril triobes': 'Yssaril Tribes',
  'the titan of ul': 'Titans of Ul',
  "the vuil'rairh cabal": "Vuil'raith Cabal",
  saar: 'Clan of Saar',
};

/** Lowercase, trim, and collapse internal whitespace. This is how aliases are stored. */
export function normalizeAlias(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Alias normalization plus dropping a leading "the", for loose name matching. */
export function normalizeFactionName(raw: string): string {
  return normalizeAlias(raw).replace(/^the /, '');
}

/**
 * Resolve a free-text faction name to a canonical faction name.
 * Checks exact aliases first, then names ignoring case, whitespace and a leading "The".
 */
export function resolveFactionName(
  raw: string,
  factionNames: readonly string[],
  aliases: Readonly<Record<string, string>>,
): string | null {
  const alias = aliases[normalizeAlias(raw)] ?? aliases[normalizeFactionName(raw)];
  if (alias !== undefined) return alias;
  const wanted = normalizeFactionName(raw);
  return factionNames.find((name) => normalizeFactionName(name) === wanted) ?? null;
}
