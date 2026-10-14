import { DEFAULT_CONFIG, createGame, createRng } from '../src/index';
import type { GameState, PlayerState, Vec } from '../src/index';

export function players(n: number): { id: string; name: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
}

export function newGame(n = 6, seed = 1, now = 1000): GameState {
  return createGame(players(n), DEFAULT_CONFIG, createRng(seed), now);
}

export const fighters = (s: GameState): PlayerState[] =>
  Object.values(s.players).filter((p) => p.role === 'fighter');
export const spies = (s: GameState): PlayerState[] =>
  Object.values(s.players).filter((p) => p.role === 'spy');

export function placeAt(s: GameState, id: string, pos: Vec): void {
  s.players[id].pos = { ...pos };
}
