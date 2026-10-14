import { assignRoles } from './roles';
import { MAP } from './map/map';
import type { MapData } from './map/types';
import type { Rng } from './rng';
import { assignTasks } from './tasks';
import type { GameConfig } from './config';
import type { GameState, PlayerState } from './types';

export function createGame(
  players: { id: string; name: string }[],
  config: GameConfig,
  rng: Rng,
  now: number,
  map: MapData = MAP,
): GameState {
  const ids = players.map((p) => p.id);
  const roles = assignRoles(ids, rng);
  const out: Record<string, PlayerState> = {};
  players.forEach((p, i) => {
    const role = roles[p.id];
    const spawn = map.spawns[i];
    out[p.id] = {
      id: p.id,
      name: p.name,
      role,
      alive: true,
      left: false,
      connected: true,
      disconnectDeadline: null,
      pos: { x: spawn.x, y: spawn.y },
      dir: { x: 0, y: 0 },
      tasks: role === 'fighter' ? assignTasks(map, rng) : [],
      informReadyAt: now + config.informCooldownMs,
      bellUsed: false,
    };
  });
  return {
    config,
    map,
    phase: 'playing',
    players: out,
    order: ids,
    startedAt: now,
    traces: [],
    sabotage: null,
    sabotageReadyAt: now + config.sabotageCooldownMs,
    meeting: null,
    ejectingEndsAt: null,
    lastEjection: null,
    publiclyDead: [],
    meetingChat: [],
    ghostChat: [],
    winner: null,
    seq: 0,
  };
}
