import { expect, test } from 'vitest';
import { applyIntent, checkWinner, endIfWon, resolveMeeting, startMeeting, tick } from '../src/index';
import { fighters, newGame, placeAt, spies } from './helpers';

test('checkWinner priority: zero spies beats parity; parity beats gauge', () => {
  const s = newGame(6);
  expect(checkWinner(s)).toBeNull();
  // zero spies AND parity-ish (fighters <= spies impossible with 0 spies); zero spies beats full gauge too
  for (const p of fighters(s)) for (const t of p.tasks) t.done = true;
  for (const sp of spies(s)) sp.alive = false;
  expect(checkWinner(s)).toBe('fighters');
  // parity beats gauge: full gauge but fighters <= spies
  const s2 = newGame(6);
  for (const p of fighters(s2)) for (const t of p.tasks) t.done = true;
  const fs = fighters(s2);
  for (let i = 0; i < fs.length - spies(s2).length; i++) fs[i].alive = false;
  expect(checkWinner(s2)).toBe('spies');
  // left players do not count as alive
  const s3 = newGame(6);
  for (const sp of spies(s3)) sp.left = true;
  expect(checkWinner(s3)).toBe('fighters');
});

test('last inform causing parity ends game with spies', () => {
  const s = newGame(6);
  const sp = spies(s)[0];
  const fs = fighters(s);
  const nSpies = spies(s).length;
  for (let i = 0; i < fs.length - nSpies - 1; i++) fs[i].alive = false;
  const victim = fs[fs.length - 1];
  placeAt(s, sp.id, { x: 20.5, y: 12.5 });
  placeAt(s, victim.id, { x: 20.7, y: 12.5 });
  sp.informReadyAt = 0;
  const r = applyIntent(s, sp.id, { t: 'inform', target: victim.id }, 5000);
  expect(r.ok && r.events.map((e) => e.e)).toEqual(['informed', 'gameEnded']);
  expect(s.phase).toBe('ended');
  expect(s.winner).toBe('spies');
  expect(applyIntent(s, 'p0', { t: 'move', dir: { x: 1, y: 0 } }, 5001)).toEqual({ ok: false, reason: 'WRONG_PHASE' });
});

test('final task completion ends game with fighters', () => {
  const s = newGame(6);
  const f = fighters(s)[0];
  for (const p of fighters(s)) for (const t of p.tasks) t.done = true;
  const last = f.tasks[0];
  last.done = false;
  last.startedAt = 1000;
  const spot = s.map.taskSpots.find((x) => x.id === last.taskId)!;
  placeAt(s, f.id, spot.pos);
  const r = applyIntent(s, f.id, { t: 'taskComplete', taskId: last.taskId }, 10000);
  expect(r.ok && r.events.map((e) => e.e)).toEqual(['taskDone', 'gameEnded']);
  expect(s.phase).toBe('ended');
  expect(s.winner).toBe('fighters');
});

test('ejecting last spy ends game with fighters (phase ended, not ejecting)', () => {
  const s = newGame(6);
  const [only, ...rest] = spies(s);
  for (const r of rest) r.alive = false;
  startMeeting(s, 'p0', 'bell', null, 5000);
  for (const p of Object.values(s.players)) if (p.alive) s.meeting!.votes[p.id] = only.id;
  const ev = resolveMeeting(s, 6000);
  expect(ev.map((e) => e.e)).toEqual(['ejected', 'gameEnded']);
  expect(s.phase).toBe('ended');
  expect(s.winner).toBe('fighters');
  expect(s.meeting).toBeNull();
  expect(s.ejectingEndsAt).toBeNull();
  expect(s.lastEjection?.playerId).toBe(only.id);
});

test('endIfWon never re-ends an ended game', () => {
  const s = newGame(6);
  for (const sp of spies(s)) sp.alive = false;
  expect(endIfWon(s)).toHaveLength(1);
  expect(endIfWon(s)).toEqual([]);
  expect(tick(s, 9999, 50)).toEqual([]);
});
