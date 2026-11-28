import { describe, expect, it } from 'vitest';
import { canEditGame, gameInputSchema, gamesQuerySchema, playerNameSchema, topScorers, updatePlayerSchema } from './games.js';

const base = {
  playedOn: '2026-05-21',
  vpTarget: 10,
  endedEarly: false,
  notes: null,
  seats: [
    { playerId: 1, factionId: 10, points: 10 },
    { playerId: 2, factionId: 11, points: 7 },
  ],
  winnerPlayerId: 1,
};

function issues(input: unknown) {
  const r = gameInputSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

describe('gameInputSchema', () => {
  it('accepts a valid game and normalizes notes', () => {
    expect(gameInputSchema.parse({ ...base, notes: '  ' }).notes).toBeNull();
    expect(gameInputSchema.parse({ ...base, notes: ' Total Annihilation ' }).notes).toBe('Total Annihilation');
  });

  it('allows a missing date and points over the VP target', () => {
    const seats = [base.seats[0] && { ...base.seats[0], points: 11 }, base.seats[1]];
    expect(gameInputSchema.safeParse({ ...base, playedOn: null, seats }).success).toBe(true);
  });

  it('rejects impossible dates', () => {
    expect(issues({ ...base, playedOn: '2026-02-30' })).toEqual([{ path: 'playedOn', message: 'Enter a valid date' }]);
  });

  it('requires 2–8 seats', () => {
    expect(issues({ ...base, seats: [base.seats[0]] })[0]?.path).toBe('seats');
    const nine = Array.from({ length: 9 }, (_, i) => ({ playerId: i + 1, factionId: i + 1, points: i }));
    expect(issues({ ...base, seats: nine, winnerPlayerId: 9 }).map((i) => i.path)).toContain('seats');
  });

  it('rejects a player or faction used twice', () => {
    const seats = [...base.seats, { playerId: 1, factionId: 10, points: 3 }];
    expect(issues({ ...base, seats })).toEqual([
      { path: 'seats.2.playerId', message: 'This player is already in the game' },
      { path: 'seats.2.factionId', message: 'This faction is already in the game' },
    ]);
  });

  it('requires the winner to be seated and have the most points', () => {
    expect(issues({ ...base, winnerPlayerId: 3 })).toEqual([
      { path: 'winnerPlayerId', message: 'The winner must be one of the players' },
    ]);
    expect(issues({ ...base, winnerPlayerId: 2 })).toEqual([
      { path: 'winnerPlayerId', message: 'The winner must have the most points' },
    ]);
  });

  it('allows a tie for the most points only when the game ended early', () => {
    const seats = [base.seats[0], { playerId: 2, factionId: 11, points: 10 }];
    expect(issues({ ...base, seats, winnerPlayerId: 2 })).toEqual([
      { path: 'winnerPlayerId', message: 'A tie for the most points is only allowed when the game ended early' },
    ]);
    expect(issues({ ...base, seats, winnerPlayerId: 2, endedEarly: true })).toEqual([]);
  });

  it('rejects out-of-range numbers', () => {
    expect(issues({ ...base, vpTarget: 21 })[0]?.path).toBe('vpTarget');
    expect(issues({ ...base, seats: [base.seats[0], { playerId: 2, factionId: 11, points: -1 }] })[0]?.path).toBe('seats.1.points');
  });
});

describe('topScorers', () => {
  it('returns everyone tied for the top score', () => {
    expect(topScorers([{ playerId: 1, points: 8 }, { playerId: 2, points: 9 }, { playerId: 3, points: 9 }])).toEqual([2, 3]);
    expect(topScorers([])).toEqual([]);
    expect(topScorers([{ playerId: 1, points: Number.NaN }])).toEqual([]);
  });
});

describe('players', () => {
  it('trims names and limits length', () => {
    expect(playerNameSchema.parse('  Marcus ')).toBe('Marcus');
    expect(playerNameSchema.safeParse(' ').success).toBe(false);
    expect(playerNameSchema.safeParse('x'.repeat(41)).success).toBe(false);
  });

  it('needs something to update', () => {
    expect(updatePlayerSchema.safeParse({}).success).toBe(false);
    expect(updatePlayerSchema.parse({ archived: true })).toEqual({ archived: true });
  });
});

describe('gamesQuerySchema', () => {
  it('coerces query strings and applies defaults', () => {
    expect(gamesQuerySchema.parse({ playerCount: '3', mine: 'true' })).toEqual({ playerCount: 3, mine: true, limit: 50, offset: 0 });
  });

  it('rejects a reversed date range', () => {
    expect(gamesQuerySchema.safeParse({ from: '2026-06-01', to: '2026-05-01' }).success).toBe(false);
  });
});

describe('canEditGame', () => {
  it('lets the creator and admins edit', () => {
    expect(canEditGame({ id: 'a', role: 'user' }, 'a')).toBe(true);
    expect(canEditGame({ id: 'b', role: 'user' }, 'a')).toBe(false);
    expect(canEditGame({ id: 'b', role: 'admin' }, 'a')).toBe(true);
    expect(canEditGame(null, 'a')).toBe(false);
  });
});
