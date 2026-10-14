import { expect, test } from 'vitest';
import { DEFAULT_CONFIG, createGame, createRng } from '../src/index';
import { fighters, players, spies } from './helpers';

test('createGame: roles, 5 tasks of distinct types for fighters, spawns, cooldowns', () => {
  const s = createGame(players(6), DEFAULT_CONFIG, createRng(1), 1000);
  expect(spies(s)).toHaveLength(1);
  for (const p of fighters(s)) expect(new Set(p.tasks.map((t) => t.type)).size).toBe(5);
  for (const p of spies(s)) expect(p.tasks).toEqual([]);
  expect(Object.values(s.players).every((p) => p.informReadyAt === 31000)).toBe(true);
  expect(s.sabotageReadyAt).toBe(41000);
  expect(s.phase).toBe('playing');
  expect(s.seq).toBe(0);
  expect(s.order).toEqual(players(6).map((p) => p.id));
  s.order.forEach((id, i) => expect(s.players[id].pos).toEqual(s.map.spawns[i]));
});

test('createGame is deterministic per seed', () => {
  const a = createGame(players(8), DEFAULT_CONFIG, createRng(7), 0);
  const b = createGame(players(8), DEFAULT_CONFIG, createRng(7), 0);
  expect(a).toEqual(b);
});
