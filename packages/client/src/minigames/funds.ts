import type { Rng } from '@miljeong/shared';
import { el } from '../ui/dom';
import type { MiniGameModel, MiniGameView } from './index';
import { S } from '../strings';

export type Coin = 10 | 50;
export type FundsAction = { add: Coin } | 'undo';

export interface FundsModel extends MiniGameModel<FundsAction> {
  readonly target: number;
  readonly total: number;
  readonly coins: readonly Coin[];
}

export function funds(rng: Rng): FundsModel {
  const target = (rng.int(9) + 1) * 10; // 10..90
  const coins: Coin[] = [];
  const sum = (): number => coins.reduce((a, c) => a + c, 0);
  let latched = false;
  return {
    target,
    coins,
    get total() {
      return sum();
    },
    get done() {
      return latched;
    },
    apply(a) {
      if (latched) return;
      if (a === 'undo') coins.pop();
      else coins.push(a.add);
      if (sum() === target) latched = true;
    },
  };
}

/** Tap-to-add (no drag): the model API is the same. */
export function mountFunds(body: HTMLElement, rng: Rng, finish: () => void): MiniGameView {
  const m = funds(rng);
  const info = el('p', { class: 'mg-count', 'data-testid': 'funds-info' });
  const tray = el('div', { class: 'mg-tray', 'data-testid': 'funds-tray' });
  const render = (): void => {
    info.textContent = `${S.minigame.target} ${m.target}${S.minigame.unit} / ${S.minigame.total} ${m.total}${S.minigame.unit}`;
    info.classList.toggle('over', m.total > m.target);
    tray.replaceChildren(...m.coins.map((c) => el('span', { class: `mg-coin c${c}` }, String(c))));
  };
  const act = (a: FundsAction): void => {
    m.apply(a);
    render();
    if (m.done) finish();
  };
  const coin = (c: Coin) =>
    el('button', { type: 'button', class: `mg-coin c${c}`, 'data-testid': `funds-add-${c}`, onclick: () => act({ add: c }) }, `${c}${S.minigame.unit}`);
  body.append(
    info,
    tray,
    el('div', { class: 'mg-row' }, coin(10), coin(50)),
    el('button', { type: 'button', 'data-testid': 'funds-undo', onclick: () => act('undo') }, S.minigame.undo),
  );
  render();
  return {
    solve() {
      while (m.total > 0 && !m.done) m.apply('undo');
      while (!m.done) m.apply({ add: 10 });
      render();
      finish();
    },
  };
}
