import { S } from '../strings';
import { el } from './dom';
import type { ScreenCtx } from '../main';

/** Placeholders replaced by the game (Task 11) and result (Task 13) screens. */
function placeholder(testid: string, text: string) {
  return (root: HTMLElement, _ctx: ScreenCtx): (() => void) => {
    root.replaceChildren(el('main', { class: 'screen', 'data-testid': testid }, text));
    return () => {};
  };
}
export const renderResult = placeholder('result-screen', S.result);
