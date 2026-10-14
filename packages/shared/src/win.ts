import { taskGauge } from './tasks';
import type { GameEvent, GameState } from './types';

/** Spec 2.8 order: no spies -> fighters; fighters <= spies -> spies; gauge full -> fighters. */
export function checkWinner(state: GameState): 'fighters' | 'spies' | null {
  let f = 0;
  let s = 0;
  for (const p of Object.values(state.players)) {
    if (!p.alive || p.left) continue;
    if (p.role === 'spy') s++;
    else f++;
  }
  if (s === 0) return 'fighters';
  if (f <= s) return 'spies';
  if (taskGauge(state) >= 1) return 'fighters';
  return null;
}

export function endIfWon(state: GameState): GameEvent[] {
  if (state.phase === 'ended') return [];
  const winner = checkWinner(state);
  if (winner === null) return [];
  state.phase = 'ended';
  state.winner = winner;
  state.meeting = null;
  state.ejectingEndsAt = null;
  state.sabotage = null;
  for (const p of Object.values(state.players)) p.dir = { x: 0, y: 0 };
  return [{ e: 'gameEnded', winner }];
}
