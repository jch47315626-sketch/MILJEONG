import type { GameState, PlayerState } from '../types';

/** Own-property lookup so client-supplied ids like '__proto__' never hit the prototype chain. */
export function getPlayer(state: GameState, id: string): PlayerState | undefined {
  return Object.hasOwn(state.players, id) ? state.players[id] : undefined;
}
