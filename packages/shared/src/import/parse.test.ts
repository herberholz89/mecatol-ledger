import { describe, expect, it } from 'vitest';
import { isLikelyGamesTab, parseDateText, parseTab, toIsoDate, type Cell } from './parse.js';

const d = (month: number, day: number, year: number | null = 2026): Cell => ({ date: { year, month, day } });

// A copy of the original sheet's quirks with made-up names: header row, padded names, dates on
// either row, a note in H, formula placeholders, a missing score, and a hand-merged 4-player game.
const rows: Cell[][] = [
  ['Race', 'Player', 'Score', 'Point Spread', 'Who won', 'what race won', 'who lost', 'Date'],
  [],
  ['The Argent Flight', 'Ana ', 8, 2, 'Ben', 'Ral Nel Consortium', 'The Argent Flight'],
  ['Ral Nel Consortium', 'Ben', 10, null, null, null, null, d(5, 21)],
  [],
  ['The Mahact Gene-Sorcerers', 'Ana ', 4, 5, 'Ben', 'The Empyrean', 'x', 'Total Annihilation'],
  ['The Empyrean', 'Ben', 9, null, null, null, null, '6/15'],
  [],
  ['The Embers of Muaat', 'Ben', 10, 10, 'Ben'],
  ['The Yssaril Triobes', 'Ana '],
  [],
  [null, null, null, 0],
  [],
  ['The Barony of Letnev', 'Ben', 7, 3, 'Ben', 'The Barony of Letnev'],
  ["the vuil'rairh cabal", null, 4],
  [null, 'merge above and below for 1 game', null, 'cleo'],
  ["Sardakk N'orr", 'Ana ', 5, 5, null, 'The Universities of Jol-Nar'],
  ['The Universities of Jol-Nar', null, '10'],
  [null, 'dan', null, null, null, null, null, null, 'ignored column I'],
];

describe('parseTab', () => {
  const games = parseTab({ name: 'Games', rows });

  it('splits blocks on blank rows and skips the header and placeholders', () => {
    expect(games.map((g) => [g.key, g.firstRow, g.lastRow, g.seats.length])).toEqual([
      ['Games!3', 3, 4, 2],
      ['Games!6', 6, 7, 2],
      ['Games!9', 9, 10, 2],
      ['Games!14', 14, 19, 4],
    ]);
  });

  it('reads seats with trimmed names, and the sheet columns from the first row', () => {
    expect(games[0]).toMatchObject({
      seats: [
        { row: 3, faction: 'The Argent Flight', player: 'Ana', points: 8 },
        { row: 4, faction: 'Ral Nel Consortium', player: 'Ben', points: 10 },
      ],
      date: { year: 2026, month: 5, day: 21 },
      notes: [],
      sheet: { spread: 2, winner: 'Ben', winningFaction: 'Ral Nel Consortium' },
    });
  });

  it('takes notes and text dates from column H on any row', () => {
    expect(games[1]).toMatchObject({ notes: ['Total Annihilation'], date: { year: null, month: 6, day: 15 } });
  });

  it('keeps a missing score as null', () => {
    expect(games[2]?.seats[1]).toEqual({ row: 10, faction: 'The Yssaril Triobes', player: 'Ana', points: null });
  });

  it('keeps hand-written notes in a block as annotations, and reads numeric text', () => {
    const merged = games[3];
    expect(merged?.seats.map((s) => [s.player, s.points])).toEqual([
      ['Ben', 7],
      ['', 4],
      ['Ana', 5],
      ['', 10],
    ]);
    expect(merged?.annotations).toEqual(['merge above and below for 1 game · cleo', 'dan']);
  });

  it('recognizes games tabs', () => {
    expect(isLikelyGamesTab({ name: 'Games', rows })).toBe(true);
    expect(isLikelyGamesTab({ name: 'win table', rows })).toBe(false);
    expect(isLikelyGamesTab({ name: 'Notes', rows: [['hello']] })).toBe(false);
  });
});

describe('dates', () => {
  it('parses US-style and ISO text', () => {
    expect(parseDateText('5/21')).toEqual({ year: null, month: 5, day: 21 });
    expect(parseDateText('5/21/25')).toEqual({ year: 2025, month: 5, day: 21 });
    expect(parseDateText('2026-05-21')).toEqual({ year: 2026, month: 5, day: 21 });
    expect(parseDateText('2/29')).toEqual({ year: null, month: 2, day: 29 });
    expect(parseDateText('13/1')).toBeNull();
    expect(parseDateText('Total Annihilation')).toBeNull();
  });

  it('fills in the default year', () => {
    expect(toIsoDate({ year: null, month: 5, day: 1 }, 2026)).toBe('2026-05-01');
    expect(toIsoDate({ year: 2025, month: 12, day: 31 }, 2026)).toBe('2025-12-31');
    expect(toIsoDate({ year: null, month: 2, day: 29 }, 2026)).toBeNull();
  });
});
