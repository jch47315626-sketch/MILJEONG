import { DEFAULT_CONFIG, FAST_CONFIG, dist, type GameConfig, type Intent, type MapData, type PlayerView, type Vec } from '@miljeong/shared';

export interface Keys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

const ZERO: Vec = { x: 0, y: 0 };

/** Virtual stick wins over keys; result length is always <= 1. */
export function inputToDir(keys: Keys, stick: Vec | null): Vec {
  if (stick && (stick.x !== 0 || stick.y !== 0)) {
    const len = Math.hypot(stick.x, stick.y);
    return len > 1 ? { x: stick.x / len, y: stick.y / len } : { x: stick.x, y: stick.y };
  }
  const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const y = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (x === 0 && y === 0) return { ...ZERO };
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
}

const isZero = (v: Vec): boolean => v.x === 0 && v.y === 0;

/** Analog sticks wobble: treat directions closer than this as unchanged (zero is always exact). */
const DIR_EPS = 0.05;

export function sameDir(a: Vec, b: Vec): boolean {
  if (isZero(a) || isZero(b)) return isZero(a) && isZero(b);
  return Math.hypot(a.x - b.x, a.y - b.y) < DIR_EPS;
}

/** Sends a `move` intent only when the direction changes (the server starts everyone at zero). */
export class MoveSender {
  private last: Vec = { ...ZERO };
  constructor(private readonly send: (i: Intent) => void) {}
  set(dir: Vec): void {
    if (sameDir(this.last, dir)) return;
    this.last = { x: dir.x, y: dir.y };
    this.send({ t: 'move', dir: { x: dir.x, y: dir.y } });
  }
  /** forget what was sent (new game: the server direction is zero again) */
  reset(): void {
    this.last = { ...ZERO };
  }
}

/** E2E builds (VITE_E2E=1) talk to a server running FAST_CONFIG. */
export function activeConfig() {
  return import.meta.env.VITE_E2E === '1' ? FAST_CONFIG : DEFAULT_CONFIG;
}

export interface Actions {
  /** nearest unfinished task id in range, or (spy) any spot in range for camouflage */
  task: string | null;
  /** nearest informable fighter id in range */
  inform: string | null;
  report: boolean;
  bell: boolean;
  fixBreaker: boolean;
  sabotage: boolean;
}

/** Which action buttons are enabled. A convenience only: the server decides. */
export function availableActions(view: PlayerView, map: MapData, config: GameConfig = DEFAULT_CONFIG): Actions {
  const { me } = view;
  const out: Actions = { task: null, inform: null, report: false, bell: false, fixBreaker: false, sabotage: false };
  if (view.phase !== 'playing') return out;

  // tasks: ghosts may still work; fighters only on their own unfinished tasks
  let best = Infinity;
  const spots =
    me.role === 'spy'
      ? map.taskSpots
      : map.taskSpots.filter((s) => me.tasks.some((t) => t.taskId === s.id && !t.done));
  for (const s of spots) {
    const d = dist(me.pos, s.pos);
    if (d <= config.taskRange && d < best) {
      best = d;
      out.task = s.id;
    }
  }

  if (!me.alive) return out;

  if (me.role === 'spy') {
    if (view.now >= me.informReadyAt) {
      let bestD = Infinity;
      for (const v of view.visible) {
        if (v.ghost || me.fellowSpies.includes(v.id)) continue;
        const d = dist(me.pos, v.pos);
        if (d <= config.informRange && d < bestD) {
          bestD = d;
          out.inform = v.id;
        }
      }
    }
    out.sabotage = view.sabotage === null && view.sabotageReadyAt !== null && view.now >= view.sabotageReadyAt;
  } else {
    out.fixBreaker = view.sabotage?.kind === 'blackout' && dist(me.pos, map.breaker) <= config.fixRange;
  }

  out.report = view.traces.some((t) => dist(me.pos, t.pos) <= config.reportRange);
  out.bell =
    !me.bellUsed &&
    view.now >= view.startedAt + config.bellUnlockMs &&
    view.sabotage === null &&
    dist(me.pos, map.bell) <= config.bellRange;
  return out;
}

export type ActionName = 'task' | 'inform' | 'report' | 'bell';

/** Keyboard binding table: E task/breaker, Q inform, R report, B bell. */
export function keyToAction(code: string): ActionName | null {
  switch (code) {
    case 'KeyE':
      return 'task';
    case 'KeyQ':
      return 'inform';
    case 'KeyR':
      return 'report';
    case 'KeyB':
      return 'bell';
    default:
      return null;
  }
}

export function keyToMove(code: string): keyof Keys | null {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':
      return 'up';
    case 'KeyS':
    case 'ArrowDown':
      return 'down';
    case 'KeyA':
    case 'ArrowLeft':
      return 'left';
    case 'KeyD':
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}

/** Tracks held keys; ignores typing in form fields; clears everything on blur/hide. */
export class KeyboardInput {
  readonly keys: Keys = { up: false, down: false, left: false, right: false };
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly onChange: () => void,
    private readonly onAction: (a: ActionName) => void,
    /** true while a modal (mini-game) owns the keyboard: movement and action keys are ignored */
    blocked: () => boolean = () => false,
  ) {
    const typing = (e: Event): boolean => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const down = (e: KeyboardEvent): void => {
      if (typing(e) || blocked() || e.ctrlKey || e.metaKey || e.altKey) return;
      const m = keyToMove(e.code);
      if (m) {
        e.preventDefault();
        if (!this.keys[m]) {
          this.keys[m] = true;
          this.onChange();
        }
        return;
      }
      const a = keyToAction(e.code);
      if (a && !e.repeat) this.onAction(a);
    };
    const up = (e: KeyboardEvent): void => {
      const m = keyToMove(e.code);
      if (m && this.keys[m]) {
        this.keys[m] = false;
        this.onChange();
      }
    };
    const release = (): void => {
      this.releaseAll();
    };
    const vis = (): void => {
      if (document.hidden) this.releaseAll();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', vis);
    this.off.push(
      () => window.removeEventListener('keydown', down),
      () => window.removeEventListener('keyup', up),
      () => window.removeEventListener('blur', release),
      () => document.removeEventListener('visibilitychange', vis),
    );
  }

  releaseAll(): void {
    this.keys.up = this.keys.down = this.keys.left = this.keys.right = false;
    this.onChange();
  }

  destroy(): void {
    this.off.forEach((f) => f());
    this.off.length = 0;
  }
}
