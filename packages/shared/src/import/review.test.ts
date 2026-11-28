import { describe, expect, it } from 'vitest';
import { FACTION_ALIAS_SEED, FACTION_SEED } from '../factions.js';
import { parseTab, type Cell } from './parse.js';
import {
  defaultPlayerMapping,
  distinctFactionNames,
  distinctPlayerNames,
  draftFromParsed,
  factionResolver,
  mappingToRef,
  reviewGame,
  type DraftGame,
  type PlayerMapping,
  type ReviewContext,
} from './review.js';

const factions = FACTION_SEED.map((f, i) => ({ id: i + 1, name: f.name }));
const fid = (name: string) => factions.find((f) => f.name === name)?.id ?? -1;
const aliases = Object.entries(FACTION_ALIAS_SEED).map(([alias, name]) => ({ alias, factionId: fid(name) }));
const roster = [{ id: 7, name: 'ben' }];

function context(mappings: Record<string, PlayerMapping> = {}, picks: Record<string, number> = {}): ReviewContext {
  return {
    defaultYear: 2026,
    player: (name) => mappingToRef(mappings[name] ?? defaultPlayerMapping(name, roster)),
    faction: factionResolver(factions, aliases, picks),
  };
}

function draft(rows: Cell[][], over: Partial<DraftGame> = {}): DraftGame {
  const [game] = parseTab({ name: 'T', rows });
  if (!game) throw new Error('no game');
  return { ...draftFromParsed(game), ...over };
}

const twoPlayer: Cell[][] = [
  ['The Argent Flight', 'Ana ', 8, 2, 'Ben', 'Ral Nel Consortium', null, { date: { year: null, month: 5, day: 21 } }],
  ['Ral Nel Consortium', 'Ben', 10],
];

