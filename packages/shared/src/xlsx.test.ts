/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { utils, write } from 'xlsx';
import { FACTION_ALIAS_SEED, FACTION_SEED } from './factions.js';
import { draftFromParsed, factionResolver, reviewGame, type ReviewContext } from './import/review.js';
import { isLikelyGamesTab, parseTab } from './import/parse.js';
import { readSpreadsheet } from './xlsx.js';

const toArrayBuffer = (buf: Uint8Array): ArrayBuffer => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

describe('readSpreadsheet', () => {
  it('reads .xlsx tabs, keeping date-formatted cells as dates', () => {
    const ws = utils.aoa_to_sheet([
      ['Race', 'Player', 'Score'],
      [],
      ['The Arborec', 'Ana ', 8, 2],
      ['The Winnu', 'Ben', 10, null, null, null, null, 46163],
    ]);
    const h4 = ws.H4;
    if (h4) h4.z = 'm/d'; // a date shown without a year, as in the original sheet
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'Games');
    utils.book_append_sheet(wb, utils.aoa_to_sheet([['x']]), 'Notes');
    const tabs = readSpreadsheet(toArrayBuffer(write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array), 'ti.xlsx');

    expect(tabs.map((t) => t.name)).toEqual(['Games', 'Notes']);
    expect(tabs[0]?.rows[2]).toEqual(['The Arborec', 'Ana ', 8, 2, null, null, null, null]);
    expect(tabs[0]?.rows[3]?.[7]).toEqual({ date: { year: 2026, month: 5, day: 21 } });
  });

  it('reads a .csv as one tab named after the file, keeping text as text', () => {
    const csv = 'The Arborec,Ana,8,2,Ben,,,5/21\nThe Winnu,Ben,10\n';
    const tabs = readSpreadsheet(toArrayBuffer(new Uint8Array(Buffer.from(csv))), 'old data.csv');
    expect(tabs.map((t) => t.name)).toEqual(['old data']);
    const [game] = parseTab(tabs[0] ?? { name: '', rows: [] });
    expect(game?.seats.map((s) => s.points)).toEqual([8, 10]);
    expect(game?.date).toEqual({ year: null, month: 5, day: 21 });
  });
});

// A copy of the group's real "Twilight Imperium data" sheet with the player names replaced
// (user, user2, user3 / "user 3" for one person's two spellings, user4). Set TI_SHEET to run the
// same checks against a fresh download of the real sheet: TI_SHEET=~/Desktop/ti.xlsx pnpm test
const sheetPath = process.env.TI_SHEET ?? fileURLToPath(new URL('../test-fixtures/ti-sample.xlsx', import.meta.url));

describe('the real spreadsheet', () => {
  const tabs = readSpreadsheet(toArrayBuffer(readFileSync(sheetPath)), 'sheet.xlsx');
  const tab = (name: string) => tabs.find((t) => t.name === name) ?? { name, rows: [] };
  const factions = FACTION_SEED.map((f, i) => ({ id: i + 1, name: f.name }));
  const aliases = Object.entries(FACTION_ALIAS_SEED).map(([alias, name]) => ({
    alias,
    factionId: factions.find((f) => f.name === name)?.id ?? -1,
  }));
  const ctx: ReviewContext = { defaultYear: 2026, player: (name) => ({ name }), faction: factionResolver(factions, aliases) };

  it('offers the Games, multiplayer and old data tabs', () => {
    expect(tabs.filter(isLikelyGamesTab).map((t) => t.name).sort()).toEqual(['Games', 'multiplayer', 'old data']);
  });

  it('finds every game', () => {
    expect([parseTab(tab('Games')).length, parseTab(tab('multiplayer')).length, parseTab(tab('old data')).length]).toEqual([40, 3, 35]);
  });

  it('resolves every faction name through the seeded aliases', () => {
    for (const name of ['Games', 'multiplayer', 'old data']) {
      for (const g of parseTab(tab(name))) for (const s of g.seats) expect(ctx.faction(s.faction), s.faction).not.toBeNull();
    }
  });

  it('blocks only the hand-merged game and the game with a missing score', () => {
    const reviewed = ['Games', 'multiplayer', 'old data'].flatMap((name) =>
      parseTab(tab(name)).map((g) => ({ key: g.key, review: reviewGame(draftFromParsed(g), ctx) })),
    );
    expect(reviewed.filter((r) => r.review.status === 'blocked').map((r) => r.key)).toEqual(['multiplayer!12', 'old data!61']);
    const games = reviewed.flatMap((r) => (r.review.game ? [r.review.game] : []));
    expect(games).toHaveLength(76);
    expect(games.filter((g) => g.playedOn).length).toBeGreaterThan(5);
    expect(games.filter((g) => g.vpTarget === 14)).toHaveLength(2);
  });

  it('flags the multiplayer spread the sheet got wrong', () => {
    const [first] = parseTab(tab('multiplayer'));
    const r = first && reviewGame(draftFromParsed(first), ctx);
    expect(r?.issues.map((i) => i.message)).toContain("The sheet's point spread is 3; 1st − 2nd is 1");
  });
});

describe.skipIf(!!process.env.TI_SHEET)('the committed test sheet', () => {
  it('has no real player names', () => {
    const tabs = readSpreadsheet(toArrayBuffer(readFileSync(sheetPath)), 'sheet.xlsx');
    const players = new Set(['Games', 'multiplayer', 'old data'].flatMap((name) =>
      parseTab(tabs.find((t) => t.name === name) ?? { name, rows: [] }).flatMap((g) => g.seats.map((s) => s.player)),
    ));
    expect([...players].sort()).toEqual(['', 'user', 'user2', 'user3']);
  });
});
