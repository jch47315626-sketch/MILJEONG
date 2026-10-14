import { CloseCode, Room, ServerError, type Client } from '@colyseus/core';
import {
  DEFAULT_CONFIG,
  FAST_CONFIG,
  applyIntent,
  createGame,
  createRng,
  markDisconnected,
  markLeft,
  markReconnected,
  tick,
  viewFor,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Intent,
  type RejectReason,
} from '@miljeong/shared';
import { generateRoomCode } from './roomCode';

// ---- protocol ---------------------------------------------------------------

export interface LobbyPlayer {
  id: string;
  name: string;
}

/** server → client `'lobby'`: broadcast whenever the lobby or the host changes. */
export interface LobbyMsg {
  code: string;
  hostId: string;
  players: LobbyPlayer[];
  phase: 'lobby' | 'inGame';
}

/** server → client `'error'`. */
export type RoomErrorCode = 'NOT_HOST' | 'NOT_ENOUGH_PLAYERS' | 'CHAT_RATE';

/** server → client `'rejected'`. */
export interface RejectedMsg {
  reason: RejectReason;
}

/** Join failures thrown from onAuth/onJoin (`ServerError.code` / `.message`). */
export const JOIN_ERROR = {
  BAD_NAME: { code: 4100, message: 'BAD_NAME' },
  ROOM_STARTED: { code: 4101, message: 'ROOM_STARTED' },
} as const;

export const NAME_MAX_LEN = 12;
export const TICK_MS = 50;

/** Room options set by the server (`define('game', GameRoom, { configName })`). */
export interface GameRoomDefineOptions {
  configName?: 'default' | 'fast';
}

/** Trimmed name if it is 1..12 characters, else null. */
export function validName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  const len = Array.from(name).length;
  return len >= 1 && len <= NAME_MAX_LEN ? name : null;
}

/** Codes of rooms alive in this process (uniqueness of room codes). */
const activeCodes = new Set<string>();

type Reconnection = ReturnType<Room['allowReconnection']>;

// ---- room -------------------------------------------------------------------

export class GameRoom extends Room {
  /** Authoritative game state; null while in the lobby. Public for tests only. */
  game: GameState | null = null;
  config: GameConfig = DEFAULT_CONFIG;

  private code = '';
  /** lobby members in join order (also kept during a game, for backToLobby) */
  private lobby: LobbyPlayer[] = [];
  private hostId = '';
  private lastChatAt = new Map<string, number>();
  private lastTickAt = 0;
  private reconnections = new Map<string, Reconnection>();
  private crashed = false;

  /**
   * Note: the creator's name is validated in onAuth like every other join (a
   * ServerError thrown here would be sent as an HTTP status, which must be < 600).
   * A room whose creator is rejected is disposed automatically once empty.
   */
  onCreate(options: GameRoomDefineOptions): void {
    this.config = options?.configName === 'fast' ? FAST_CONFIG : DEFAULT_CONFIG;
    this.maxClients = this.config.maxPlayers;

    let code = generateRoomCode();
    while (activeCodes.has(code)) code = generateRoomCode();
    activeCodes.add(code);
    this.code = code;
    this.roomId = code;

    this.onMessage('start', (client) => this.guard(() => this.handleStart(client)));
    this.onMessage('intent', (client, msg: unknown) => this.guard(() => this.handleIntent(client, msg)));
    this.onMessage('backToLobby', (client) => this.guard(() => this.handleBackToLobby(client)));
    this.setSimulationInterval(() => this.guard(() => this.step()), TICK_MS);
  }

  onAuth(_client: Client, options: { name?: unknown } | undefined): { name: string } {
    if (this.game) throw new ServerError(JOIN_ERROR.ROOM_STARTED.code, JOIN_ERROR.ROOM_STARTED.message);
    const name = validName(options?.name);
    if (name === null) throw new ServerError(JOIN_ERROR.BAD_NAME.code, JOIN_ERROR.BAD_NAME.message);
    return { name };
  }

