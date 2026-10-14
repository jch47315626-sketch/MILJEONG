import type { PlayerView } from '@miljeong/shared';
import type { ScreenCtx } from '../main';
import { createJoystick, isTouchDevice } from '../game/joystick';
import { inputToDir, KeyboardInput, MoveSender } from '../game/input';
import { newStore, pushView } from '../game/store';
import { createHud } from './hud';
import { el } from './dom';
import { S } from '../strings';
import { showRoleReveal, takeReveal } from './roleReveal';
import type { Vec } from '@miljeong/shared';

/** In-game screen: Phaser world + DOM HUD. Returns the cleanup (destroys Phaser, unsubscribes everything). */
export function render(root: HTMLElement, ctx: ScreenCtx): () => void {
  const conn = ctx.conn;
  const canvasHost = el('div', { class: 'game-canvas' });
  const screen = el('main', { class: 'game-screen', 'data-testid': 'game-screen' }, canvasHost);
  root.replaceChildren(screen);
  if (!conn) return () => {};

  const store = newStore();
  const hud = createHud(screen, { send: (i) => conn.send(i), onTaskOpenChange: () => refresh() });
  const mover = new MoveSender((i) => conn.send(i));
  let stick: Vec | null = null;
  let startedAt: number | null = null;
  let hideReveal: (() => void) | null = null;
  let disposed = false;
  let game: { destroy(): void } | null = null;

  const refresh = (): void => {
    // stop sending movement outside live play (meeting, ejection, ended)
    const playing = store.view?.phase === 'playing' && !hud.taskOpen();
    mover.set(playing ? inputToDir(keyboard.keys, stick) : { x: 0, y: 0 });
  };
  const keyboard = new KeyboardInput(refresh, (a) => hud.trigger(a), () => hud.taskOpen());
  const joystick = isTouchDevice()
    ? createJoystick(screen, (v) => {
        stick = v;
        refresh();
      })
    : null;

  const onView = (view: PlayerView): void => {
    if (startedAt !== view.startedAt) {
      startedAt = view.startedAt;
      mover.reset();
    }
    pushView(store, view);
    hud.update(view);
    if (takeReveal(view)) {
      hideReveal?.();
      hideReveal = showRoleReveal(screen, view);
    }
    refresh();
  };

  const offs = [
    conn.onView(onView),
    conn.onRejected((m) => hud.rejected(m.reason)),
  ];
  if (conn.lastView) onView(conn.lastView);

  // Phaser is heavy: load it lazily so the title/lobby bundle stays small
  void import('../game/GameScene').then((m) => {
    if (disposed) return;
    game = m.createGame(canvasHost, store);
  }).catch(() => {
    if (!disposed) canvasHost.replaceChildren(el('p', { class: 'error', 'data-testid': 'game-error' }, S.err.generic));
  });

  return () => {
    disposed = true;
    try {
      mover.set({ x: 0, y: 0 });
    } catch {
      /* connection already closed */
    }
    offs.forEach((off) => off());
    keyboard.destroy();
    joystick?.destroy();
    hideReveal?.();
    hud.destroy();
    game?.destroy();
    game = null;
  };
}
