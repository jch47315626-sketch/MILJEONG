import { el } from '../ui/dom';
import type { MiniGameModel, MiniGameView } from './index';
import { S } from '../strings';

export const MIMEOGRAPH_TAPS = 12;

export interface MimeographModel extends MiniGameModel<'tap'> {
  readonly taps: number;
}

export function mimeograph(): MimeographModel {
  let taps = 0;
  return {
    get done() {
      return taps >= MIMEOGRAPH_TAPS;
    },
    get taps() {
      return taps;
    },
    apply() {
      if (taps < MIMEOGRAPH_TAPS) taps++;
    },
  };
}

export function mountMimeograph(body: HTMLElement, finish: () => void): MiniGameView {
  const m = mimeograph();
  const count = el('p', { class: 'mg-count', 'data-testid': 'mimeograph-count' });
  const sheet = el('div', { class: 'mg-sheet' });
  const btn = el('button', { type: 'button', class: 'mg-big', 'data-testid': 'mimeograph-tap' }, S.minigame.tapLabel);
  const render = (): void => {
    count.textContent = `${m.taps} / ${MIMEOGRAPH_TAPS}`;
    sheet.style.height = `${Math.round((m.taps / MIMEOGRAPH_TAPS) * 100)}%`;
    btn.disabled = m.done;
  };
  btn.addEventListener('click', () => {
    m.apply('tap');
    render();
    if (m.done) finish();
  });
  body.append(el('div', { class: 'mg-paper' }, sheet), count, btn);
  render();
  return {
    solve() {
      while (!m.done) m.apply('tap');
      render();
      finish();
    },
  };
}
