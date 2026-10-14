import { dist } from './geometry';
import type { Vec } from './map/types';
import { taskGauge } from './tasks';
import type {
  ChatMsg,
  Ejection,
  GameState,
  Phase,
  Role,
  Sabotage,
  TaskAssignment,
  Trace,
} from './types';

export interface PlayerView {
  phase: Phase;
  now: number;
  me: {
    id: string;
    role: Role;
    alive: boolean;
    pos: Vec;
    tasks: TaskAssignment[];
    informReadyAt: number;
    bellUsed: boolean;
    fellowSpies: string[];
  };
  roster: {
    id: string;
    name: string;
    connected: boolean;
    left: boolean;
    publiclyDead: boolean;
    role: Role | null;
  }[];
  visible: { id: string; pos: Vec; ghost: boolean }[];
  traces: Trace[];
  gauge: number;
  sabotage: Sabotage | null;
  /** number for spies, null for everyone else */
  sabotageReadyAt: number | null;
  /**
   * Ghosts see the whole map. Infinity would serialize to null in JSON, so a
   * large finite number (2x the longer map side) is used instead.
   */
  visionRadius: number;
  meeting: null | {
    callerId: string;
    reason: 'report' | 'bell';
    reportedVictimId: string | null;
    discussEndsAt: number;
    voteEndsAt: number;
    /** who has voted; never the targets */
    voted: string[];
  };
  lastEjection: Ejection | null;
  chat: ChatMsg[];
  /** ghosts only, otherwise [] */
  ghostChat: ChatMsg[];
  winner: 'fighters' | 'spies' | null;
  startedAt: number;
}

const copyVec = (v: Vec): Vec => ({ x: v.x, y: v.y });

/**
 * Builds the ONLY data a client may see. Every field is copied explicitly
 * (no spreading of state objects) so new state fields can never leak by accident.
 */
export function viewFor(state: GameState, playerId: string, now: number): PlayerView {
  const me = state.players[playerId];
  if (!me) throw new Error(`viewFor: unknown player ${playerId}`);

  const isGhost = !me.alive && !me.left;
  const isSpy = me.role === 'spy';
  const ended = state.phase === 'ended';
  const blackout = state.sabotage?.kind === 'blackout';

  let visionRadius: number;
  if (isGhost || me.left) visionRadius = Math.max(state.map.width, state.map.height) * 2;
  else if (isSpy) visionRadius = state.config.visionSpy;
  else visionRadius = blackout ? state.config.visionBlackout : state.config.visionFighter;

  const fellowSpies: string[] = [];
  if (isSpy) {
    for (const id of state.order) {
      if (id !== playerId && state.players[id]?.role === 'spy') fellowSpies.push(id);
    }
  }

  const ejection = state.lastEjection;
  const roster = state.order.map((id) => {
    const p = state.players[id];
    let role: Role | null = null;
    if (ended || id === playerId) role = p.role;
    else if (isSpy && p.role === 'spy') role = 'spy';
    else if (ejection && ejection.playerId === id && ejection.role !== null) role = ejection.role;
    return {
      id,
      name: p.name,
      connected: p.connected,
      left: p.left,
      publiclyDead: state.publiclyDead.includes(id),
      role,
    };
  });

  const visible: PlayerView['visible'] = [];
  for (const id of state.order) {
    if (id === playerId) continue;
    const p = state.players[id];
    if (!p || p.left) continue;
    if (isGhost) {
      visible.push({ id, pos: copyVec(p.pos), ghost: !p.alive });
    } else if (p.alive && dist(me.pos, p.pos) <= visionRadius) {
      visible.push({ id, pos: copyVec(p.pos), ghost: false });
    }
  }

  const traces: Trace[] = [];
  for (const t of state.traces) {
    if (isGhost || dist(me.pos, t.pos) <= visionRadius) {
      traces.push({ id: t.id, victimId: t.victimId, pos: copyVec(t.pos) });
    }
  }

  const sab = state.sabotage;
  const sabotage: Sabotage | null = !sab
    ? null
    : sab.kind === 'blackout'
      ? { kind: 'blackout' }
      : { kind: 'checkpoint', passageId: sab.passageId, endsAt: sab.endsAt };

  const m = state.meeting;
  const copyChat = (list: ChatMsg[]): ChatMsg[] =>
    list.map((c) => ({ from: c.from, text: c.text, at: c.at }));

  return {
    phase: state.phase,
    now,
    me: {
      id: me.id,
      role: me.role,
      alive: me.alive,
      pos: copyVec(me.pos),
      tasks: me.tasks.map((t) => ({
        taskId: t.taskId,
        type: t.type,
        done: t.done,
        startedAt: t.startedAt,
      })),
      informReadyAt: me.informReadyAt,
      bellUsed: me.bellUsed,
      fellowSpies,
    },
    roster,
    visible,
    traces,
    gauge: taskGauge(state),
    sabotage,
    sabotageReadyAt: isSpy ? state.sabotageReadyAt : null,
    visionRadius,
    meeting: m
      ? {
          callerId: m.callerId,
          reason: m.reason,
          reportedVictimId: m.reportedVictimId,
          discussEndsAt: m.discussEndsAt,
          voteEndsAt: m.voteEndsAt,
          voted: Object.keys(m.votes),
        }
      : null,
    lastEjection: ejection ? { playerId: ejection.playerId, role: ejection.role } : null,
    chat: copyChat(state.meetingChat),
    ghostChat: isGhost ? copyChat(state.ghostChat) : [],
    winner: state.winner,
    startedAt: state.startedAt,
  };
}
