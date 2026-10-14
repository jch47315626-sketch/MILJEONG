import { expect, test } from 'vitest';
import { applyIntent, isTileBlocked, tick } from '../src/index';
import { fighters, newGame, placeAt, spies } from './helpers';

const T0 = 1000;
const ready = T0 + 40000;

function setup() {
  const s = newGame(6, 1, T0);
  const sp = spies(s)[0];
  const [f1, f2] = fighters(s);
  return { s, sp, f1, f2 };
}

test('blackout starts, persists until fixBreaker by alive fighter in range', () => {
  const { s, sp, f1, f2 } = setup();
  const r = applyIntent(s, sp.id, { t: 'sabotage', kind: 'blackout' }, ready);
  expect(r).toEqual({ ok: true, events: [{ e: 'sabotageStarted', kind: 'blackout' }] });
  expect(s.sabotage).toEqual({ kind: 'blackout' });
  expect(s.sabotageReadyAt).toBe(ready + s.config.sabotageCooldownMs);
  tick(s, ready + 10 * 60000, 100);
  expect(s.sabotage).toEqual({ kind: 'blackout' });
  const b = s.map.breaker;
  placeAt(s, f1.id, { x: b.x + 1.6, y: b.y });
  expect(applyIntent(s, f1.id, { t: 'fixBreaker' }, ready + 1)).toEqual({ ok: false, reason: 'OUT_OF_RANGE' });
  placeAt(s, f1.id, { x: b.x + 1.5, y: b.y });
  f2.alive = false;
  placeAt(s, f2.id, { ...b });
  expect(applyIntent(s, f2.id, { t: 'fixBreaker' }, ready + 1)).toEqual({ ok: false, reason: 'NOT_ALIVE' });
  expect(applyIntent(s, sp.id, { t: 'fixBreaker' }, ready + 1)).toEqual({ ok: false, reason: 'WRONG_ROLE' });
  expect(applyIntent(s, f1.id, { t: 'fixBreaker' }, ready + 1)).toEqual({ ok: true, events: [{ e: 'sabotageEnded' }] });
  expect(s.sabotage).toBeNull();
  expect(applyIntent(s, f1.id, { t: 'fixBreaker' }, ready + 2)).toEqual({ ok: false, reason: 'TARGET_INVALID' });
});

test('checkpoint blocks passage tiles for alive players, not ghosts, auto-ends after 15s', () => {
  const { s, sp, f1, f2 } = setup();
  const pas = s.map.passages[0];
  const r = applyIntent(s, sp.id, { t: 'sabotage', kind: 'checkpoint', passageId: pas.id }, ready);
  expect(r).toEqual({ ok: true, events: [{ e: 'sabotageStarted', kind: 'checkpoint' }] });
  expect(s.sabotage).toEqual({ kind: 'checkpoint', passageId: pas.id, endsAt: ready + 15000 });
  for (const t of pas.tiles) expect(isTileBlocked(s, t.x, t.y)).toBe(true);
  expect(isTileBlocked(s, 0, 0)).toBe(false);
  // alive fighter walking into the passage is stopped; ghost passes
  const t0 = pas.tiles[0];
  placeAt(s, f1.id, { x: t0.x + 0.5, y: t0.y - 0.8 });
  placeAt(s, f2.id, { x: t0.x + 0.5, y: t0.y - 0.8 });
  f2.alive = false;
  f1.dir = { x: 0, y: 1 };
  f2.dir = { x: 0, y: 1 };
  for (let i = 0; i < 10; i++) tick(s, ready + i * 100, 100);
  expect(f1.pos.y).toBeLessThan(t0.y);
  expect(f2.pos.y).toBeGreaterThan(t0.y);
  expect(tick(s, ready + 14999, 100)).toEqual([]);
  expect(s.sabotage).not.toBeNull();
  expect(tick(s, ready + 15000, 100)).toEqual([{ e: 'sabotageEnded' }]);
  expect(s.sabotage).toBeNull();
  expect(isTileBlocked(s, t0.x, t0.y)).toBe(false);
});

