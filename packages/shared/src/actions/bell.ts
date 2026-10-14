import { withinRange } from '../geometry';
import { startMeeting } from '../meeting';
import type { ApplyResult, GameState } from '../types';
import { getPlayer } from './lookup';

export function applyBell(state: GameState, playerId: string, now: number): ApplyResult {
  const p = getPlayer(state, playerId);
  if (!p || p.left) return { ok: false, reason: 'NOT_ALIVE' };
  if (state.phase !== 'playing') return { ok: false, reason: 'WRONG_PHASE' };
  if (!p.alive) return { ok: false, reason: 'NOT_ALIVE' };
  if (p.bellUsed) return { ok: false, reason: 'ALREADY_USED' };
  if (now < state.startedAt + state.config.bellUnlockMs) return { ok: false, reason: 'LOCKED' };
  if (state.sabotage != null) return { ok: false, reason: 'SABOTAGE_ACTIVE' };
  if (!withinRange(p.pos, state.map.bell, state.config.bellRange)) {
    return { ok: false, reason: 'OUT_OF_RANGE' };
  }
  p.bellUsed = true;
  return { ok: true, events: startMeeting(state, playerId, 'bell', null, now) };
}
