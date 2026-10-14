import { withinRange } from '../geometry';
import type { ApplyResult, GameState } from '../types';
import { getPlayer } from './lookup';

export function applyInform(
  state: GameState,
  playerId: string,
  targetId: string,
  now: number,
): ApplyResult {
  const p = getPlayer(state, playerId);
  if (!p || p.left) return { ok: false, reason: 'NOT_ALIVE' };
  if (state.phase !== 'playing') return { ok: false, reason: 'WRONG_PHASE' };
  if (!p.alive) return { ok: false, reason: 'NOT_ALIVE' };
  if (p.role !== 'spy') return { ok: false, reason: 'WRONG_ROLE' };
  if (now < p.informReadyAt) return { ok: false, reason: 'COOLDOWN' };
  const t = getPlayer(state, targetId);
  if (!t || t.left || !t.alive || t.role !== 'fighter' || t.id === p.id) {
    return { ok: false, reason: 'TARGET_INVALID' };
  }
  if (!withinRange(p.pos, t.pos, state.config.informRange)) {
    return { ok: false, reason: 'OUT_OF_RANGE' };
  }
  t.alive = false;
  t.dir = { x: 0, y: 0 };
  state.traces.push({ id: `t${state.seq++}`, victimId: t.id, pos: { ...t.pos } });
  p.informReadyAt = now + state.config.informCooldownMs;
  return { ok: true, events: [{ e: 'informed', victim: t.id }] };
}
