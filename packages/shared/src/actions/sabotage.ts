import { PLAYER_RADIUS, withinRange } from '../geometry';
import { isWalkable } from '../map/map';
import type { MapData } from '../map/types';
import type { ApplyResult, GameState } from '../types';
import { getPlayer } from './lookup';

/** True if an active checkpoint covers this tile. Applies to living players only (callers skip ghosts). */
export function isTileBlocked(state: GameState, tx: number, ty: number): boolean {
  const s = state.sabotage;
  if (!s || s.kind !== 'checkpoint') return false;
  const passage = state.map.passages.find((p) => p.id === s.passageId);
  return !!passage && passage.tiles.some((t) => t.x === tx && t.y === ty);
}

function footprintTouches(pos: { x: number; y: number }, tiles: { x: number; y: number }[]): boolean {
  const r = PLAYER_RADIUS;
  for (const cx of [pos.x - r, pos.x + r]) {
    for (const cy of [pos.y - r, pos.y + r]) {
      const tx = Math.floor(cx);
      const ty = Math.floor(cy);
      if (tiles.some((t) => t.x === tx && t.y === ty)) return true;
    }
  }
  return false;
}

function fitsFloor(map: MapData, x: number, y: number): boolean {
  const r = PLAYER_RADIUS;
  return [x - r, x + r].every((cx) => [y - r, y + r].every((cy) => isWalkable(map, cx, cy)));
}

/** Push living players out of a freshly blocked passage, to the side their centre is on. */
function evictFromPassage(state: GameState, tiles: { x: number; y: number }[]): void {
  if (tiles.length === 0) return;
  const horizontal = tiles.every((t) => t.y === tiles[0].y); // crossing runs along y
  for (const pl of Object.values(state.players)) {
    if (pl.left || !pl.alive || !footprintTouches(pl.pos, tiles)) continue;
    const mid = (horizontal ? tiles[0].y : tiles[0].x) + 0.5;
    const cur = horizontal ? pl.pos.y : pl.pos.x;
    const target = cur <= mid ? mid - 1 : mid + 1;
    let next = horizontal ? { x: pl.pos.x, y: target } : { x: target, y: pl.pos.y };
    if (!fitsFloor(state.map, next.x, next.y)) {
      // slide along the passage axis to the nearest passage tile centre
      const c = tiles.reduce((a, t) => {
        const d = horizontal ? Math.abs(t.x + 0.5 - pl.pos.x) : Math.abs(t.y + 0.5 - pl.pos.y);
        return d < a.d ? { t, d } : a;
      }, { t: tiles[0], d: Infinity }).t;
      next = horizontal ? { x: c.x + 0.5, y: target } : { x: target, y: c.y + 0.5 };
    }
    pl.pos = next;
  }
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
    evictFromPassage(state, state.map.passages.find((x) => x.id === passageId)?.tiles ?? []);
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
