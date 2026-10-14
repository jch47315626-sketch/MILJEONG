import type { PlayerView } from '@miljeong/shared';
import type { ScreenCtx } from '../main';
import { S } from '../strings';
import { el } from './dom';
import { revealedRoles } from './meeting';

export function winnerText(winner: 'fighters' | 'spies' | null): string {
  return winner === 'spies' ? S.result.spiesWin : S.result.fightersWin;
}

export function resultContent(view: PlayerView, isHost: boolean, onBack: () => void): HTMLElement {
  const players = view.roster.map((r) => {
    const role = r.role ?? revealedRoles.get(r.id) ?? null;
    return el(
      'li',
      { class: `result-row ${role ?? ''}`, 'data-testid': `result-player-${r.id}` },
      el('span', {}, r.name),
      el('span', { class: 'tag' }, role === 'spy' ? S.meeting.spy : role === 'fighter' ? S.meeting.fighter : '?'),
    );
  });
  return el(
    'main',
    { class: 'screen result', 'data-testid': 'result' },
    el('h1', { class: `result-banner ${view.winner ?? ''}`, 'data-testid': 'result-winner' }, winnerText(view.winner)),
    el('ul', { class: 'players' }, ...players),
    isHost
      ? el('button', { type: 'button', class: 'primary', 'data-testid': 'back-to-lobby', onclick: onBack }, S.result.backToLobby)
      : el('p', { class: 'notice' }, S.result.waitHost),
  );
}

export function render(root: HTMLElement, ctx: ScreenCtx): () => void {
  const conn = ctx.conn;
  if (!conn) return () => {};
  let sig = '';
  const mount = (view: PlayerView): void => {
    const isHost = conn.lastLobby?.hostId === conn.myId;
    // views keep arriving at 20Hz: rebuild only on change so a click is never lost mid-press
    const next = JSON.stringify([view.winner, isHost, view.roster.map((r) => [r.id, r.name, r.role])]);
    if (next === sig) return;
    sig = next;
    root.replaceChildren(resultContent(view, isHost, () => conn.backToLobby()));
  };
  if (conn.lastView) mount(conn.lastView);
  const offs = [
    conn.onView((v) => {
      if (v.phase === 'ended') mount(v);
    }),
    // host may change (reassigned) while on this screen
    conn.onLobby(() => {
      if (conn.lastView) mount(conn.lastView);
    }),
  ];
  return () => offs.forEach((off) => off());
}
