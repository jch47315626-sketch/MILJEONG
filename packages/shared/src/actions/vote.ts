import type { ApplyResult, GameState } from '../types';
import { getPlayer } from './lookup';

export function applyVote(state: GameState, playerId: string, target: string): ApplyResult {
  const p = getPlayer(state, playerId);
  if (!p || p.left) return { ok: false, reason: 'NOT_ALIVE' };
  if (state.phase !== 'meeting' || !state.meeting) return { ok: false, reason: 'WRONG_PHASE' };
  if (!p.alive) return { ok: false, reason: 'NOT_ALIVE' };
  if (target !== 'skip') {
    const t = getPlayer(state, target);
    if (!t || !t.alive || t.left) return { ok: false, reason: 'TARGET_INVALID' };
  }
  if (Object.hasOwn(state.meeting.votes, playerId)) return { ok: false, reason: 'ALREADY_USED' };
  state.meeting.votes[playerId] = target;
  return { ok: true, events: [] };
}
