import { expect, test } from 'vitest';
import { applyIntent } from '../src/index';
import { fighters, newGame, placeAt, spies } from './helpers';

const T0 = 1000;
const ready = 1000 + 30000;

function setup() {
  const s = newGame(6, 1, T0);
  const sp = spies(s)[0];
  const [f1, f2] = fighters(s);
  placeAt(s, sp.id, { x: 10, y: 10 });
  placeAt(s, f1.id, { x: 10.5, y: 10 });
  placeAt(s, f2.id, { x: 20, y: 20 });
  return { s, sp, f1, f2 };
}

test('inform succeeds: victim becomes ghost, trace at victim pos, cooldown reset', () => {
  const { s, sp, f1 } = setup();
  f1.dir = { x: 1, y: 0 };
  const seq = s.seq;
  const r = applyIntent(s, sp.id, { t: 'inform', target: f1.id }, ready);
  expect(r).toEqual({ ok: true, events: [{ e: 'informed', victim: f1.id }] });
  expect(f1.alive).toBe(false);
  expect(f1.dir).toEqual({ x: 0, y: 0 });
  expect(s.traces).toEqual([{ id: `t${seq}`, victimId: f1.id, pos: { x: 10.5, y: 10 } }]);
  expect(s.seq).toBe(seq + 1);
  expect(sp.informReadyAt).toBe(ready + s.config.informCooldownMs);
});

test('inform rejections', () => {
  const { s, sp, f1, f2 } = setup();
  const inf = (who: string, target: string, now = ready) =>
    applyIntent(s, who, { t: 'inform', target }, now);
  expect(inf(f1.id, f2.id)).toEqual({ ok: false, reason: 'WRONG_ROLE' });
  expect(inf(sp.id, f1.id, ready - 1)).toEqual({ ok: false, reason: 'COOLDOWN' });
  expect(inf(sp.id, f2.id)).toEqual({ ok: false, reason: 'OUT_OF_RANGE' });
  placeAt(s, f1.id, { x: 11.6, y: 10 });
  expect(inf(sp.id, f1.id)).toEqual({ ok: false, reason: 'OUT_OF_RANGE' });
  placeAt(s, f1.id, { x: 10.5, y: 10 });
  expect(inf(sp.id, sp.id)).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  expect(inf(sp.id, 'nobody')).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  f1.alive = false;
  expect(inf(sp.id, f1.id)).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  f1.alive = true;
  const other = spies(s)[1];
  if (other) expect(inf(sp.id, other.id)).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  expect(applyIntent(s, sp.id, { t: 'inform', target: 5 as never }, ready)).toEqual({ ok: false, reason: 'BAD_INPUT' });
  sp.alive = false;
  expect(inf(sp.id, f1.id)).toEqual({ ok: false, reason: 'NOT_ALIVE' });
  sp.alive = true;
  s.phase = 'meeting';
  expect(inf(sp.id, f1.id)).toEqual({ ok: false, reason: 'WRONG_PHASE' });
  expect(s.traces).toEqual([]);
});

test('prototype-key target ids yield TARGET_INVALID', () => {
  const { s, sp } = setup();
  for (const id of ['__proto__', 'constructor', 'toString']) {
    expect(applyIntent(s, sp.id, { t: 'inform', target: id }, ready)).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  }
  expect(applyIntent(s, '__proto__', { t: 'move', dir: { x: 1, y: 0 } }, ready)).toEqual({ ok: false, reason: 'NOT_ALIVE' });
});

test('two spies inform same target in same tick: second is TARGET_INVALID', () => {
  const s = newGame(8, 1, T0);
  const [a, b] = spies(s);
  const f = fighters(s)[0];
  placeAt(s, a.id, { x: 10, y: 10 });
  placeAt(s, b.id, { x: 10, y: 10.4 });
  placeAt(s, f.id, { x: 10.5, y: 10 });
  expect(applyIntent(s, a.id, { t: 'inform', target: f.id }, ready).ok).toBe(true);
  expect(applyIntent(s, b.id, { t: 'inform', target: f.id }, ready)).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  expect(s.traces).toHaveLength(1);
});

