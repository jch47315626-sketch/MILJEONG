import type { MapData, TaskType } from './map/types';
import type { Rng } from './rng';
import type { GameState, TaskAssignment } from './types';

/** One task of every type, each at a random spot of that type. */
export function assignTasks(map: MapData, rng: Rng): TaskAssignment[] {
  const types: TaskType[] = [];
  for (const s of map.taskSpots) if (!types.includes(s.type)) types.push(s.type);
  return types.map((type) => {
    const spots = map.taskSpots.filter((s) => s.type === type);
    const spot = spots[rng.int(spots.length)];
    return { taskId: spot.id, type, done: false, startedAt: null };
  });
}

/** Task progress 0..1; denominator counts tasks of players who have not left. */
export function taskGauge(state: GameState): number {
  let total = 0;
  let done = 0;
  for (const p of Object.values(state.players)) {
    if (p.left) continue;
    for (const t of p.tasks) {
      total++;
      if (t.done) done++;
    }
  }
  return total === 0 ? 0 : done / total;
}
