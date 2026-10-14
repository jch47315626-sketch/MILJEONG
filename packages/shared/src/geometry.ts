import { isWalkable } from './map/map';
import type { MapData, Vec } from './map/types';

export const PLAYER_RADIUS = 0.3;

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function withinRange(a: Vec, b: Vec, r: number): boolean {
  return dist(a, b) <= r;
}

function fits(
  map: MapData,
  x: number,
  y: number,
  blocked: (tx: number, ty: number) => boolean,
): boolean {
  const r = PLAYER_RADIUS;
  for (const [cx, cy] of [
    [x - r, y - r],
    [x + r, y - r],
    [x - r, y + r],
    [x + r, y + r],
  ] as const) {
    if (!isWalkable(map, cx, cy)) return false;
    if (blocked(Math.floor(cx), Math.floor(cy))) return false;
  }
  return true;
}

/** Axis-separated movement; an axis whose move would enter a wall/blocked tile is cancelled. */
export function moveWithCollision(
  map: MapData,
  pos: Vec,
  delta: Vec,
  blocked: (tx: number, ty: number) => boolean,
): Vec {
  let { x, y } = pos;
  if (delta.x !== 0 && fits(map, x + delta.x, y, blocked)) x += delta.x;
  if (delta.y !== 0 && fits(map, x, y + delta.y, blocked)) y += delta.y;
  return { x, y };
}