describe('reviewGame', () => {
  it('builds an importable game from a clean block', () => {
    const r = reviewGame(draft(twoPlayer), context());
    expect(r.status).toBe('ok');
    expect(r.issues).toEqual([]);
    expect(r.game).toEqual({
      playedOn: '2026-05-21',
      vpTarget: 10,
      endedEarly: false,
      notes: null,
      seats: [
        { player: { name: 'Ana' }, factionId: fid('Argent Flight'), points: 8 },
        { player: { id: 7 }, factionId: fid('Ral Nel Consortium'), points: 10 },
      ],
      winner: 1,
    });
    expect(r.spread).toBe(2);
  });

  it('infers a 14-point target and keeps 11-point wins at 10', () => {
    const fourteen = draft([['Sardakk N\'orr', 'Ana', 14], ['The Naalu Collective', 'Ben', 8]]);
    expect(reviewGame(fourteen, context()).vpTarget).toBe(14);
    const eleven = draft([['Sardakk N\'orr', 'Ana', 11], ['The Naalu Collective', 'Ben', 8]]);
    expect(reviewGame(eleven, context()).vpTarget).toBe(10);
    expect(reviewGame({ ...eleven, vpTarget: 12 }, context()).game?.vpTarget).toBe(12);
  });

  it('notes a missing date without changing the status', () => {
    const r = reviewGame(draft(twoPlayer, { date: null }), context());
    expect(r.status).toBe('ok');
    expect(r.issues).toEqual([{ level: 'info', message: 'No date' }]);
  });

  it('warns about a wrong sheet winner, a wrong spread and inline notes', () => {
    const rows: Cell[][] = [
      ['The Federation of Sol', 'Ana', 8, 3, 'Ana', 'The Federation of Sol'],
      ['The Necro Virus', 'Ben', 11],
      ['saar', 'cleo', 10],
      [null, 'merge with the next game'],
    ];
    const r = reviewGame(draft(rows), context());
    expect(r.status).toBe('warning');
    expect(r.issues.map((i) => i.message)).toEqual([
      'The sheet says Ana won, but Ben has the most points',
      'The sheet says The Federation of Sol won, but The Necro Virus has the most points',
      "The sheet's point spread is 3; 1st − 2nd is 1",
      'No date',
      'Note in the sheet: "merge with the next game"',
    ]);
    expect(r.game?.seats.map((s) => s.factionId)).toEqual([fid('Federation of Sol'), fid('Nekro Virus'), fid('Clan of Saar')]);
  });

  it('blocks missing players, factions and scores', () => {
    const rows: Cell[][] = [
      ['The Barony of Letnev', 'Ben', 7],
      ["the vuil'rairh cabal", null, 4],
      ['Space Pirates', 'Ana', null],
    ];
    const r = reviewGame(draft(rows), context());
    expect(r.status).toBe('blocked');
    expect(r.game).toBeNull();
    expect(r.issues.filter((i) => i.level === 'blocked').map((i) => i.message)).toEqual([
      'Row 2: no player',
      'Row 3: unknown faction "Space Pirates"',
      'Row 3: no score',
    ]);
  });

  it('unblocks once fixed: player names, faction picks', () => {
    const rows: Cell[][] = [
      ['The Barony of Letnev', 'Ben', 7],
      ['Space Pirates', null, 4],
    ];
    const d = draft(rows);
    d.seats[1] = { row: 2, player: 'cleo', faction: 'Space Pirates', points: 4 };
    const r = reviewGame(d, context({}, { 'Space Pirates': fid('Winnu') }));
    expect(r.status).toBe('ok');
    expect(r.game?.seats[1]).toEqual({ player: { name: 'cleo' }, factionId: fid('Winnu'), points: 4 });
  });

  it('blocks two names mapped to the same player, and the same faction twice', () => {
    const rows: Cell[][] = [
      ['The Arborec', 'codey', 10],
      ['Arborec', 'cody', 4],
    ];
    const same: PlayerMapping = { kind: 'new', name: 'Cody' };
    const r = reviewGame(draft(rows), context({ codey: same, cody: same }));
    expect(r.issues.filter((i) => i.level === 'blocked').map((i) => i.message)).toEqual([
      'Row 2: same player as Row 1',
      'Row 2: same faction as Row 1',
    ]);
  });

  it('blocks a tie for the most points unless the game ended early with a picked winner', () => {
    const rows: Cell[][] = [
      ['The Arborec', 'Ana', 8],
      ['The Winnu', 'Ben', 8],
    ];
    expect(reviewGame(draft(rows), context()).issues[0]?.message).toMatch(/^Tie for the most points: fix the scores/);
    expect(reviewGame(draft(rows, { endedEarly: true }), context()).issues[0]?.message).toBe('Tie for the most points: pick the winner');
    const r = reviewGame(draft(rows, { endedEarly: true, winner: 1 }), context());
    expect(r.game).toMatchObject({ endedEarly: true, winner: 1 });
    expect(r.spread).toBe(0);
  });

  it('blocks games with fewer than 2 seats, and skips skipped games', () => {
    expect(reviewGame(draft([['The Arborec', 'Ana', 8]]), context()).issues[0]?.message).toBe('Fewer than 2 players');
    expect(reviewGame(draft(twoPlayer, { skip: true }), context()).status).toBe('skipped');
  });

  it('blocks invalid new player names and impossible dates', () => {
    const r = reviewGame(draft(twoPlayer, { date: { year: 2026, month: 2, day: 30 } }), context({ Ana: { kind: 'new', name: '' } }));
    expect(r.issues.filter((i) => i.level === 'blocked').map((i) => i.message)).toEqual([
      'Row 1: "" isn\'t a valid player name',
      "2/30/2026 isn't a real date",
    ]);
  });
});

describe('name lists', () => {
  it('lists distinct trimmed player and faction names', () => {
    const games = [draft(twoPlayer), draft([['Ral Nel Consortium', 'Ben ', 10], ['The Winnu', 'cleo', 3]])];
    expect(distinctPlayerNames(games)).toEqual(['Ana', 'Ben', 'cleo']);
    expect(distinctFactionNames(games)).toEqual(['The Argent Flight', 'Ral Nel Consortium', 'The Winnu']);
  });

  it('maps names to roster players ignoring case', () => {
    expect(defaultPlayerMapping('Ben', roster)).toEqual({ kind: 'existing', id: 7 });
    expect(defaultPlayerMapping(' Ana ', roster)).toEqual({ kind: 'new', name: 'Ana' });
  });
});
