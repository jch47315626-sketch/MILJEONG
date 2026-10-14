import type { ApplyResult, GameState } from '../types';
import { getPlayer } from './lookup';

export function applyChat(state: GameState, playerId: string, text: string, now: number): ApplyResult {
  const p = getPlayer(state, playerId);
  if (!p || p.left) return { ok: false, reason: 'NOT_ALIVE' };
  const t = text.trim();
  if (t.length < 1 || t.length > state.config.chatMaxLen) return { ok: false, reason: 'BAD_INPUT' };
  const msg = { from: playerId, text: t, at: now };
  if (!p.alive) {
    state.ghostChat.push(msg);
  } else {
    if (state.phase !== 'meeting') return { ok: false, reason: 'WRONG_PHASE' };
    state.meetingChat.push(msg);
  }
  return { ok: true, events: [] };
}
