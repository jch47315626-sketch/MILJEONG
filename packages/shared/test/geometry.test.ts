import { describe, expect, test } from 'vitest';
import { MAP, dist, moveWithCollision, withinRange } from '../src/index';
import type { MapData } from '../src/index';

const room: MapData = {
  ...MAP, width: 6, height: 6,
  tiles: ['######', '#....#', '#....#', '#....#', '#....#', '######'],
};
const none = () => false;

describe('geometry', () => {
  test('moveWithCollision moves freely in open space', () => {
    expect(moveWithCollision(room, { x: 2.5, y: 2.5 }, { x: 0.5, y: 0.25 }, none)).toEqual({ x: 3, y: 2.75 });
  });
  test('moveWithCollision stops at wall but slides along it', () => {
    // wall to the west at x=1; radius 0.3 => min x 1.3
    const r = moveWithCollision(room, { x: 1.4, y: 2.5 }, { x: -0.5, y: 0.5 }, none);
    expect(r.x).toBe(1.4);
    expect(r.y).toBe(3);
  });
  test('moveWithCollision respects blocked() callback', () => {
    const blocked = (tx: number, ty: number) => tx === 3 && ty === 2;
    const r = moveWithCollision(room, { x: 2.5, y: 2.5 }, { x: 0.5, y: 0 }, blocked);
    expect(r).toEqual({ x: 2.5, y: 2.5 });
  });
  test('corners are checked (cannot clip a diagonal wall corner)', () => {
    const r = moveWithCollision(room, { x: 1.4, y: 1.4 }, { x: 0, y: -0.2 }, none);
    expect(r.y).toBe(1.4);
  });
  test('dist', () => expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5));
  test('withinRange inclusive at exactly r', () => {
    expect(withinRange({ x: 0, y: 0 }, { x: 1.5, y: 0 }, 1.5)).toBe(true);
    expect(withinRange({ x: 0, y: 0 }, { x: 1.51, y: 0 }, 1.5)).toBe(false);
  });
});
