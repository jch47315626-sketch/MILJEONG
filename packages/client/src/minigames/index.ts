import type { Rng, TaskType } from '@miljeong/shared';
import { el } from '../ui/dom';
import { S } from '../strings';
import { mountMimeograph } from './mimeograph';
import { mountCipher } from './cipher';
import { mountFunds } from './funds';
import { mountFlag } from './flag';
import { mountTelegraph } from './telegraph';

export interface MiniGameModel<A> {
  readonly done: boolean;
  apply(action: A): void;
}

/** What a mounted mini-game view exposes (solve is only used by the E2E autocomplete button). */
export interface MiniGameView {
  solve(): void;
}

export interface OpenOpts {
  rng: Rng;
  /** called once, when the player has completed the mini-game */
  onDone(): void;
  /** called when the player taps the close button (not when the returned closer is used) */
  onClose(): void;
}

/** Mounts the mini-game modal into `root`; returns a silent closer. */
export function openMiniGame(type: TaskType, root: HTMLElement, opts: OpenOpts): () => void {
  const body = el('div', { class: 'mg-body' });
  const status = el('p', { class: 'mg-status', 'data-testid': 'minigame-status', hidden: true }, S.minigame.sending);
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    status.hidden = false;
    opts.onDone();
  };

  const closeBtn = el('button', { type: 'button', class: 'mg-close', 'data-testid': 'minigame-close', 'aria-label': S.minigame.close, onclick: () => opts.onClose() }, '✕');
  const modal = el(
    'div',
    { class: 'minigame', 'data-testid': `minigame-${type}`, role: 'dialog', 'aria-label': S.minigame.titles[type] },
    el('div', { class: 'mg-card' },
      el('div', { class: 'mg-head' }, el('h2', {}, S.minigame.titles[type]), closeBtn),
      el('p', { class: 'mg-help' }, S.minigame.help[type]),
      body,
      status,
    ),
  );
  // the modal swallows pointer input so the joystick/world underneath never sees it
  root.append(modal);

  let view: MiniGameView;
  switch (type) {
    case 'mimeograph':
      view = mountMimeograph(body, finish);
      break;
    case 'cipher':
      view = mountCipher(body, opts.rng, finish);
      break;
    case 'funds':
      view = mountFunds(body, opts.rng, finish);
      break;
    case 'flag':
      view = mountFlag(body, finish);
      break;
    case 'telegraph':
      view = mountTelegraph(body, opts.rng, finish);
      break;
  }
  if (import.meta.env.VITE_E2E === '1') {
    body.append(el('button', { type: 'button', 'data-testid': 'minigame-autocomplete', onclick: () => view.solve() }, S.minigame.autocomplete));
  }
  return () => modal.remove();
}
