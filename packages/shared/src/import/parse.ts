// Parses the "Twilight Imperium data" spreadsheet layout into games. Pure functions over a grid of
// cells, so it runs the same in the browser and in tests; reading .xlsx/.csv files into grids is in
// ../xlsx.ts. Layout (docs/PLAN.md, "Spreadsheet import"):
//
// - Each game is a block of consecutive rows; blank rows separate games.
// - One row per seat: A faction, B player, C score.
// - The block's first row also has D point spread, E winner, F winning faction, G losing faction
//   (all formulas in the sheet; only kept to cross-check).
// - H holds a date or a note, on any row of the block.
// - Columns I onward are ignored. Blocks with no text (formula placeholders like a lone 0) are skipped.

/** A date with its year when the sheet had one. */
export interface SheetDate {
  year: number | null;
  month: number;
  day: number;
}

/**
 * One spreadsheet cell. `date` cells come from date-formatted .xlsx cells; text that looks like a
 * date ("5/21") is recognized by the parser.
 */
export type Cell = string | number | boolean | { date: SheetDate } | null;

export interface SheetTab {
  name: string;
  /** Rows top to bottom; row index 0 is spreadsheet row 1. */
  rows: Cell[][];
}

export interface ParsedSeat {
  /** 1-based spreadsheet row. */
  row: number;
  faction: string;
  player: string;
  /** null when the score cell is empty or not a number. */
  points: number | null;
}

export interface ParsedGame {
  /** Unique within a workbook: `<tab>!<firstRow>`. */
  key: string;
  tab: string;
  firstRow: number;
  lastRow: number;
  seats: ParsedSeat[];
  date: SheetDate | null;
  /** Column H text that isn't a date, e.g. "Total Annihilation". */
  notes: string[];
  /** Text on rows that aren't seats, e.g. "merge above and below for 1 game". */
  annotations: string[];
  /** What the sheet's own formula columns say, for cross-checking. */
  sheet: { spread: number | null; winner: string | null; winningFaction: string | null };
}

const COLS = 8; // A–H
const [A, B, C, D, E, F, , H] = [0, 1, 2, 3, 4, 5, 6, 7] as const;

function isDateCell(cell: Cell): cell is { date: SheetDate } {
  return typeof cell === 'object' && cell !== null;
}

/** Trimmed text of a cell; numbers and booleans as written. Empty string for blank cells. */
function text(cell: Cell | undefined): string {
  if (cell === null || cell === undefined || isDateCell(cell)) return '';
  return String(cell).trim();
}

/** A number cell, or text that is a plain number ("8", "8.0"). */
function num(cell: Cell | undefined): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  const t = text(cell);
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** "5/21", "5/21/26", "5/21/2026" (US order, as in the sheet) or "2026-05-21". */
export function parseDateText(raw: string): SheetDate | null {
  const t = raw.trim();
  let year: number | null;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const us = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (us) {
    [month, day] = [Number(us[1]), Number(us[2])];
    year = us[3] === undefined ? null : Number(us[3]) + (us[3].length === 2 ? 2000 : 0);
  } else {
    return null;
  }
  // Check the month and day in a leap year so 2/29 without a year is accepted.
  if (!isCalendarDate(year ?? 2024, month, day)) return null;
  return { year, month, day };
}

/** `YYYY-MM-DD`, using `defaultYear` when the sheet gave no year. null if that date doesn't exist. */
export function toIsoDate(date: SheetDate, defaultYear: number): string | null {
  const year = date.year ?? defaultYear;
  if (!isCalendarDate(year, date.month, date.day)) return null;
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

function isBlankRow(row: readonly Cell[]): boolean {
  for (let i = 0; i < COLS; i++) {
    const cell = row[i];
    if (isDateCell(cell ?? null) || text(cell) !== '') return false;
  }
  return true;
}

function isHeaderRow(row: readonly Cell[]): boolean {
  return text(row[A]).toLowerCase() === 'race' && text(row[B]).toLowerCase() === 'player';
}

/** A seat row has a faction or a score. Anything else in a block is an annotation (or ignored). */
function isSeatRow(row: readonly Cell[]): boolean {
  return text(row[A]) !== '' || num(row[C]) !== null;
}

function parseBlock(tab: string, rows: readonly Cell[][], first: number, last: number): ParsedGame | null {
  const game: ParsedGame = {
    key: `${tab}!${first + 1}`,
    tab,
    firstRow: first + 1,
    lastRow: last + 1,
    seats: [],
    date: null,
    notes: [],
    annotations: [],
    sheet: { spread: null, winner: null, winningFaction: null },
  };
  const firstRow = rows[first] ?? [];
  game.sheet = {
    spread: num(firstRow[D]),
    winner: text(firstRow[E]) || null,
    winningFaction: text(firstRow[F]) || null,
  };

  for (let r = first; r <= last; r++) {
    const row = rows[r] ?? [];
    const h = row[H] ?? null;
    if (isDateCell(h)) {
      game.date ??= h.date;
    } else if (text(h)) {
      const date = parseDateText(text(h));
      if (date) game.date ??= date;
      else game.notes.push(text(h));
    }

    if (isSeatRow(row)) {
      game.seats.push({ row: r + 1, faction: text(row[A]), player: text(row[B]), points: num(row[C]) });
    } else {
      // Only text counts: number-only rows are leftover formulas (e.g. a spread of 0).
      const words = [B, C, D, E, F, 6].map((i) => row[i]).filter((c) => typeof c === 'string' && num(c) === null);
      const note = words.map((c) => text(c)).filter(Boolean).join(' · ');
      if (note) game.annotations.push(note);
    }
  }

  if (game.seats.length === 0 && game.annotations.length === 0 && game.notes.length === 0) return null;
  return game;
}

/** Splits a tab into games. Placeholder blocks without any text are dropped. */
export function parseTab(tab: SheetTab): ParsedGame[] {
  const games: ParsedGame[] = [];
  let start: number | null = null;
  const rows = tab.rows;
  for (let r = 0; r <= rows.length; r++) {
    const row = rows[r];
    const blank = row === undefined || isBlankRow(row) || isHeaderRow(row);
    if (!blank && start === null) start = r;
    if (blank && start !== null) {
      const game = parseBlock(tab.name, rows, start, r - 1);
      if (game) games.push(game);
      start = null;
    }
  }
  return games;
}

/** Tabs that hold derived or unrelated data in the original sheet. Not offered by default. */
const NOT_GAMES = new Set(['races', 'current totals', 'win table', 'questionair', 'questionnaire']);

/** Whether a tab should be ticked by default on the "pick tabs" step. */
export function isLikelyGamesTab(tab: SheetTab): boolean {
  return !NOT_GAMES.has(tab.name.trim().toLowerCase()) && parseTab(tab).some((g) => g.seats.length >= 2);
}
