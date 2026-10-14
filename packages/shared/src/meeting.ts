import type { GameEvent, GameState } from './types';

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
