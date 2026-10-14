import { el } from '../ui/dom';
import type { MiniGameModel, MiniGameView } from './index';
import { S } from '../strings';

export type Dir = 'up' | 'right' | 'down' | 'left';
export const FLAG_SEQUENCE: readonly Dir[] = ['up', 'right', 'down', 'left'];
export const SWIPE_MIN_PX = 30;

export interface FlagModel extends MiniGameModel<Dir> {
  readonly progress: number;
}

export function flag(): FlagModel {
  let progress = 0;
  return {
    get progress() {
      return progress;
    },
    get done() {
      return progress >= FLAG_SEQUENCE.length;
    },
    apply(d) {
      if (progress >= FLAG_SEQUENCE.length) return;
      progress = d === FLAG_SEQUENCE[progress] ? progress + 1 : 0;
    },
  };
}

/** Swipe classification: needs >= 30px on the dominant axis; ties and short moves give null. */
export function swipeDir(dx: number, dy: number): Dir | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < SWIPE_MIN_PX || ax === ay) return null;
  if (ax > ay) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

const ARROWS: Record<Dir, string> = { up: '▲', right: '▶', down: '▼', left: '◀' };

export function mountFlag(body: HTMLElement, finish: () => void): MiniGameView {
  const m = flag();
  const steps = el('div', { class: 'mg-steps', 'data-testid': 'flag-steps' });
  const pad = el('div', { class: 'mg-pad', 'data-testid': 'flag-pad', 'aria-label': S.minigame.swipePad }, S.minigame.swipePad);
  const render = (): void => {
    steps.replaceChildren(
      ...FLAG_SEQUENCE.map((d, i) => el('span', { class: i < m.progress ? 'step ok' : 'step' }, ARROWS[d])),
    );
  };
  const act = (d: Dir): void => {
    m.apply(d);
    render();
    if (m.done) finish();
  };
  let start: { x: number; y: number } | null = null;
  pad.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY };
    try {
      pad.setPointerCapture?.(e.pointerId);
    } catch {
      /* not capturable (synthetic event) */
    }
  });
  pad.addEventListener('pointerup', (e) => {
    if (!start) return;
    const d = swipeDir(e.clientX - start.x, e.clientY - start.y);
    start = null;
    if (d) act(d);
  });
  pad.addEventListener('pointercancel', () => (start = null));
  const arrows = el(
    'div',
    { class: 'mg-row' },
    ...FLAG_SEQUENCE.map((d) =>
      el('button', { type: 'button', 'aria-label': S.minigame.dirs[d], 'data-testid': `flag-${d}`, onclick: () => act(d) }, ARROWS[d]),
    ),
  );
  body.append(steps, pad, arrows);
  render();
  return {
    solve() {
      for (const d of FLAG_SEQUENCE) m.apply(d);
      render();
      finish();
    },
  };
}
