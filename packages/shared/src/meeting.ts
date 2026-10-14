import { endIfWon } from './win';
import type { Ejection, GameEvent, GameState } from './types';

export function startMeeting(
  state: GameState,
  callerId: string,
  reason: 'report' | 'bell',
  victimId: string | null,
  now: number,
): GameEvent[] {
  let k = 0;
  for (const id of state.order) {
    const p = state.players[id];
    if (!p) continue;
    if (p.alive && !p.left) {
      const sp = state.map.spawns[k++ % state.map.spawns.length];
      p.pos = { x: sp.x, y: sp.y };
      p.dir = { x: 0, y: 0 };
    } else if (!p.alive && !state.publiclyDead.includes(id)) {
      state.publiclyDead.push(id);
    }
  }
  state.traces = [];
  state.sabotage = null;
  state.meetingChat = [];
  state.phase = 'meeting';
  state.meeting = {
    callerId,
    reason,
    reportedVictimId: victimId,
    discussEndsAt: now + state.config.discussMs,
    voteEndsAt: now + state.config.discussMs + state.config.voteMs,
    votes: {},
  };
  return [{ e: 'meetingStarted', reason, caller: callerId }];
}

/** Sole top vote-getter whose count exceeds the skip count (abstentions count as skip), else null. */
export function tallyVotes(votes: Record<string, string>, voterIds: string[]): string | null {
  const counts = new Map<string, number>();
  let skip = 0;
  for (const v of voterIds) {
    const t = Object.hasOwn(votes, v) ? votes[v] : 'skip';
    if (t === 'skip') skip++;
    else counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  let tie = false;
  for (const [id, n] of counts) {
    if (n > bestN) {
      best = id;
      bestN = n;
      tie = false;
    } else if (n === bestN) tie = true;
  }
  return best !== null && !tie && bestN > skip ? best : null;
}

export function resolveMeeting(state: GameState, now: number): GameEvent[] {
  const m = state.meeting;
  if (!m) return [];
  const voters = state.order.filter((id) => {
    const p = state.players[id];
    return p && p.alive && !p.left;
  });
  const id = tallyVotes(m.votes, voters);
  const target = id !== null && Object.hasOwn(state.players, id) ? state.players[id] : undefined;
  let ejection: Ejection = { playerId: null, role: null };
  if (target && target.alive && !target.left) {
    target.alive = false;
    target.dir = { x: 0, y: 0 };
    if (!state.publiclyDead.includes(target.id)) state.publiclyDead.push(target.id);
    ejection = { playerId: target.id, role: state.config.revealRoleOnEject ? target.role : null };
  }
  state.lastEjection = ejection;
  state.phase = 'ejecting';
  state.ejectingEndsAt = now + state.config.ejectingMs;
  state.meeting = null;
  const events: GameEvent[] = [{ e: 'ejected', ejection }];
  events.push(...endIfWon(state));
  return events;
}
