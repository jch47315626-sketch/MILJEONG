import { describe, expect, test } from 'vitest';
import { DEFAULT_CONFIG, MAP, isWalkable, zoneAt, dist } from '../src/index';
import type { MapData, TaskType, Vec } from '../src/index';

const zoneIdByName = (name: string): string => {
  const z = MAP.zones.find((q) => q.name === name);
  if (!z) throw new Error(`no zone ${name}`);
  return z.id;
};

function bfs(map: MapData, start: Vec, extraBlocked: Set<string> = new Set()): Set<string> {
  const seen = new Set<string>();
  const sx = Math.floor(start.x), sy = Math.floor(start.y);
  const q: [number, number][] = [[sx, sy]];
  seen.add(`${sx},${sy}`);
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (seen.has(k) || extraBlocked.has(k) || !isWalkable(map, nx, ny)) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return seen;
}
const key = (p: Vec) => `${Math.floor(p.x)},${Math.floor(p.y)}`;

describe('map', () => {
  test('map has the 8 zones from spec', () => {
    expect(MAP.zones.map((z) => z.name).sort()).toEqual(
      ['골목', '다방', '서점 뒷방', '인쇄소', '전신국', '전차 정류장', '지하 창고', '한약방'].sort());
  });
  test('tiles match width/height', () => {
    expect(MAP.tiles).toHaveLength(MAP.height);
    for (const r of MAP.tiles) expect(r).toHaveLength(MAP.width);
  });
  test('10 spawns in 서점 뒷방, bell in 서점 뒷방, breaker in 전신국', () => {
    expect(MAP.spawns).toHaveLength(10);
    for (const s of MAP.spawns) {
      expect(zoneAt(MAP, s)).toBe(zoneIdByName('서점 뒷방'));
      expect(isWalkable(MAP, s.x, s.y)).toBe(true);
    }
    expect(zoneAt(MAP, MAP.bell)).toBe(zoneIdByName('서점 뒷방'));
    expect(zoneAt(MAP, MAP.breaker)).toBe(zoneIdByName('전신국'));
  });
  test('every spawn is within bellRange of the bell', () => {
    for (const s of MAP.spawns) expect(dist(s, MAP.bell)).toBeLessThanOrEqual(DEFAULT_CONFIG.bellRange);
  });
  test('each task type has >=2 spots in different zones, on walkable tiles', () => {
    const types: TaskType[] = ['mimeograph', 'cipher', 'funds', 'flag', 'telegraph'];
    for (const t of types) {
      const spots = MAP.taskSpots.filter((s) => s.type === t);
      expect(spots.length).toBeGreaterThanOrEqual(2);
      expect(new Set(spots.map((s) => zoneAt(MAP, s.pos))).size).toBeGreaterThanOrEqual(2);
      for (const s of spots) expect(isWalkable(MAP, s.pos.x, s.pos.y)).toBe(true);
    }
  });
  test('>=3 passages, each tile walkable', () => {
    expect(MAP.passages.length).toBeGreaterThanOrEqual(3);
    for (const p of MAP.passages) for (const t of p.tiles) expect(isWalkable(MAP, t.x, t.y)).toBe(true);
  });
  test('every spot, bell, breaker reachable from spawn by BFS over walkable tiles', () => {
    const seen = bfs(MAP, MAP.spawns[0]);
    for (const p of [MAP.bell, MAP.breaker, ...MAP.spawns, ...MAP.taskSpots.map((s) => s.pos)])
      expect(seen.has(key(p))).toBe(true);
  });
  test('blocking any single passage still leaves every zone reachable (no soft-lock)', () => {
    for (const p of MAP.passages) {
      const seen = bfs(MAP, MAP.spawns[0], new Set(p.tiles.map(key)));
      for (const z of MAP.zones) {
        const c = { x: z.rect.x + 0.5, y: z.rect.y + 0.5 };
        expect(seen.has(key(c)), `${z.id} unreachable when ${p.id} blocked`).toBe(true);
      }
      for (const s of MAP.taskSpots) expect(seen.has(key(s.pos))).toBe(true);
      expect(seen.has(key(MAP.breaker))).toBe(true);
    }
  });
});
