import { withinRange } from '../geometry';
import type { ApplyResult, GameState } from '../types';
import { getPlayer } from './lookup';

/** True if an active checkpoint covers this tile. Applies to living players only (callers skip ghosts). */
export function isTileBlocked(state: GameState, tx: number, ty: number): boolean {
  const s = state.sabotage;
  if (!s || s.kind !== 'checkpoint') return false;
  const passage = state.map.passages.find((p) => p.id === s.passageId);
  return !!passage && passage.tiles.some((t) => t.x === tx && t.y === ty);
}

export function applySabotage(
  state: GameState,
  playerId: string,
  kind: 'blackout' | 'checkpoint',
  passageId: string | null,
  now: number,
): ApplyResult {
  const p = getPlayer(state, playerId);
  if (!p || p.left) return { ok: false, reason: 'NOT_ALIVE' };
  if (state.phase !== 'playing') return { ok: false, reason: 'WRONG_PHASE' };
  if (!p.alive) return { ok: false, reason: 'NOT_ALIVE' };
  if (p.role !== 'spy') return { ok: false, reason: 'WRONG_ROLE' };
  if (now < state.sabotageReadyAt) return { ok: false, reason: 'COOLDOWN' };
  if (state.sabotage) return { ok: false, reason: 'SABOTAGE_ACTIVE' };
  if (kind === 'checkpoint') {
    if (passageId === null || !state.map.passages.some((x) => x.id === passageId)) {
      return { ok: false, reason: 'BAD_INPUT' };
    }
    state.sabotage = { kind, passageId, endsAt: now + state.config.checkpointDurationMs };
  } else {
    state.sabotage = { kind };
  }
  state.sabotageReadyAt = now + state.config.sabotageCooldownMs;
  return { ok: true, events: [{ e: 'sabotageStarted', kind }] };
}

export function applyFixBreaker(state: GameState, playerId: string): ApplyResult {
  const p = getPlayer(state, playerId);
  if (!p || p.left) return { ok: false, reason: 'NOT_ALIVE' };
  if (state.phase !== 'playing') return { ok: false, reason: 'WRONG_PHASE' };
  if (!p.alive) return { ok: false, reason: 'NOT_ALIVE' };
  if (p.role !== 'fighter') return { ok: false, reason: 'WRONG_ROLE' };
  if (state.sabotage?.kind !== 'blackout') return { ok: false, reason: 'TARGET_INVALID' };
  if (!withinRange(p.pos, state.map.breaker, state.config.fixRange)) {
    return { ok: false, reason: 'OUT_OF_RANGE' };
  }
  state.sabotage = null;
  return { ok: true, events: [{ e: 'sabotageEnded' }] };
}
