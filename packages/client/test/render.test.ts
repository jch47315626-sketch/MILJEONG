import { describe, expect, test } from 'vitest';
import { MAP } from '@miljeong/shared';
import { blockedTiles, interpolate, PositionTracker, INTERP_MS, needsVisionOverlay } from '../src/game/render';

describe('interpolate', () => {
  test('lerps and clamps t', () => {
    expect(interpolate({ x: 0, y: 0 }, { x: 10, y: 4 }, 0.5)).toEqual({ x: 5, y: 2 });
    expect(interpolate({ x: 0, y: 0 }, { x: 10, y: 4 }, -1)).toEqual({ x: 0, y: 0 });
    expect(interpolate({ x: 0, y: 0 }, { x: 10, y: 4 }, 2)).toEqual({ x: 10, y: 4 });
  });
});

describe('PositionTracker', () => {
  test('interpolates between the last two views over INTERP_MS', () => {
    const t = new PositionTracker();
    t.update([{ id: 'a', pos: { x: 0, y: 0 } }], 1000);
    expect(t.at('a', 1000)).toEqual({ x: 0, y: 0 }); // first sighting: no jump
    t.update([{ id: 'a', pos: { x: 2, y: 0 } }], 1050);
    expect(t.at('a', 1050)).toEqual({ x: 0, y: 0 });
    expect(t.at('a', 1050 + INTERP_MS / 2)).toEqual({ x: 1, y: 0 });
    expect(t.at('a', 1050 + INTERP_MS * 5)).toEqual({ x: 2, y: 0 });
  });
  test('players that vanish from the list are removed immediately', () => {
    const t = new PositionTracker();
    t.update([{ id: 'a', pos: { x: 1, y: 1 } }, { id: 'b', pos: { x: 2, y: 2 } }], 0);
    t.update([{ id: 'a', pos: { x: 1, y: 1 } }], 50);
    expect(t.at('b', 50)).toBeNull();
    expect(t.ids()).toEqual(['a']);
    t.update([{ id: 'b', pos: { x: 9, y: 9 } }, { id: 'a', pos: { x: 1, y: 1 } }], 100);
    expect(t.at('b', 100)).toEqual({ x: 9, y: 9 }); // reappears at its position, no slide
  });
});

describe('needsVisionOverlay', () => {
  test('ghosts see all: radius at least map size skips the overlay', () => {
    expect(needsVisionOverlay(5, MAP)).toBe(true);
    expect(needsVisionOverlay(Math.max(MAP.width, MAP.height) * 2, MAP)).toBe(false);
  });
});

describe('blockedTiles', () => {
  test('active checkpoint → that passage\'s tiles; otherwise none', () => {
    const p = MAP.passages[0];
    expect(blockedTiles(null, MAP)).toEqual([]);
    expect(blockedTiles({ kind: 'blackout' }, MAP)).toEqual([]);
    expect(blockedTiles({ kind: 'checkpoint', passageId: p.id, endsAt: 1 }, MAP)).toEqual(p.tiles);
    expect(blockedTiles({ kind: 'checkpoint', passageId: 'nope', endsAt: 1 }, MAP)).toEqual([]);
  });
});
