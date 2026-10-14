import { CHAT_HISTORY_MAX } from '../config';
import type { ApplyResult, ChatMsg, GameState } from '../types';
import { getPlayer } from './lookup';

export function applyChat(state: GameState, playerId: string, text: string, now: number): ApplyResult {
  const p = getPlayer(state, playerId);
  if (!p || p.left) return { ok: false, reason: 'NOT_ALIVE' };
  const t = text.trim();
  if (t.length < 1 || t.length > state.config.chatMaxLen) return { ok: false, reason: 'BAD_INPUT' };
  const msg = { from: playerId, text: t, at: now };
  if (!p.alive) {
    pushCapped(state.ghostChat, msg);
  } else {
    if (state.phase !== 'meeting') return { ok: false, reason: 'WRONG_PHASE' };
    pushCapped(state.meetingChat, msg);
  }
  return { ok: true, events: [] };
}

/** Appends and drops the oldest messages beyond CHAT_HISTORY_MAX. */
function pushCapped(list: ChatMsg[], msg: ChatMsg): void {
  list.push(msg);
  if (list.length > CHAT_HISTORY_MAX) list.splice(0, list.length - CHAT_HISTORY_MAX);
}