test('cooldown 40s shared, one active at a time, fighter → WRONG_ROLE', () => {
  const { s, sp, f1 } = setup();
  const pid = s.map.passages[0].id;
  const sab = (who: string, now: number, kind: 'blackout' | 'checkpoint' = 'blackout') =>
    applyIntent(s, who, kind === 'blackout' ? { t: 'sabotage', kind } : { t: 'sabotage', kind, passageId: pid }, now);
  expect(sab(sp.id, ready - 1)).toEqual({ ok: false, reason: 'COOLDOWN' });
  expect(sab(f1.id, ready)).toEqual({ ok: false, reason: 'WRONG_ROLE' });
  expect(sab(sp.id, ready).ok).toBe(true);
  expect(sab(sp.id, ready + 1, 'checkpoint')).toEqual({ ok: false, reason: 'COOLDOWN' });
  s.sabotageReadyAt = 0;
  expect(sab(sp.id, ready + 2, 'checkpoint')).toEqual({ ok: false, reason: 'SABOTAGE_ACTIVE' });
  s.sabotage = null;
  expect(applyIntent(s, sp.id, { t: 'sabotage', kind: 'checkpoint', passageId: 'nope' }, ready + 3)).toEqual({ ok: false, reason: 'BAD_INPUT' });
  expect(applyIntent(s, sp.id, { t: 'sabotage', kind: 'checkpoint' } as never, ready + 3)).toEqual({ ok: false, reason: 'BAD_INPUT' });
  expect(applyIntent(s, sp.id, { t: 'sabotage', kind: 'x' } as never, ready + 3)).toEqual({ ok: false, reason: 'BAD_INPUT' });
  expect(applyIntent(s, sp.id, { t: 'sabotage', kind: 'checkpoint', passageId: '__proto__' }, ready + 3)).toEqual({ ok: false, reason: 'BAD_INPUT' });
  sp.alive = false;
  expect(sab(sp.id, ready + 3)).toEqual({ ok: false, reason: 'NOT_ALIVE' });
  sp.alive = true;
  s.phase = 'meeting';
  expect(sab(sp.id, ready + 3)).toEqual({ ok: false, reason: 'WRONG_PHASE' });
});

function startCheckpoint(s: ReturnType<typeof setup>['s'], spId: string, id: string) {
  expect(applyIntent(s, spId, { t: 'sabotage', kind: 'checkpoint', passageId: id }, ready).ok).toBe(true);
}
const run = (s: ReturnType<typeof setup>['s'], n: number, from = ready) => {
  for (let i = 0; i < n; i++) tick(s, from + i * 100, 100);
};

test('player in doorway at checkpoint start is displaced fully to their own side', () => {
  const { s, sp, f1, f2 } = setup();
  const pas = s.map.passages[0];
  const row = pas.tiles[0].y;
  const x = pas.tiles[0].x + 0.5;
  placeAt(s, f1.id, { x, y: row + 0.3 }); // north half
  placeAt(s, f2.id, { x, y: row + 0.8 }); // south half
  startCheckpoint(s, sp.id, pas.id);
  expect(f1.pos.y + 0.3).toBeLessThanOrEqual(row);
  expect(f2.pos.y - 0.3).toBeGreaterThanOrEqual(row + 1);
});

test('doorway player holding toward far side never crosses the blocked row', () => {
  const { s, sp, f1 } = setup();
  const pas = s.map.passages[0];
  const row = pas.tiles[0].y;
  placeAt(s, f1.id, { x: pas.tiles[0].x + 0.5, y: row + 0.5 });
  startCheckpoint(s, sp.id, pas.id);
  f1.dir = { x: 0, y: 1 };
  for (let i = 0; i < 10; i++) {
    tick(s, ready + i * 100, 100);
    expect(f1.pos.y).toBeLessThanOrEqual(row - 0.3 + 1e-9);
  }
});

test('half-stepped-off player turning around cannot cross', () => {
  const { s, sp, f1 } = setup();
  const pas = s.map.passages[0];
  const row = pas.tiles[0].y;
  placeAt(s, f1.id, { x: pas.tiles[0].x + 0.5, y: row + 1.1 }); // south, footprint still touches row
  startCheckpoint(s, sp.id, pas.id);
  f1.dir = { x: 0, y: -1 };
  run(s, 10);
  expect(f1.pos.y).toBeGreaterThanOrEqual(row + 1.3 - 1e-9);
});

test('ghost in doorway is not displaced and can pass', () => {
  const { s, sp, f1 } = setup();
  const pas = s.map.passages[0];
  const row = pas.tiles[0].y;
  f1.alive = false;
  placeAt(s, f1.id, { x: pas.tiles[0].x + 0.5, y: row + 0.5 });
  startCheckpoint(s, sp.id, pas.id);
  expect(f1.pos).toEqual({ x: pas.tiles[0].x + 0.5, y: row + 0.5 });
  f1.dir = { x: 0, y: -1 };
  run(s, 10);
  expect(f1.pos.y).toBeLessThan(row - 0.3);
});
