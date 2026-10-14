import type { PlayerView } from '@miljeong/shared';
import { S } from '../strings';
import { el } from './dom';

export const ROLE_REVEAL_MS = 3000;

/** startedAt of the last game whose role was revealed (so remounting mid-game does not re-show it). */
let revealedFor: number | null = null;

export function resetRoleReveal(): void {
  revealedFor = null;
}

/** True once per game; marks the game as revealed. */
export function takeReveal(view: PlayerView): boolean {
  if (revealedFor === view.startedAt) return false;
  revealedFor = view.startedAt;
  return true;
}

export function roleRevealElement(view: PlayerView): HTMLElement {
  const spy = view.me.role === 'spy';
  const names = view.me.fellowSpies.map((id) => view.roster.find((r) => r.id === id)?.name ?? id);
  return el(
    'div',
    { class: `role-reveal ${spy ? 'spy' : 'fighter'}`, 'data-testid': 'role-reveal' },
    el('h2', {}, spy ? S.game.roleSpy : S.game.roleFighter),
    spy && el('p', {}, names.length > 0 ? `${S.game.fellow}: ${names.join(', ')}` : S.game.noFellow),
  );
}

/** Shows the reveal overlay for 3 s; returns a function that removes it early. */
export function showRoleReveal(parent: HTMLElement, view: PlayerView): () => void {
  const node = roleRevealElement(view);
  parent.append(node);
  const timer = setTimeout(() => node.remove(), ROLE_REVEAL_MS);
  return () => {
    clearTimeout(timer);
    node.remove();
  };
}
