import { endIfWon } from './win';
import type { GameEvent, GameState } from './types';

export function markDisconnected(state: GameState, id: string, now: number): void {
  const p = Object.hasOwn(state.players, id) ? state.players[id] : undefined;
  if (!p || p.left) return;
  p.connected = false;
  if (state.phase !== 'ended') p.disconnectDeadline = now + state.config.reconnectGraceMs;
}

export function markReconnected(state: GameState, id: string): void {
  const p = Object.hasOwn(state.players, id) ? state.players[id] : undefined;
  if (!p || p.left) return;
  p.connected = true;
  p.disconnectDeadline = null;
}

export function markLeft(state: GameState, id: string, _now: number): GameEvent[] {
  const p = Object.hasOwn(state.players, id) ? state.players[id] : undefined;
  if (!p || p.left) return [];
  p.left = true;
  p.alive = false;
  p.connected = false;
  p.disconnectDeadline = null;
  p.dir = { x: 0, y: 0 };
  if (state.meeting) delete state.meeting.votes[id];
  if (!state.publiclyDead.includes(id)) state.publiclyDead.push(id);
  return endIfWon(state);
}
