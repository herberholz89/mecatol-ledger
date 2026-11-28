// Turns parsed spreadsheet games into importable games: applies the name mappings and defaults,
// then sorts each game into ok / warning / blocked (docs/PLAN.md, "Spreadsheet import", step 5).

import { MAX_SEATS, MIN_SEATS, NOTES_MAX, playerNameSchema, POINTS_MAX } from '../games.js';
import { resolveFactionName } from '../factions.js';
import { importGameSchema, playerRefKey, type ImportGame, type ImportPlayerRef } from '../imports.js';
import { toIsoDate, type ParsedGame, type SheetDate } from './parse.js';

/** Editable copy of a parsed game. The review step's inline fixes change these fields. */
export interface DraftGame {
  key: string;
  tab: string;
  firstRow: number;
  lastRow: number;
  seats: DraftSeat[];
  date: SheetDate | null;
  /** null = infer from the top score. */
  vpTarget: number | null;
  endedEarly: boolean;
  notes: string;
  /** Seat index picked as winner; only used on a tie for the most points (ended early). */
  winner: number | null;
  skip: boolean;
  annotations: string[];
  sheet: ParsedGame['sheet'];
}

export interface DraftSeat {
  /** 1-based spreadsheet row; null for a seat added during review. */
  row: number | null;
  player: string;
  faction: string;
  points: number | null;
}

export function draftFromParsed(game: ParsedGame): DraftGame {
  return {
    key: game.key,
    tab: game.tab,
    firstRow: game.firstRow,
    lastRow: game.lastRow,
    seats: game.seats.map((s) => ({ row: s.row, player: s.player, faction: s.faction, points: s.points })),
    date: game.date,
    vpTarget: null,
    endedEarly: false,
    notes: game.notes.join('; '),
    winner: null,
    skip: false,
    annotations: game.annotations,
    sheet: game.sheet,
  };
}

/** How the importer maps one spreadsheet player name. */
export type PlayerMapping = { kind: 'existing'; id: number } | { kind: 'new'; name: string };

/** An existing roster player with the same name (ignoring case), otherwise a new player. */
export function defaultPlayerMapping(name: string, roster: readonly { id: number; name: string }[]): PlayerMapping {
  const match = roster.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  return match ? { kind: 'existing', id: match.id } : { kind: 'new', name: name.trim() };
}

export function mappingToRef(mapping: PlayerMapping): ImportPlayerRef {
  return mapping.kind === 'existing' ? { id: mapping.id } : { name: mapping.name.trim() };
}

/** Distinct player names across games, trimmed, in first-seen order. Case-sensitive, like the sheet. */
export function distinctPlayerNames(games: readonly DraftGame[]): string[] {
  const names = new Set<string>();
  for (const g of games) for (const s of g.seats) if (s.player.trim()) names.add(s.player.trim());
  return [...names];
}

/** Distinct non-empty faction names across games, in first-seen order. */
export function distinctFactionNames(games: readonly DraftGame[]): string[] {
  const names = new Set<string>();
  for (const g of games) for (const s of g.seats) if (s.faction.trim()) names.add(s.faction.trim());
  return [...names];
}

/** 14 when the top score is 14 or more (the sheet's 14-point games), otherwise 10. */
export function inferVpTarget(topScore: number): number {
  return topScore >= 14 ? 14 : 10;
}

/**
 * Maps a spreadsheet faction name to a faction id: the importer's own picks first, then aliases and
 * loose name matching (case, whitespace, a leading "The").
 */
export function factionResolver(
  factions: readonly { id: number; name: string }[],
  aliases: readonly { alias: string; factionId: number }[],
  picks: Readonly<Record<string, number>> = {},
): (name: string) => number | null {
  const names = factions.map((f) => f.name);
  const idByName = new Map(factions.map((f) => [f.name, f.id]));
  const nameById = new Map(factions.map((f) => [f.id, f.name]));
  const aliasNames: Record<string, string> = {};
  for (const a of aliases) {
    const name = nameById.get(a.factionId);
    if (name) aliasNames[a.alias] = name;
  }
  return (raw) => {
    const picked = picks[raw.trim()];
    if (picked !== undefined) return picked;
    const name = resolveFactionName(raw, names, aliasNames);
    return name === null ? null : (idByName.get(name) ?? null);
  };
}

export interface ReviewContext {
  /** Year for dates the sheet wrote without one. */
  defaultYear: number;
  /** The player a spreadsheet name maps to; null when unmapped. */
  player(name: string): ImportPlayerRef | null;
  /** The faction id a spreadsheet faction name maps to; null when unknown. */
  faction(name: string): number | null;
}

export interface ReviewIssue {
  /** `info` is shown but doesn't change the game's status (e.g. no date, which most old games lack). */
  level: 'blocked' | 'warning' | 'info';
  message: string;
}

