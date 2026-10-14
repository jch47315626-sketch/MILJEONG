import type { GameConfig } from './config';
import type { MapData, TaskType, Vec } from './map/types';

export type Role = 'fighter' | 'spy';

export type Phase = 'playing' | 'meeting' | 'ejecting' | 'ended';

export interface TaskAssignment {
  /** task spot id */
  taskId: string;
  type: TaskType;
  done: boolean;
  startedAt: number | null;
}

export interface PlayerState {
  id: string;
  name: string;
  role: Role;
  alive: boolean;
  left: boolean;
  connected: boolean;
  disconnectDeadline: number | null;
  pos: Vec;
  dir: Vec;
  tasks: TaskAssignment[];
  informReadyAt: number;
  bellUsed: boolean;
}

export interface Trace {
  id: string;
  victimId: string;
  pos: Vec;
}

export type Sabotage =
  | { kind: 'blackout' }
  | { kind: 'checkpoint'; passageId: string; endsAt: number };

export interface Meeting {
  callerId: string;
  reason: 'report' | 'bell';
  reportedVictimId: string | null;
  discussEndsAt: number;
  voteEndsAt: number;
  /** voterId -> playerId | 'skip' */
  votes: Record<string, string>;
}

export interface ChatMsg {
  from: string;
  text: string;
  at: number;
}

export interface Ejection {
  playerId: string | null;
  /** null when revealRoleOnEject is off */
  role: Role | null;
}

export interface GameState {
  config: GameConfig;
  map: MapData;
  phase: Phase;
  players: Record<string, PlayerState>;
  /** player ids in join order */
  order: string[];
  startedAt: number;
  traces: Trace[];
  sabotage: Sabotage | null;
  sabotageReadyAt: number;
  meeting: Meeting | null;
  ejectingEndsAt: number | null;
  lastEjection: Ejection | null;
  publiclyDead: string[];
  meetingChat: ChatMsg[];
  ghostChat: ChatMsg[];
  winner: 'fighters' | 'spies' | null;
  /** counter for id generation */
  seq: number;
}

export type Intent =
  | { t: 'move'; dir: Vec }
  | { t: 'taskStart'; taskId: string }
  | { t: 'taskComplete'; taskId: string }
  | { t: 'inform'; target: string }
  | { t: 'report' }
  | { t: 'bell' }
  | { t: 'sabotage'; kind: 'blackout' }
  | { t: 'sabotage'; kind: 'checkpoint'; passageId: string }
  | { t: 'fixBreaker' }
  | { t: 'vote'; target: string }
  | { t: 'chat'; text: string };

export type RejectReason =
  | 'WRONG_PHASE'
  | 'NOT_ALIVE'
  | 'WRONG_ROLE'
  | 'OUT_OF_RANGE'
  | 'COOLDOWN'
  | 'TARGET_INVALID'
  | 'ALREADY_USED'
  | 'LOCKED'
  | 'SABOTAGE_ACTIVE'
  | 'NOT_STARTED'
  | 'TOO_FAST'
  | 'BAD_INPUT';

export type GameEvent =
  | { e: 'informed'; victim: string }
  | { e: 'meetingStarted'; reason: 'report' | 'bell'; caller: string }
  | { e: 'ejected'; ejection: Ejection }
  | { e: 'sabotageStarted'; kind: 'blackout' | 'checkpoint' }
  | { e: 'sabotageEnded' }
  | { e: 'taskDone'; player: string }
  | { e: 'gameEnded'; winner: 'fighters' | 'spies' };

export type ApplyResult = { ok: true; events: GameEvent[] } | { ok: false; reason: RejectReason };
