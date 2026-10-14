import type { Rng } from '@miljeong/shared';
import { el } from '../ui/dom';
import type { MiniGameModel, MiniGameView } from './index';
import { S } from '../strings';

const GLYPHS = ['火', '月', '水', '木', '金', '山', '川', '石'];
const CODES = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
export const CIPHER_PAIRS = 4;

export interface CipherItem {
  pair: number;
  label: string;
}
export type CipherAction = { side: 'left' | 'right'; index: number };

export interface CipherModel extends MiniGameModel<CipherAction> {
  readonly left: readonly CipherItem[];
  readonly right: readonly CipherItem[];
  readonly matched: number;
  readonly doneLeft: ReadonlySet<number>;
  readonly doneRight: ReadonlySet<number>;
  /** currently selected left index, or null */
  readonly selected: number | null;
}

export function cipher(rng: Rng): CipherModel {
  const ids = rng.shuffle(GLYPHS.map((_, i) => i)).slice(0, CIPHER_PAIRS);
  const left: CipherItem[] = ids.map((g, pair) => ({ pair, label: GLYPHS[g] }));
  const codes = rng.shuffle(ids.map((c) => CODES[c]).map((label, pair) => ({ pair, label })));
  const doneLeft = new Set<number>();
  const doneRight = new Set<number>();
  let selected: number | null = null;
  let matched = 0;
  return {
    left,
    right: codes,
    doneLeft,
    doneRight,
    get matched() {
      return matched;
    },
    get selected() {
      return selected;
    },
    get done() {
      return matched >= CIPHER_PAIRS;
    },
    apply(a) {
      if (matched >= CIPHER_PAIRS) return;
      if (a.side === 'left') {
        if (a.index < 0 || a.index >= left.length || doneLeft.has(a.index)) return;
        selected = a.index;
        return;
      }
      if (selected === null || a.index < 0 || a.index >= codes.length || doneRight.has(a.index)) return;
      if (codes[a.index].pair === left[selected].pair) {
        doneLeft.add(selected);
        doneRight.add(a.index);
        matched++;
      }
      selected = null;
    },
  };
}

export function mountCipher(body: HTMLElement, rng: Rng, finish: () => void): MiniGameView {
  const m = cipher(rng);
  const colL = el('div', { class: 'mg-col' });
  const colR = el('div', { class: 'mg-col' });
  const render = (): void => {
    colL.replaceChildren(
      el('p', { class: 'mg-sub' }, S.minigame.cipherLeft),
      ...m.left.map((it, i) =>
        el('button', {
          type: 'button',
          'data-testid': `cipher-left-${i}`,
          class: m.selected === i ? 'sel' : '',
          disabled: m.doneLeft.has(i),
          onclick: () => act({ side: 'left', index: i }),
        }, it.label),
      ),
    );
    colR.replaceChildren(
      el('p', { class: 'mg-sub' }, S.minigame.cipherRight),
      ...m.right.map((it, i) =>
        el('button', {
          type: 'button',
          'data-testid': `cipher-right-${i}`,
          disabled: m.doneRight.has(i),
          onclick: () => act({ side: 'right', index: i }),
        }, it.label),
      ),
    );
  };
  const act = (a: CipherAction): void => {
    m.apply(a);
    render();
    if (m.done) finish();
  };
  body.append(el('div', { class: 'mg-cols' }, colL, colR));
  render();
  return {
    solve() {
      for (let l = 0; l < m.left.length; l++) {
        m.apply({ side: 'left', index: l });
        m.apply({ side: 'right', index: m.right.findIndex((r) => r.pair === m.left[l].pair) });
      }
      render();
      finish();
    },
  };
}
