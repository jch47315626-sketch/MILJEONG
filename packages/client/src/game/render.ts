import type { MapData, Sabotage, Vec } from '@miljeong/shared';

/**
 * All art lives here (placeholder palette) so it can be swapped later.
 * No phaser import: this module is unit-tested under jsdom.
 */
export const TILE = 32;
export const INTERP_MS = 50;

export const COLORS = {
  background: 0x0b0906,
  floor: 0x4a3b2a,
  floorAlt: 0x52422f,
  wall: 0x1c1610,
  zoneLabel: '#c9b48a',
  taskActive: 0xe8b04a,
  taskDim: 0x7a6a4c,
  bell: 0xd9d2c0,
  breaker: 0x6fb7e8,
  trace: 0xc0392b,
  me: 0xf2e6c8,
  other: 0xb8c4d6,
  spyMate: 0xff7a7a,
  ghost: 0x9ad0ff,
  outline: 0x000000,
  name: '#eef0f4',
  overlay: 0x000000,
  overlayAlpha: 0.92,
  blackoutTint: 0x000010,
  checkpoint: 0xc0392b,
} as const;

export const PLAYER_DRAW_RADIUS = 0.35 * TILE;

export function interpolate(prev: Vec, next: Vec, t: number): Vec {
  const k = Math.min(1, Math.max(0, t));
  return { x: prev.x + (next.x - prev.x) * k, y: prev.y + (next.y - prev.y) * k };
}

/** Ghosts get a radius of twice the longer map side; no darkness is drawn then. */
export function needsVisionOverlay(visionRadius: number, map: MapData): boolean {
  return visionRadius < Math.max(map.width, map.height);
}

/** Tiles of the passage closed by an active checkpoint (drawn as blocked), else none. */
export function blockedTiles(sab: Sabotage | null, map: MapData): Vec[] {
  if (!sab || sab.kind !== 'checkpoint') return [];
  return map.passages.find((p) => p.id === sab.passageId)?.tiles ?? [];
}

/**
 * Keeps the previous and current server position per id and interpolates between them
 * over INTERP_MS. Ids missing from an update are dropped immediately.
 */
export class PositionTracker {
  private prev = new Map<string, Vec>();
  private cur = new Map<string, Vec>();
  private stamp = 0;

  update(list: { id: string; pos: Vec }[], nowMs: number): void {
    const nextPrev = new Map<string, Vec>();
    const nextCur = new Map<string, Vec>();
    for (const { id, pos } of list) {
      nextPrev.set(id, this.cur.get(id) ?? { x: pos.x, y: pos.y });
      nextCur.set(id, { x: pos.x, y: pos.y });
    }
    this.prev = nextPrev;
    this.cur = nextCur;
    this.stamp = nowMs;
  }

  at(id: string, nowMs: number): Vec | null {
    const c = this.cur.get(id);
    const p = this.prev.get(id);
    if (!c || !p) return null;
    return interpolate(p, c, (nowMs - this.stamp) / INTERP_MS);
  }

  ids(): string[] {
    return [...this.cur.keys()];
  }
}
