import { withinRange } from '../geometry';
import type { ApplyResult, GameState, PlayerState, TaskAssignment } from '../types';

type Found = { p: PlayerState; task: TaskAssignment; pos: { x: number; y: number } };

function find(
  state: GameState,
  playerId: string,
  taskId: string,
): Found | { ok: false; reason: 'WRONG_PHASE' | 'NOT_ALIVE' | 'WRONG_ROLE' | 'TARGET_INVALID' } {
  const p = state.players[playerId];
  if (!p || p.left) return { ok: false, reason: 'NOT_ALIVE' };
  if (state.phase !== 'playing') return { ok: false, reason: 'WRONG_PHASE' };
  if (p.role !== 'fighter') return { ok: false, reason: 'WRONG_ROLE' };
  const task = p.tasks.find((t) => t.taskId === taskId);
  const spot = state.map.taskSpots.find((s) => s.id === taskId);
  if (!task || !spot) return { ok: false, reason: 'TARGET_INVALID' };
  return { p, task, pos: spot.pos };
}

export function applyTaskStart(
  state: GameState,
  playerId: string,
  taskId: string,
  now: number,
): ApplyResult {
  const f = find(state, playerId, taskId);
  if ('ok' in f) return f;
  if (f.task.done) return { ok: false, reason: 'ALREADY_USED' };
  if (!withinRange(f.p.pos, f.pos, state.config.taskRange)) {
    return { ok: false, reason: 'OUT_OF_RANGE' };
  }
  f.task.startedAt = now;
  return { ok: true, events: [] };
}

export function applyTaskComplete(
  state: GameState,
  playerId: string,
  taskId: string,
  now: number,
): ApplyResult {
  const f = find(state, playerId, taskId);
  if ('ok' in f) return f;
  if (f.task.done) return { ok: false, reason: 'ALREADY_USED' };
  if (!withinRange(f.p.pos, f.pos, state.config.taskRange)) {
    return { ok: false, reason: 'OUT_OF_RANGE' };
  }
  if (f.task.startedAt === null) return { ok: false, reason: 'NOT_STARTED' };
  if (now - f.task.startedAt < state.config.taskMinMs) return { ok: false, reason: 'TOO_FAST' };
  f.task.done = true;
  return { ok: true, events: [{ e: 'taskDone', player: playerId }] };
}
