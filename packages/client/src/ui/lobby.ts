import type { LobbyMsg } from '../net';
import { S } from '../strings';
import { el } from './dom';
import type { ScreenCtx } from '../main';

const MIN_PLAYERS = 4;

export function render(root: HTMLElement, ctx: ScreenCtx): () => void {
  const conn = ctx.conn!;
  const list = el('ul', { class: 'players' });
  const start = el('button', { 'data-testid': 'start', class: 'primary', type: 'button' }, S.lobby.start);
  const notice = el('p', { class: 'notice', 'data-testid': 'notice' });
  const error = el('p', { class: 'error', 'data-testid': 'error', role: 'alert' });
  start.addEventListener('click', () => conn.start());
  const leave = el('button', { 'data-testid': 'leave', type: 'button' }, S.lobby.leave);
  leave.addEventListener('click', () => ctx.leave());

  const update = (m: LobbyMsg): void => {
    list.replaceChildren(
      ...m.players.map((p) =>
        el(
          'li',
          { 'data-testid': 'lobby-player' },
          p.name,
          p.id === m.hostId ? el('span', { class: 'tag' }, S.lobby.host) : null,
          p.id === conn.myId ? el('span', { class: 'tag me' }, S.lobby.me) : null,
        ),
      ),
    );
    const isHost = m.hostId === conn.myId;
    start.hidden = !isHost;
    const enough = m.players.length >= MIN_PLAYERS;
    start.disabled = !enough;
    notice.textContent = !isHost ? S.lobby.waitHost : enough ? '' : S.lobby.needPlayers;
  };

  const offLobby = conn.onLobby(update);
  const offError = conn.onError((e) => {
    error.textContent =
      e.code === 'NOT_HOST' ? S.err.notHost : e.code === 'NOT_ENOUGH_PLAYERS' ? S.err.notEnoughPlayers : '';
  });

  root.replaceChildren(
    el(
      'main',
      { class: 'screen lobby' },
      el('p', { class: 'label' }, S.lobby.roomCode),
      el('div', { class: 'room-code', 'data-testid': 'room-code' }, conn.code),
      el('p', { class: 'label' }, S.lobby.players),
      list,
      start,
      notice,
      error,
      leave,
    ),
  );
  if (conn.lastLobby) update(conn.lastLobby);
  else start.hidden = true;
  return () => {
    offLobby();
    offError();
  };
}