  onJoin(client: Client): void {
    if (this.game) throw new ServerError(JOIN_ERROR.ROOM_STARTED.code, JOIN_ERROR.ROOM_STARTED.message);
    const name = (client.auth as { name: string }).name;
    this.lobby.push({ id: client.sessionId, name });
    if (!this.hostId) this.hostId = client.sessionId;
    this.broadcastLobby();
  }

  /** Non-consented disconnect. In a game: keep the character for the grace period. */
  onDrop(client: Client): void {
    this.guard(() => this.handleDrop(client));
  }

  onReconnect(client: Client): void {
    this.guard(() => this.handleReconnect(client));
  }

  /** Effective leave: consented leave, failed reconnection, or a lobby drop. */
  onLeave(client: Client): void {
    this.guard(() => this.handleLeave(client));
  }

  onDispose(): void {
    activeCodes.delete(this.code);
  }

  // ---- handlers -------------------------------------------------------------

  private handleDrop(client: Client): void {
    const id = client.sessionId;
    const p = this.game && Object.hasOwn(this.game.players, id) ? this.game.players[id] : undefined;
    if (!this.game || !p || p.left) return; // lobby: onLeave follows
    markDisconnected(this.game, id, Date.now());
    const r = this.allowReconnection(client, this.config.reconnectGraceMs / 1000);
    // failure is handled by onLeave (called by Colyseus when the reconnection fails)
    Promise.resolve(r).catch(() => {});
    // allowReconnection returns a plain rejected Promise while disposing
    if (typeof (r as Partial<Reconnection>).reject === 'function') this.reconnections.set(id, r);
  }

  private handleReconnect(client: Client): void {
    const id = client.sessionId;
    this.reconnections.delete(id);
    if (this.game) markReconnected(this.game, id);
    client.send('lobby', this.lobbyMsg());
  }

  private handleLeave(client: Client): void {
    const id = client.sessionId;
    this.reconnections.delete(id);
    this.lastChatAt.delete(id);
    if (this.game) {
      if (Object.hasOwn(this.game.players, id)) {
        this.broadcastEvents(markLeft(this.game, id, Date.now()));
      }
      this.syncHost();
      return;
    }
    const before = this.lobby.length;
    this.lobby = this.lobby.filter((p) => p.id !== id);
    if (this.hostId === id) this.hostId = this.lobby[0]?.id ?? '';
    if (this.lobby.length !== before) this.broadcastLobby();
  }

  private handleStart(client: Client): void {
    if (this.game) return;
    if (client.sessionId !== this.hostId) return this.sendError(client, 'NOT_HOST');
    if (this.lobby.length < this.config.minPlayers) return this.sendError(client, 'NOT_ENOUGH_PLAYERS');
    const now = Date.now();
    this.game = createGame(
      this.lobby.map((p) => ({ id: p.id, name: p.name })),
      this.config,
      createRng(now),
      now,
    );
    this.lastTickAt = now;
    this.lastChatAt.clear();
    this.broadcastLobby();
  }

