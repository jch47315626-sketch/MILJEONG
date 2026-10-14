import { MAP, createRng, type Intent, type MapData, type PlayerView, type Rng } from '@miljeong/shared';
import { openMiniGame } from '../minigames';

/** Server rejects taskComplete earlier than this after taskStart (config.taskMinMs). */
export const TASK_MIN_MS = 1500;

export interface TaskControllerDeps {
  parent: HTMLElement;
  send(intent: Intent): void;
  /** shown when the server rejects while a mini-game is pending */
  onRejected?(): void;
  /** fired whenever a mini-game opens or closes */
  onOpenChange?(open: boolean): void;
  map?: MapData;
  rng?: Rng;
}

export interface TaskController {
  /** Opens the mini-game for `taskId`; no-op if one is already open or the task is unknown. Spies never send intents. */
  open(taskId: string, view: PlayerView): void;
  /** closes the mini-game when the view makes it invalid (phase left 'playing', or I was just informed) */
  onView(view: PlayerView): void;
  /** the server refused an intent: closes a pending mini-game and returns true if one was open */
  rejected(): boolean;
  isOpen(): boolean;
  close(): void;
  destroy(): void;
}

export function createTaskController(deps: TaskControllerDeps): TaskController {
  const map = deps.map ?? MAP;
  let closer: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wasAlive: boolean | null = null;
  let sent = false;

  function close(): void {
    if (!closer) return;
    clearTimeout(timer);
    timer = undefined;
    closer();
    closer = null;
    sent = false;
    deps.onOpenChange?.(false);
  }

  function open(taskId: string, view: PlayerView): void {
    if (closer) return;
    const spot = map.taskSpots.find((s) => s.id === taskId);
    if (!spot) return;
    const canSend = view.me.role === 'fighter';
    const openedAt = Date.now();
    if (canSend) {
      deps.send({ t: 'taskStart', taskId });
      sent = true;
    }
    wasAlive = view.me.alive;
    deps.onOpenChange?.(true);
    closer = openMiniGame(spot.type, deps.parent, {
      rng: deps.rng ?? createRng((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0),
      onClose: close,
      onDone() {
        if (!canSend) {
          close();
          return;
        }
        const finish = (): void => {
          deps.send({ t: 'taskComplete', taskId });
          close();
        };
        const wait = TASK_MIN_MS - (Date.now() - openedAt);
        if (wait <= 0) finish();
        else timer = setTimeout(finish, wait);
      },
    });
  }

  return {
    open,
    onView(view) {
      const alive = view.me.alive;
      const informed = wasAlive === true && !alive;
      wasAlive = alive;
      if (closer && (view.phase !== 'playing' || informed)) close();
    },
    rejected() {
      if (!closer || !sent) return false;
      close();
      deps.onRejected?.();
      return true;
    },
    isOpen: () => closer !== null,
    close,
    destroy: close,
  };
}
