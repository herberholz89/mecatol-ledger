import { describe, expect, it } from 'vitest';
import {
  FACTION_ALIAS_SEED,
  FACTION_SEED,
  normalizeAlias,
  resolveFactionName,
} from './factions.js';

const names = FACTION_SEED.map((f) => f.name);

describe('faction seed', () => {
  it('has 30 unique factions split 17/7/1/5', () => {
    expect(new Set(names).size).toBe(30);
    const count = (e: string) => FACTION_SEED.filter((f) => f.expansion === e).length;
    expect([count('base'), count('pok'), count('codex'), count('thunders_edge')]).toEqual([17, 7, 1, 5]);
  });

  it('treats Firmament / Obsidian as one faction', () => {
    expect(names).toContain('Firmament / Obsidian');
    expect(names.some((n) => n === 'Firmament' || n === 'Obsidian')).toBe(false);
  });

  it('only aliases to real factions, with normalized keys', () => {
    for (const [alias, target] of Object.entries(FACTION_ALIAS_SEED)) {
      expect(names).toContain(target);
      expect(normalizeAlias(alias)).toBe(alias);
    }
  });
});

describe('resolveFactionName', () => {
  const resolve = (raw: string) => resolveFactionName(raw, names, FACTION_ALIAS_SEED);

  it('matches ignoring case, whitespace and a leading "The"', () => {
    expect(resolve('  the   EMBERS of muaat ')).toBe('Embers of Muaat');
    expect(resolve('Nekro Virus')).toBe('Nekro Virus');
  });

  it('uses aliases for known typos', () => {
    expect(resolve('Necro Virus')).toBe('Nekro Virus');
    expect(resolve('The Yssaril Triobes')).toBe('Yssaril Tribes');
    expect(resolve("The Vuil'rairh Cabal")).toBe("Vuil'raith Cabal");
    expect(resolve('Saar')).toBe('Clan of Saar');
  });

  it('returns null for unknown names', () => {
    expect(resolve('Space Pirates')).toBeNull();
  });
});
