import { moveWithCollision } from './geometry';
import { resolveMeeting } from './meeting';
import type { GameEvent, GameState } from './types';

/** Max simulated step per tick, to avoid tunneling through walls. */
export const MAX_TICK_MS = 100;

export function tick(state: GameState, now: number, dtMs: number): GameEvent[] {
  const events: GameEvent[] = [];
  if (state.phase === 'meeting' && state.meeting) {
    const m = state.meeting;
    const allVoted = state.order.every((id) => {
      const p = state.players[id];
      return !p || !p.alive || p.left || Object.hasOwn(m.votes, id);
    });
    if (now >= m.voteEndsAt || allVoted) events.push(...resolveMeeting(state, now));
    return events;
  }
  if (state.phase === 'ejecting') {
    if (state.ejectingEndsAt !== null && now >= state.ejectingEndsAt) {
      state.phase = 'playing';
      state.ejectingEndsAt = null;
      for (const p of Object.values(state.players)) {
        p.dir = { x: 0, y: 0 };
        if (p.role === 'spy') p.informReadyAt = now + state.config.informCooldownMs;
      }
      state.sabotageReadyAt = now + state.config.sabotageCooldownMs;
    }
    return events;
  }
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
