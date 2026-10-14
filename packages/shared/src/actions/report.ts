import { dist } from '../geometry';
import { startMeeting } from '../meeting';
import type { ApplyResult, GameState } from '../types';
import { getPlayer } from './lookup';

export function applyReport(state: GameState, playerId: string, now: number): ApplyResult {
  const p = getPlayer(state, playerId);
  if (!p || p.left) return { ok: false, reason: 'NOT_ALIVE' };
  if (state.phase !== 'playing') return { ok: false, reason: 'WRONG_PHASE' };
  if (!p.alive) return { ok: false, reason: 'NOT_ALIVE' };
  let best: { victimId: string; d: number } | null = null;
  for (const tr of state.traces) {
    const d = dist(p.pos, tr.pos);
    if (d <= state.config.reportRange && (best === null || d < best.d)) {
      best = { victimId: tr.victimId, d };
    }
  }
  if (!best) return { ok: false, reason: 'OUT_OF_RANGE' };
  return { ok: true, events: startMeeting(state, playerId, 'report', best.victimId, now) };
}
