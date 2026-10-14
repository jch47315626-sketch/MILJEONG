import data from './gyeongseong.json';
import type { MapData, Vec } from './types';

export type { MapData, TaskType, Vec } from './types';

export const MAP: MapData = data as MapData;

/** Tile-coordinate walkability; (x, y) are floored to a tile. */
export function isWalkable(map: MapData, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  return map.tiles[ty]?.[tx] === '.';
}

export function zoneAt(map: MapData, pos: Vec): string | null {
  for (const z of map.zones) {
    const { x, y, w, h } = z.rect;
    if (pos.x >= x && pos.x < x + w && pos.y >= y && pos.y < y + h) return z.id;
  }
  return null;
}
