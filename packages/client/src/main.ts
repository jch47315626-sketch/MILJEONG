import './style.css';
import { isUnexpectedLeave, type Connection } from './net';
import { S } from './strings';
import * as title from './ui/title';
import * as lobby from './ui/lobby';
import { renderGame, renderResult } from './ui/placeholder';

export type Screen = 'title' | 'lobby' | 'game' | 'result';

export interface ScreenCtx {
  conn: Connection | null;
  /** message to show on the title screen (e.g. disconnected) */
  notice: string | null;
  /** a connection was established: go to the lobby (or game) */
  enter(conn: Connection): void;
  show(screen: Screen): void;
  /** leave the room voluntarily and return to the title */
  leave(): void;
}

const root = document.getElementById('app')!;
let cleanup: (() => void) | null = null;
let current: Screen | null = null;
let leaving = false;

const ctx: ScreenCtx = {
  conn: null,
  notice: null,
  enter(conn) {
    ctx.conn = conn;
    ctx.notice = null;
    leaving = false;
    conn.onLobby((m) => {
      if (m.phase === 'inGame' && (current === 'lobby' || current === null)) show('game');
      else if (m.phase === 'lobby' && (current === 'game' || current === 'result')) show('lobby');
    });
    conn.onView(() => {
      if (current === 'lobby') show('game');
    });
    conn.onLeave((code) => {
      if (ctx.conn !== conn) return;
      ctx.conn = null;
      ctx.notice = isUnexpectedLeave(code, leaving) ? S.err.disconnected : null;
      show('title');
    });
    show(conn.lastLobby?.phase === 'inGame' || conn.lastView ? 'game' : 'lobby');
  },
  show: (s) => show(s),
  leave() {
    const conn = ctx.conn;
    leaving = true;
    ctx.conn = null;
    ctx.notice = null;
    conn?.leave();
    show('title');
  },
};

const screens: Record<Screen, (root: HTMLElement, ctx: ScreenCtx) => () => void> = {
  title: title.render,
  lobby: lobby.render,
  game: renderGame,
  result: renderResult,
};

export function show(screen: Screen): void {
  cleanup?.();
  current = screen;
  cleanup = screens[screen](root, ctx);
}

show('title');
