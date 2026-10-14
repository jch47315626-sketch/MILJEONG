import { getPlayer } from './lookup';
import type { Vec } from '../map/types';
import type { ApplyResult, GameState } from '../types';

export function applyMove(state: GameState, playerId: string, dir: Vec): ApplyResult {
  const p = getPlayer(state, playerId);
  if (!p || p.left) return { ok: false, reason: 'NOT_ALIVE' };
  if (state.phase !== 'playing') return { ok: false, reason: 'WRONG_PHASE' };
  const len = Math.hypot(dir.x, dir.y);
  const k = len > 1 ? 1 / len : 1;
  p.dir = { x: dir.x * k, y: dir.y * k };
  return { ok: true, events: [] };
}
