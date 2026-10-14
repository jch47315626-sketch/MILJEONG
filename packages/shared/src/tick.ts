import { moveWithCollision } from './geometry';
import type { GameEvent, GameState } from './types';

/** Max simulated step per tick, to avoid tunneling through walls. */
export const MAX_TICK_MS = 100;

export function tick(state: GameState, now: number, dtMs: number): GameEvent[] {
  const events: GameEvent[] = [];
  if (state.phase !== 'playing') return events;
  const dt = Math.min(Math.max(Number.isFinite(dtMs) ? dtMs : 0, 0), MAX_TICK_MS);
  const step = (state.config.moveSpeed * dt) / 1000;
  for (const p of Object.values(state.players)) {
    if (p.left || (p.dir.x === 0 && p.dir.y === 0)) continue;
    const delta = { x: p.dir.x * step, y: p.dir.y * step };
    if (p.alive) {
      p.pos = moveWithCollision(state.map, p.pos, delta, () => false);
    } else {
      p.pos = {
        x: Math.min(Math.max(p.pos.x + delta.x, 0), state.map.width),
        y: Math.min(Math.max(p.pos.y + delta.y, 0), state.map.height),
      };
    }
  }
  void now;
  return events;
}