export interface ReviewedGame {
  status: 'ok' | 'warning' | 'blocked' | 'skipped';
  issues: ReviewIssue[];
  /** The game to send; null when blocked or skipped. */
  game: ImportGame | null;
  playedOn: string | null;
  vpTarget: number | null;
  /** Seat index of the winner when there is one. */
  winner: number | null;
  /** Recomputed 1st − 2nd; null when scores are incomplete. */
  spread: number | null;
  /** Several seats share the top score. */
  tie: boolean;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function reviewGame(draft: DraftGame, ctx: ReviewContext): ReviewedGame {
  const issues: ReviewIssue[] = [];
  const block = (message: string) => issues.push({ level: 'blocked', message });
  const warn = (message: string) => issues.push({ level: 'warning', message });
  const info = (message: string) => issues.push({ level: 'info', message });
  const result: ReviewedGame = { status: 'ok', issues, game: null, playedOn: null, vpTarget: null, winner: null, spread: null, tie: false };
  if (draft.skip) return { ...result, status: 'skipped' };

  const { seats } = draft;
  if (seats.length < MIN_SEATS) block(`Fewer than ${MIN_SEATS} players`);
  if (seats.length > MAX_SEATS) block(`More than ${MAX_SEATS} players`);

  const label = (i: number) => {
    const seat = seats[i];
    return seat?.row ? `Row ${seat.row}` : `Seat ${i + 1}`;
  };

  // Seats: player, faction and points must all be there.
  const resolved = seats.map((seat, i) => {
    let player: ImportPlayerRef | null = null;
    let factionId: number | null = null;
    let points: number | null = null;
    if (!seat.player.trim()) block(`${label(i)}: no player`);
    else {
      player = ctx.player(seat.player.trim());
      if (!player) block(`${label(i)}: pick who "${seat.player.trim()}" is`);
      else if ('name' in player && !playerNameSchema.safeParse(player.name).success) {
        block(`${label(i)}: "${player.name}" isn't a valid player name`);
        player = null;
      }
    }
    if (!seat.faction.trim()) block(`${label(i)}: no faction`);
    else {
      factionId = ctx.faction(seat.faction);
      if (factionId === null) block(`${label(i)}: unknown faction "${seat.faction.trim()}"`);
    }
    if (seat.points === null) block(`${label(i)}: no score`);
    else if (!Number.isInteger(seat.points) || seat.points < 0 || seat.points > POINTS_MAX) {
      block(`${label(i)}: score ${seat.points} must be a whole number from 0 to ${POINTS_MAX}`);
    } else points = seat.points;
    return { player, factionId, points };
  });

  // Duplicates, once players are mapped (two names can map to the same player).
  const seenPlayers = new Map<string, number>();
  const seenFactions = new Map<number, number>();
  resolved.forEach((s, i) => {
    if (s.player) {
      const key = playerRefKey(s.player);
      const first = seenPlayers.get(key);
      if (first !== undefined) block(`${label(i)}: same player as ${label(first)}`);
      else seenPlayers.set(key, i);
    }
    if (s.factionId !== null) {
      const first = seenFactions.get(s.factionId);
      if (first !== undefined) block(`${label(i)}: same faction as ${label(first)}`);
      else seenFactions.set(s.factionId, i);
    }
  });

  // Winner and spread from the scores.
  const scores = resolved.map((s) => s.points);
  if (scores.length > 0 && scores.every((p): p is number => p !== null)) {
    const top = Math.max(...scores);
    const topSeats = scores.flatMap((p, i) => (p === top ? [i] : []));
    const rest = scores.filter((_, i) => !topSeats.includes(i));
    result.tie = topSeats.length > 1;
    result.vpTarget = draft.vpTarget ?? inferVpTarget(top);
    if (!result.tie) {
      result.winner = topSeats[0] ?? null;
      result.spread = top - (rest.length ? Math.max(...rest) : 0);
    } else if (draft.endedEarly && draft.winner !== null && topSeats.includes(draft.winner)) {
      result.winner = draft.winner;
      result.spread = 0;
    } else {
      block(
        draft.endedEarly
          ? 'Tie for the most points: pick the winner'
          : 'Tie for the most points: fix the scores, or mark the game as ended early and pick the winner',
      );
    }
  }

  // Cross-check the sheet's own winner and spread columns.
  if (result.winner !== null) {
    const winnerSeat = seats[result.winner];
    if (winnerSeat && draft.sheet.winner && !sameName(draft.sheet.winner, winnerSeat.player)) {
      warn(`The sheet says ${draft.sheet.winner.trim()} won, but ${winnerSeat.player.trim() || label(result.winner)} has the most points`);
    }
    const sheetFaction = draft.sheet.winningFaction ? ctx.faction(draft.sheet.winningFaction) : null;
    const winnerFaction = resolved[result.winner]?.factionId;
    if (sheetFaction !== null && winnerFaction !== null && sheetFaction !== winnerFaction && draft.sheet.winningFaction) {
      warn(`The sheet says ${draft.sheet.winningFaction.trim()} won, but ${winnerSeat?.faction.trim()} has the most points`);
    }
  }
  if (result.spread !== null && draft.sheet.spread !== null && draft.sheet.spread !== result.spread) {
    warn(`The sheet's point spread is ${draft.sheet.spread}; 1st − 2nd is ${result.spread}`);
  }

  // Date and notes.
  if (draft.date) {
    result.playedOn = toIsoDate(draft.date, ctx.defaultYear);
    if (!result.playedOn) block(`${draft.date.month}/${draft.date.day}/${draft.date.year ?? ctx.defaultYear} isn't a real date`);
  } else {
    info('No date');
  }
  if (draft.notes.trim().length > NOTES_MAX) block(`Notes are longer than ${NOTES_MAX} characters`);
  for (const note of draft.annotations) warn(`Note in the sheet: "${note}"`);

  if (issues.some((i) => i.level === 'blocked') || result.winner === null || result.vpTarget === null) {
    if (!issues.some((i) => i.level === 'blocked')) block('Incomplete game');
    return { ...result, status: 'blocked' };
  }

  // Build the request body and run the API's own schema as a final check.
  const candidate = {
    playedOn: result.playedOn,
    vpTarget: result.vpTarget,
    endedEarly: draft.endedEarly,
    notes: draft.notes.trim() || null,
    seats: resolved.map((s) => ({ player: s.player, factionId: s.factionId, points: s.points })),
    winner: result.winner,
  };
  const parsed = importGameSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) block(issue.message);
    return { ...result, status: 'blocked' };
  }
  return { ...result, game: parsed.data, status: issues.some((i) => i.level === 'warning') ? 'warning' : 'ok' };
}
