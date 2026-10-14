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

export function serverUrl(): string {
  return import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`;
}

type Cb<T> = (msg: T) => void;

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
      this.lobbyCbs.forEach((cb) => cb(m));
    });
    room.onMessage('view', (m: PlayerView) => {
      this.lastView = m;
      this.viewCbs.forEach((cb) => cb(m));
    });
    room.onMessage('events', (m: GameEvent[]) => this.eventsCbs.forEach((cb) => cb(m)));
    room.onMessage('rejected', (m: { reason: RejectReason }) => this.rejectedCbs.forEach((cb) => cb(m)));
    room.onMessage('error', (m: { code: RoomErrorCode }) => this.errorCbs.forEach((cb) => cb(m)));
    room.onLeave((code: number) => this.leaveCbs.forEach((cb) => cb(code)));
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

  onLobby(cb: Cb<LobbyMsg>): void {
    this.lobbyCbs.push(cb);
  }
  onView(cb: Cb<PlayerView>): void {
    this.viewCbs.push(cb);
  }
  onEvents(cb: Cb<GameEvent[]>): void {
    this.eventsCbs.push(cb);
  }
  onRejected(cb: Cb<{ reason: RejectReason }>): void {
    this.rejectedCbs.push(cb);
  }
  onError(cb: Cb<{ code: RoomErrorCode }>): void {
    this.errorCbs.push(cb);
  }
  /** `code` is the WebSocket close code; 1000 is a normal (consented) close. */
  onLeave(cb: Cb<number>): void {
    this.leaveCbs.push(cb);
  }

  /** Remove all screen-level listeners (keeps the room's own handlers). */
  clearListeners(): void {
    this.lobbyCbs = [];
    this.viewCbs = [];
    this.eventsCbs = [];
    this.rejectedCbs = [];
    this.errorCbs = [];
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
