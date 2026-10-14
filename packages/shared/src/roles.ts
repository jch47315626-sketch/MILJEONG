import { spyCountFor } from './config';
import type { Rng } from './rng';
import type { Role } from './types';

export function assignRoles(playerIds: string[], rng: Rng): Record<string, Role> {
  const spyCount = spyCountFor(playerIds.length);
  const spies = new Set(rng.shuffle(playerIds).slice(0, spyCount));
  const roles: Record<string, Role> = {};
  for (const id of playerIds) roles[id] = spies.has(id) ? 'spy' : 'fighter';
  return roles;
}
