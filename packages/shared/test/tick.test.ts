import { expect, test } from 'vitest';
import { applyIntent, tick } from '../src/index';
import { newGame, placeAt } from './helpers';

test('move: dir clamped to length<=1, tick moves by moveSpeed*dt', () => {
  const s = newGame();
  placeAt(s, 'p0', { x: 20.5, y: 12.5 });
  expect(applyIntent(s, 'p0', { t: 'move', dir: { x: 3, y: 0 } }, 1000).ok).toBe(true);
  expect(s.players.p0.dir).toEqual({ x: 1, y: 0 });
  for (let i = 0; i < 10; i++) tick(s, 1000 + i * 100, 100);
  expect(s.players.p0.pos.x).toBeCloseTo(24.5);
  expect(s.players.p0.pos.y).toBeCloseTo(12.5);
});

test('tick clamps dt to 100ms', () => {
  const s = newGame();
  placeAt(s, 'p0', { x: 20.5, y: 12.5 });
  applyIntent(s, 'p0', { t: 'move', dir: { x: 1, y: 0 } }, 1000);
  tick(s, 2000, 5000);
  expect(s.players.p0.pos.x).toBeCloseTo(20.9);
});

test('move: ghost passes through walls, alive does not', () => {
  const s = newGame();
  // wall block at x 12..13 (cols 12-13 are '#') between rooms, row 5
  placeAt(s, 'p0', { x: 11.5, y: 5.5 });
  placeAt(s, 'p1', { x: 11.5, y: 5.5 });
  s.players.p1.alive = false;
  for (const id of ['p0', 'p1']) applyIntent(s, id, { t: 'move', dir: { x: 1, y: 0 } }, 1000);
  for (let i = 0; i < 20; i++) tick(s, 1000 + i * 100, 100);
  expect(s.players.p0.pos.x).toBeLessThan(12);
  expect(s.players.p1.pos.x).toBeGreaterThan(14);
});

test('ghost stays within map bounds; left players do not move', () => {
  const s = newGame();
  placeAt(s, 'p1', { x: 0.5, y: 0.5 });
  placeAt(s, 'p2', { x: 20.5, y: 12.5 });
  s.players.p1.alive = false;
  s.players.p2.left = true;
  applyIntent(s, 'p1', { t: 'move', dir: { x: -1, y: -1 } }, 1000);
  applyIntent(s, 'p2', { t: 'move', dir: { x: 1, y: 0 } }, 1000);
  for (let i = 0; i < 20; i++) tick(s, 1000 + i * 100, 100);
  expect(s.players.p1.pos.x).toBeGreaterThanOrEqual(0);
  expect(s.players.p1.pos.y).toBeGreaterThanOrEqual(0);
  expect(s.players.p2.pos).toEqual({ x: 20.5, y: 12.5 });
});

test('move rejected with WRONG_PHASE during meeting; tick does not move', () => {
  const s = newGame();
  s.phase = 'meeting';
  expect(applyIntent(s, 'p0', { t: 'move', dir: { x: 1, y: 0 } }, 1000)).toEqual({ ok: false, reason: 'WRONG_PHASE' });
  s.players.p0.dir = { x: 1, y: 0 };
  const before = { ...s.players.p0.pos };
  tick(s, 1100, 100);
  expect(s.players.p0.pos).toEqual(before);
});

test('BAD_INPUT for malformed intent, state untouched', () => {
  const s = newGame();
  const snap = JSON.parse(JSON.stringify(s));
  const bad = (i: unknown) => applyIntent(s, 'p0', i as any, 1000);
  const R = { ok: false, reason: 'BAD_INPUT' };
  expect(bad({ t: 'move', dir: { x: NaN, y: 0 } })).toEqual(R);
  expect(bad({ t: 'move', dir: { x: Infinity, y: 0 } })).toEqual(R);
  expect(bad({ t: 'move', dir: { x: '1', y: 0 } })).toEqual(R);
  expect(bad({ t: 'move' })).toEqual(R);
  expect(bad({ t: 'nope' })).toEqual(R);
  expect(bad(null)).toEqual(R);
  expect(bad({ t: 'taskStart', taskId: 5 })).toEqual(R);
  expect(bad({ t: 'vote', target: 5 })).toEqual(R);
  expect(JSON.parse(JSON.stringify(s))).toEqual(snap);
});