  private handleIntent(client: Client, msg: unknown): void {
    const id = client.sessionId;
    if (!this.game || !Object.hasOwn(this.game.players, id)) {
      return this.sendRejected(client, 'NOT_STARTED');
    }
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
      return this.sendRejected(client, 'BAD_INPUT');
    }
    const intent = msg as Intent;
    const now = Date.now();
    const isChat = intent.t === 'chat';
    if (isChat) {
      const last = this.lastChatAt.get(id);
      if (last !== undefined && now - last < this.config.chatMinIntervalMs) {
        return this.sendError(client, 'CHAT_RATE');
      }
    }
    const res = applyIntent(this.game, id, intent, now);
    if (!res.ok) return this.sendRejected(client, res.reason);
    if (isChat) this.lastChatAt.set(id, now);
    this.broadcastEvents(res.events);
    this.syncHost();
  }

  private handleBackToLobby(client: Client): void {
    const game = this.game;
    if (!game || game.phase !== 'ended') return;
    if (client.sessionId !== this.hostId) return this.sendError(client, 'NOT_HOST');
    const stays = (id: string): boolean => {
      const p = Object.hasOwn(game.players, id) ? game.players[id] : undefined;
      return !!p && !p.left && p.connected && this.clients.getById(id) !== undefined;
    };
    this.lobby = this.lobby.filter((p) => stays(p.id));
    // players still waiting to reconnect are dropped from the room for good
    for (const [id, r] of this.reconnections) {
      if (!stays(id)) r.reject(new Error('back to lobby'));
    }
    this.game = null;
    this.lastChatAt.clear();
    if (!this.lobby.some((p) => p.id === this.hostId)) this.hostId = this.lobby[0]?.id ?? '';
    this.broadcastLobby();
  }

  /** One server tick: simulate, broadcast events, send each player their view. */
  private step(): void {
    const game = this.game;
    if (!game) return;
    const now = Date.now();
    const dt = now - this.lastTickAt;
    this.lastTickAt = now;
    this.broadcastEvents(tick(game, now, dt));
    this.syncHost();
    // players marked left by the tick deadline cannot come back
    for (const [id, r] of this.reconnections) {
      if (game.players[id]?.left) r.reject(new Error('left'));
    }
    for (const client of this.clients) {
      if (Object.hasOwn(game.players, client.sessionId)) {
        client.send('view', viewFor(game, client.sessionId, now));
      }
    }
  }

  // ---- helpers --------------------------------------------------------------

  /** In a game, a host who has left hands over to the earliest player still in it. */
  private syncHost(): void {
    const game = this.game;
    if (!game) return;
    const isIn = (id: string) => Object.hasOwn(game.players, id) && !game.players[id].left;
    if (isIn(this.hostId)) return;
    const next = this.lobby.find((p) => isIn(p.id));
    if (next && next.id !== this.hostId) {
      this.hostId = next.id;
      this.broadcastLobby();
    }
  }

  /**
   * Event routing (information hiding):
   * - `informed` → only the spies and the victim;
   * - `taskDone` → only the player who did it (only fighters can do tasks, so
   *   broadcasting it would reveal a role; the gauge reaches everyone via `view`);
   * - everything else → everyone.
   */
  private broadcastEvents(events: GameEvent[]): void {
    if (events.length === 0) return;
    const game = this.game;
    for (const client of this.clients) {
      const id = client.sessionId;
      const isSpy = !!game && Object.hasOwn(game.players, id) && game.players[id].role === 'spy';
      const mine = events.filter((e) => {
        if (e.e === 'informed') return isSpy || e.victim === id;
        if (e.e === 'taskDone') return e.player === id;
        return true;
      });
      if (mine.length > 0) client.send('events', mine);
    }
  }

  private lobbyMsg(): LobbyMsg {
    return {
      code: this.code,
      hostId: this.hostId,
      players: this.lobby.map((p) => ({ id: p.id, name: p.name })),
      phase: this.game ? 'inGame' : 'lobby',
    };
  }

  private broadcastLobby(): void {
    this.broadcast('lobby', this.lobbyMsg());
  }

  private sendError(client: Client, code: RoomErrorCode): void {
    client.send('error', { code });
  }

  private sendRejected(client: Client, reason: RejectReason): void {
    client.send('rejected', { reason } satisfies RejectedMsg);
  }

  /** Spec 3.7: an exception closes only this room. */
  private guard(fn: () => void): void {
    if (this.crashed) return;
    try {
      fn();
    } catch (err) {
      this.crashed = true;
      console.error(`[GameRoom ${this.roomId}] unexpected error, closing room`, err);
      this.disconnect(CloseCode.WITH_ERROR).catch((e: unknown) => {
        console.error(`[GameRoom ${this.roomId}] disconnect failed`, e);
      });
    }
  }
}
