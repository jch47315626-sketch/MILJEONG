import type { Rng } from '@miljeong/shared';
import { el } from '../ui/dom';
import type { MiniGameModel, MiniGameView } from './index';
import { S } from '../strings';

export type Signal = 'long' | 'short';

export interface TelegraphModel extends MiniGameModel<Signal> {
  readonly pattern: readonly Signal[];
  readonly progress: number;
}

export function telegraph(rng: Rng): TelegraphModel {
  const n = 4 + rng.int(2); // 4..5
  const pattern: Signal[] = Array.from({ length: n }, () => (rng.int(2) === 0 ? 'long' : 'short'));
  let progress = 0;
  return {
    pattern,
    get progress() {
      return progress;
    },
    get done() {
      return progress >= pattern.length;
    },
    apply(s) {
      if (progress >= pattern.length) return;
      progress = s === pattern[progress] ? progress + 1 : 0;
    },
  };
}

const SYMBOL: Record<Signal, string> = { long: '—', short: '·' };

export function mountTelegraph(body: HTMLElement, rng: Rng, finish: () => void): MiniGameView {
  const m = telegraph(rng);
  const target = el('p', { class: 'mg-pattern', 'data-testid': 'telegraph-target' }, m.pattern.map((s) => SYMBOL[s]).join(' '));
  const typed = el('p', { class: 'mg-pattern typed', 'data-testid': 'telegraph-typed' });
  const render = (): void => {
    typed.textContent = m.pattern.slice(0, m.progress).map((s) => SYMBOL[s]).join(' ') || ' ';
  };
  const act = (s: Signal): void => {
    m.apply(s);
    render();
    if (m.done) finish();
  };
  body.append(
    target,
    typed,
    el(
      'div',
      { class: 'mg-row' },
      el('button', { type: 'button', class: 'mg-big', 'data-testid': 'telegraph-long', onclick: () => act('long') }, S.minigame.long),
      el('button', { type: 'button', class: 'mg-big', 'data-testid': 'telegraph-short', onclick: () => act('short') }, S.minigame.short),
    ),
  );
  render();
  return {
    solve() {
      for (const s of m.pattern) m.apply(s);
      render();
      finish();
    },
  };
}
