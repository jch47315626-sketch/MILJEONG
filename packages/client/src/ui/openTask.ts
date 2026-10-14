import { MAP, createRng, type Intent, type MapData, type PlayerView, type Rng } from '@miljeong/shared';
import { activeConfig } from '../game/input';
import { openMiniGame } from '../minigames';

/**
 * Extra wait on top of config.taskMinMs before sending taskComplete: the server
 * measures from when taskStart *arrived*, so network jitter could otherwise make
 * an early finish arrive too soon (TOO_FAST).
 */
export const TASK_COMPLETE_MARGIN_MS = 200;

export interface TaskControllerDeps {
  parent: HTMLElement;
  send(intent: Intent): void;
  /** shown when the server rejects while a mini-game is pending */
  onRejected?(): void;
  /** fired whenever a mini-game opens or closes */
  onOpenChange?(open: boolean): void;
  map?: MapData;
  rng?: Rng;
  /** server's minimum task duration; defaults to activeConfig().taskMinMs */
  minMs?: number;
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
  const minMs = deps.minMs ?? activeConfig().taskMinMs;
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
        const wait = minMs + TASK_COMPLETE_MARGIN_MS - (Date.now() - openedAt);
        if (wait <= 0) finish();
        else timer = setTimeout(finish, wait);
      },
    });
    // notify only once `closer` is set, so listeners already see isOpen() === true
    deps.onOpenChange?.(true);
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