test('informed player cannot report or bell: NOT_ALIVE', () => {
  const { s, sp, f1 } = setup();
  applyIntent(s, sp.id, { t: 'inform', target: f1.id }, ready);
  placeAt(s, f1.id, s.traces[0].pos);
  expect(applyIntent(s, f1.id, { t: 'report' }, ready)).toEqual({ ok: false, reason: 'NOT_ALIVE' });
  placeAt(s, f1.id, s.map.bell);
  expect(applyIntent(s, f1.id, { t: 'bell' }, ready)).toEqual({ ok: false, reason: 'NOT_ALIVE' });
  expect(s.phase).toBe('playing');
});

test('report within 1.5 of trace starts meeting; without trace → OUT_OF_RANGE', () => {
  const { s, sp, f1, f2 } = setup();
  expect(applyIntent(s, f2.id, { t: 'report' }, ready)).toEqual({ ok: false, reason: 'OUT_OF_RANGE' });
  applyIntent(s, sp.id, { t: 'inform', target: f1.id }, ready);
  expect(applyIntent(s, f2.id, { t: 'report' }, ready)).toEqual({ ok: false, reason: 'OUT_OF_RANGE' });
  placeAt(s, f2.id, { x: 11.9, y: 10 });
  const r = applyIntent(s, f2.id, { t: 'report' }, ready + 100);
  expect(r).toEqual({ ok: true, events: [{ e: 'meetingStarted', reason: 'report', caller: f2.id }] });
  expect(s.phase).toBe('meeting');
  expect(s.meeting?.reportedVictimId).toBe(f1.id);
  expect(s.publiclyDead).toContain(f1.id);
  expect(applyIntent(s, f2.id, { t: 'report' }, ready + 200)).toEqual({ ok: false, reason: 'WRONG_PHASE' });
});

test('report picks nearest trace', () => {
  const { s, f2 } = setup();
  s.traces.push({ id: 'ta', victimId: 'A', pos: { x: 20.5, y: 20 } }, { id: 'tb', victimId: 'B', pos: { x: 20.1, y: 20 } });
  applyIntent(s, f2.id, { t: 'report' }, ready);
  expect(s.meeting?.reportedVictimId).toBe('B');
});

test('bell: locked before 15s, once per player, range, blocked by active sabotage', () => {
  const { s, f2, f1 } = setup();
  placeAt(s, f2.id, s.map.bell);
  const bell = (id: string, now: number) => applyIntent(s, id, { t: 'bell' }, now);
  expect(bell(f2.id, T0 + 14999)).toEqual({ ok: false, reason: 'LOCKED' });
  s.sabotage = { kind: 'blackout' };
  expect(bell(f2.id, T0 + 15000)).toEqual({ ok: false, reason: 'SABOTAGE_ACTIVE' });
  s.sabotage = null;
  placeAt(s, f2.id, { x: 20, y: 20 });
  expect(bell(f2.id, T0 + 15000)).toEqual({ ok: false, reason: 'OUT_OF_RANGE' });
  placeAt(s, f2.id, s.map.bell);
  expect(f2.bellUsed).toBe(false);
  expect(bell(f2.id, T0 + 15000)).toEqual({ ok: true, events: [{ e: 'meetingStarted', reason: 'bell', caller: f2.id }] });
  expect(f2.bellUsed).toBe(true);
  expect(s.meeting?.reportedVictimId).toBeNull();
  s.phase = 'playing';
  expect(bell(f2.id, T0 + 16000)).toEqual({ ok: false, reason: 'ALREADY_USED' });
  s.phase = 'meeting';
  expect(bell(f1.id, T0 + 16000)).toEqual({ ok: false, reason: 'WRONG_PHASE' });
});
