import { expect, test } from 'vitest';
import { applyIntent, taskGauge } from '../src/index';
import { fighters, newGame, placeAt, spies } from './helpers';

function spotPos(s: ReturnType<typeof newGame>, id: string) {
  return s.map.taskSpots.find((t) => t.id === id)!.pos;
}

test('taskComplete requires taskStart, range, and taskMinMs', () => {
  const s = newGame();
  const f = fighters(s)[0];
  const t = f.tasks[0];
  placeAt(s, f.id, spotPos(s, t.taskId));
  expect(applyIntent(s, f.id, { t: 'taskComplete', taskId: t.taskId }, 2000)).toEqual({ ok: false, reason: 'NOT_STARTED' });
  expect(applyIntent(s, f.id, { t: 'taskStart', taskId: t.taskId }, 2000)).toEqual({ ok: true, events: [] });
  expect(applyIntent(s, f.id, { t: 'taskComplete', taskId: t.taskId }, 3000)).toEqual({ ok: false, reason: 'TOO_FAST' });
  placeAt(s, f.id, { x: 1.5, y: 1.5 });
  expect(applyIntent(s, f.id, { t: 'taskComplete', taskId: t.taskId }, 3500)).toEqual({ ok: false, reason: 'OUT_OF_RANGE' });
  placeAt(s, f.id, spotPos(s, t.taskId));
  expect(applyIntent(s, f.id, { t: 'taskComplete', taskId: t.taskId }, 3500)).toEqual({
    ok: true,
    events: [{ e: 'taskDone', player: f.id }],
  });
  expect(applyIntent(s, f.id, { t: 'taskComplete', taskId: t.taskId }, 4000)).toEqual({ ok: false, reason: 'ALREADY_USED' });
  expect(applyIntent(s, f.id, { t: 'taskStart', taskId: t.taskId }, 4000)).toEqual({ ok: false, reason: 'ALREADY_USED' });
});

test('taskStart: spy WRONG_ROLE, unknown id TARGET_INVALID, out of range, wrong phase', () => {
  const s = newGame();
  const sp = spies(s)[0];
  const f = fighters(s)[0];
  expect(applyIntent(s, sp.id, { t: 'taskStart', taskId: 'mimeo-print' }, 2000)).toEqual({ ok: false, reason: 'WRONG_ROLE' });
  expect(applyIntent(s, f.id, { t: 'taskStart', taskId: 'nope' }, 2000)).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  const other = s.map.taskSpots.find((x) => !f.tasks.some((t) => t.taskId === x.id))!;
  expect(applyIntent(s, f.id, { t: 'taskStart', taskId: other.id }, 2000)).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  expect(applyIntent(s, f.id, { t: 'taskStart', taskId: f.tasks[0].taskId }, 2000)).toEqual({ ok: false, reason: 'OUT_OF_RANGE' });
  expect(f.tasks[0].startedAt).toBeNull();
  s.phase = 'meeting';
  placeAt(s, f.id, spotPos(s, f.tasks[0].taskId));
  expect(applyIntent(s, f.id, { t: 'taskStart', taskId: f.tasks[0].taskId }, 2000)).toEqual({ ok: false, reason: 'WRONG_PHASE' });
});

test('ghost fighter can still complete tasks', () => {
  const s = newGame();
  const f = fighters(s)[0];
  f.alive = false;
  const t = f.tasks[0];
  placeAt(s, f.id, spotPos(s, t.taskId));
  expect(applyIntent(s, f.id, { t: 'taskStart', taskId: t.taskId }, 2000).ok).toBe(true);
  expect(applyIntent(s, f.id, { t: 'taskComplete', taskId: t.taskId }, 4000).ok).toBe(true);
});

test('taskGauge excludes left players', () => {
  const s = newGame(6);
  expect(taskGauge(s)).toBe(0);
  const [a, b] = fighters(s);
  for (const t of a.tasks) t.done = true;
  expect(taskGauge(s)).toBeCloseTo(5 / 25);
  b.left = true;
  expect(taskGauge(s)).toBeCloseTo(5 / 20);
  for (const p of fighters(s)) for (const t of p.tasks) t.done = true;
  expect(taskGauge(s)).toBe(1);
});
