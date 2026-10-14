import { expect, test } from 'vitest';
import { createRng } from '../src/index';

test('next() stays in [0,1)', () => {
  const rng = createRng(42);
  for (let i = 0; i < 1000; i++) {
    const v = rng.next();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  }
});

test('int(n) stays in [0,n)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = rng.int(5);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(5);
  }
});

test('shuffle keeps elements and does not mutate input', () => {
  const input = [1, 2, 3, 4, 5, 6];
  const out = createRng(3).shuffle(input);
  expect([...out].sort()).toEqual(input);
  expect(input).toEqual([1, 2, 3, 4, 5, 6]);
});

test('same seed yields same sequence', () => {
  const a = createRng(9);
  const b = createRng(9);
  expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
});
