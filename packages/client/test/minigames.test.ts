import { describe, expect, test } from 'vitest';
import { createRng } from '@miljeong/shared';
import { mimeograph } from '../src/minigames/mimeograph';
import { cipher } from '../src/minigames/cipher';
import { funds } from '../src/minigames/funds';
import { flag } from '../src/minigames/flag';
import { telegraph } from '../src/minigames/telegraph';

describe('minigame models', () => {
  test('mimeograph done after 12 taps, not 11', () => {
    const m = mimeograph();
    for (let i = 0; i < 11; i++) m.apply('tap');
    expect(m.done).toBe(false);
    m.apply('tap');
    expect(m.done).toBe(true);
  });

  test('cipher: wrong pair does not progress; all 4 pairs → done', () => {
    const m = cipher(createRng(1));
    expect(m.left).toHaveLength(4);
    expect(m.right).toHaveLength(4);
    const partner = (l: number) => m.right.findIndex((r) => r.pair === m.left[l].pair);
    const wrong = (l: number) => (partner(l) + 1) % 4;
    m.apply({ side: 'left', index: 0 });
    m.apply({ side: 'right', index: wrong(0) });
    expect(m.matched).toBe(0);
    expect(m.done).toBe(false);
    for (let l = 0; l < 4; l++) {
      m.apply({ side: 'left', index: l });
      m.apply({ side: 'right', index: partner(l) });
    }
    expect(m.matched).toBe(4);
    expect(m.done).toBe(true);
  });

  test('funds: exact target → done; overshoot not done until corrected', () => {
    const m = funds(createRng(3));
    expect(m.target % 10).toBe(0);
    expect(m.target).toBeGreaterThanOrEqual(10);
    expect(m.target).toBeLessThanOrEqual(90);
    m.apply({ add: 50 });
    m.apply({ add: 50 });
    expect(m.total).toBe(100);
    expect(m.done).toBe(false);
    m.apply('undo');
    m.apply('undo');
    expect(m.total).toBe(0);
    m.apply('undo'); // nothing to undo
    for (let i = 0; i < m.target / 10; i++) m.apply({ add: 10 });
    expect(m.done).toBe(true);
    const fixed = funds(createRng(3));
    fixed.apply({ add: 50 });
    fixed.apply({ add: 50 });
    fixed.apply('undo');
    expect(fixed.total).toBe(50);
  });

  test('funds: overshoot then undo reaches target', () => {
    const m = funds({ next: () => 0, int: () => 0, shuffle: (a) => [...a] }); // target 10
    expect(m.target).toBe(10);
    m.apply({ add: 50 });
    expect(m.done).toBe(false);
    m.apply('undo');
    m.apply({ add: 10 });
    expect(m.done).toBe(true);
  });

  test('flag: wrong swipe resets progress', () => {
    const m = flag();
    m.apply('up');
    m.apply('right');
    expect(m.progress).toBe(2);
    m.apply('left'); // expected down
    expect(m.progress).toBe(0);
    expect(m.done).toBe(false);
    for (const d of ['up', 'right', 'down', 'left'] as const) m.apply(d);
    expect(m.done).toBe(true);
  });

  test('telegraph: correct pattern → done; wrong symbol resets', () => {
    const m = telegraph(createRng(5));
    expect(m.pattern.length).toBeGreaterThanOrEqual(4);
    expect(m.pattern.length).toBeLessThanOrEqual(5);
    const wrong = m.pattern[0] === 'long' ? 'short' : 'long';
    m.apply(m.pattern[0]);
    m.apply(m.pattern[1] === 'long' ? 'short' : 'long');
    expect(m.progress).toBe(0);
    m.apply(wrong);
    expect(m.progress).toBe(0);
    for (const s of m.pattern) m.apply(s);
    expect(m.done).toBe(true);
  });
});
