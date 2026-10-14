import { Client, type Room } from '@colyseus/sdk';
import type { GameEvent, Intent, PlayerView, RejectReason } from '@miljeong/shared';
import { S } from './strings';

export interface LobbyPlayer {
  id: string;
  name: string;
}
export interface LobbyMsg {
  code: string;
  hostId: string;
  players: LobbyPlayer[];
  phase: 'lobby' | 'inGame';
}
export type RoomErrorCode = 'NOT_HOST' | 'NOT_ENOUGH_PLAYERS' | 'CHAT_RATE';

export const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 6;
export const NAME_MAX_LEN = 12;

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LEN && [...code].every((c) => ROOM_CODE_CHARS.includes(c));
}

export function validNickname(raw: string): string | null {
  const name = raw.trim();
  const len = Array.from(name).length;
  return len >= 1 && len <= NAME_MAX_LEN ? name : null;
}

/** Maps a create/join failure from the SDK to a Korean message. */
export function joinErrorMessage(err: unknown): string {
  const e = (typeof err === 'object' && err !== null ? err : {}) as { code?: unknown; message?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  if (message === 'ROOM_STARTED') return S.err.roomStarted;
  if (message === 'BAD_NAME') return S.err.badName;
  if (e.code === 522 && message.endsWith('not found')) return S.err.roomNotFound;
  if (e.code === 522 && message.endsWith('is locked')) return S.err.roomFull;
  return S.err.generic;
}

/** A leave is unexpected unless we initiated it or the close code is the normal 1000. */
export function isUnexpectedLeave(code: number, selfInitiated: boolean): boolean {
  return !selfInitiated && code !== 1000;
}

export function serverUrl(): string {
  return import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`;
}

type Cb<T> = (msg: T) => void;

/** Iterates a copy: a callback may unsubscribe (splice) while the list is being walked. */
function emit<T>(list: Cb<T>[], msg: T): void {
  for (const cb of [...list]) cb(msg);
}

export class Connection {
  readonly code: string;
  readonly myId: string;
  private lobbyCbs: Cb<LobbyMsg>[] = [];
  private viewCbs: Cb<PlayerView>[] = [];
  private eventsCbs: Cb<GameEvent[]>[] = [];
  private rejectedCbs: Cb<{ reason: RejectReason }>[] = [];
  private errorCbs: Cb<{ code: RoomErrorCode }>[] = [];
  private leaveCbs: Cb<number>[] = [];
  /** latest messages, so a screen mounted later can render immediately */
  lastLobby: LobbyMsg | null = null;
  lastView: PlayerView | null = null;

  private constructor(private readonly room: Room) {
    this.code = room.roomId;
    this.myId = room.sessionId;
    // register synchronously, before anything is awaited, so no early message is lost
    room.onMessage('lobby', (m: LobbyMsg) => {
      this.lastLobby = m;
      emit(this.lobbyCbs, m);
    });
    room.onMessage('view', (m: PlayerView) => {
      this.lastView = m;
      emit(this.viewCbs, m);
    });
    room.onMessage('events', (m: GameEvent[]) => emit(this.eventsCbs, m));
    room.onMessage('rejected', (m: { reason: RejectReason }) => emit(this.rejectedCbs, m));
    room.onMessage('error', (m: { code: RoomErrorCode }) => emit(this.errorCbs, m));
    room.onLeave((code: number) => emit(this.leaveCbs, code));
  }

  private static client(): Client {
    return new Client(serverUrl());
  }

  static async create(name: string): Promise<Connection> {
    return new Connection(await Connection.client().create('game', { name }));
  }

  static async join(code: string, name: string): Promise<Connection> {
    return new Connection(await Connection.client().joinById(normalizeCode(code), { name }));
  }

  private sub<T>(list: Cb<T>[], cb: Cb<T>): () => void {
    list.push(cb);
    return () => {
      const i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /** Every onX returns an unsubscribe function; screens call it in their cleanup. */
  onLobby(cb: Cb<LobbyMsg>): () => void {
    return this.sub(this.lobbyCbs, cb);
  }
  onView(cb: Cb<PlayerView>): () => void {
    return this.sub(this.viewCbs, cb);
  }
  onEvents(cb: Cb<GameEvent[]>): () => void {
    return this.sub(this.eventsCbs, cb);
  }
  onRejected(cb: Cb<{ reason: RejectReason }>): () => void {
    return this.sub(this.rejectedCbs, cb);
  }
  onError(cb: Cb<{ code: RoomErrorCode }>): () => void {
    return this.sub(this.errorCbs, cb);
  }
  /** `code` is the WebSocket close code; 1000 is a normal (consented) close. */
  onLeave(cb: Cb<number>): () => void {
    return this.sub(this.leaveCbs, cb);
  }

  start(): void {
    this.room.send('start');
  }
  send(intent: Intent): void {
    this.room.send('intent', intent);
  }
  backToLobby(): void {
    this.room.send('backToLobby');
  }
  leave(): void {
    void this.room.leave(true);
  }
}
