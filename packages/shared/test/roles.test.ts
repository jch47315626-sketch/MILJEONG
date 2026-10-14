import { expect, test } from 'vitest';
import { assignRoles, createRng, spyCountFor } from '../src/index';

test('spyCountFor', () => {
  expect([4, 5, 6].map(spyCountFor)).toEqual([1, 1, 1]);
  expect([7, 8, 9, 10].map(spyCountFor)).toEqual([2, 2, 2, 2]);
});

test('assignRoles gives exact spy count and covers all ids', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const r = assignRoles(ids, createRng(1));
  expect(Object.keys(r).sort()).toEqual(ids);
  expect(Object.values(r).filter((x) => x === 'spy')).toHaveLength(2);
});

test('assignRoles is deterministic per seed and varies across seeds', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  expect(assignRoles(ids, createRng(5))).toEqual(assignRoles(ids, createRng(5)));
  const spies = new Set(
    Array.from({ length: 30 }, (_, s) =>
      Object.entries(assignRoles(ids, createRng(s))).find(([, v]) => v === 'spy')![0],
    ),
  );
  expect(spies.size).toBeGreaterThan(3);
});
