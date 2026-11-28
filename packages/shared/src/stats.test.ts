import { describe, expect, it } from 'vitest';
import { runningWinRate } from './stats.js';

describe('runningWinRate', () => {
  it('tracks win rate and expected win rate after each game', () => {
    const results = [
      { gameId: 1, playedOn: null, playerCount: 2, isWinner: true },
      { gameId: 2, playedOn: '2026-05-01', playerCount: 4, isWinner: false },
    ];
    expect(runningWinRate(results)).toEqual([
      { game: 1, winRate: 1, expected: 0.5 },
      { game: 2, winRate: 0.5, expected: 0.375 },
    ]);
    expect(runningWinRate([])).toEqual([]);
  });
});
