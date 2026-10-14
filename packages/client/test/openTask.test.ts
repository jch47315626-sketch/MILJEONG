import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MAP, createRng, type Intent, type PlayerView } from '@miljeong/shared';
import { createTaskController, TASK_COMPLETE_MARGIN_MS } from '../src/ui/openTask';
import { activeConfig } from '../src/game/input';
import { createHud } from '../src/ui/hud';
import { KeyboardInput } from '../src/game/input';

const TASK_MIN_MS = activeConfig().taskMinMs;
const spot = MAP.taskSpots.find((s) => s.type === 'mimeograph')!;

function view(role: 'fighter' | 'spy', over: Partial<PlayerView> = {}, alive = true): PlayerView {
  return {
    phase: 'playing', now: 50_000,
    me: { id: 'me', role, alive, pos: { ...spot.pos }, tasks: role === 'fighter' ? [{ taskId: spot.id, type: spot.type, done: false }] : [], informReadyAt: 0, bellUsed: false, fellowSpies: [] },
    roster: [], visible: [], traces: [], gauge: 0, sabotage: null, sabotageReadyAt: null,
    visionRadius: 5, meeting: null, lastEjection: null, chat: [], ghostChat: [], winner: null, startedAt: 7, ...over,
  } as PlayerView;
}
const q = (root: ParentNode, id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;
const tapAll = (host: HTMLElement) => {
  for (let i = 0; i < 12; i++) q(host, 'mimeograph-tap')!.click();
};

describe('task controller', () => {
  let host: HTMLElement;
  let sent: Intent[];
  let ctl: ReturnType<typeof createTaskController>;
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    sent = [];
    ctl = createTaskController({ parent: host, send: (i) => sent.push(i), rng: createRng(1) });
  });
  afterEach(() => vi.useRealTimers());

  test('margin is 200ms and the minimum comes from activeConfig().taskMinMs', () => {
    expect(TASK_COMPLETE_MARGIN_MS).toBe(200);
    expect(activeConfig().taskMinMs).toBe(1500);
  });

  test('custom minMs is honoured (plus the margin)', () => {
    const c = createTaskController({ parent: host, send: (i) => sent.push(i), rng: createRng(1), minMs: 3000 });
    c.open(spot.id, view('fighter'));
    tapAll(host);
    vi.advanceTimersByTime(3000 + TASK_COMPLETE_MARGIN_MS - 1);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent[1]).toEqual({ t: 'taskComplete', taskId: spot.id });
  });

  test('fighter: taskStart, early finish waits until taskMinMs + margin then taskComplete', () => {
    ctl.open(spot.id, view('fighter'));
    expect(sent).toEqual([{ t: 'taskStart', taskId: spot.id }]);
    expect(q(host, 'minigame-mimeograph')).not.toBeNull();
    vi.advanceTimersByTime(400);
    tapAll(host);
    expect(sent).toHaveLength(1);
    expect(q(host, 'minigame-status')!.hidden).toBe(false);
    vi.advanceTimersByTime(TASK_MIN_MS + TASK_COMPLETE_MARGIN_MS - 400 - 1);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent[1]).toEqual({ t: 'taskComplete', taskId: spot.id });
    expect(q(host, 'minigame-mimeograph')).toBeNull();
    expect(ctl.isOpen()).toBe(false);
  });

  test('finishing after taskMinMs + margin sends taskComplete immediately', () => {
    ctl.open(spot.id, view('fighter'));
    vi.advanceTimersByTime(TASK_MIN_MS + TASK_COMPLETE_MARGIN_MS);
    tapAll(host);
    expect(sent[1]).toEqual({ t: 'taskComplete', taskId: spot.id });
  });

  test('spy: same UI, sends nothing', () => {
    ctl.open(spot.id, view('spy'));
    expect(q(host, 'minigame-mimeograph')).not.toBeNull();
    tapAll(host);
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    expect(ctl.isOpen()).toBe(false);
  });

  test('phase change closes; pending completion is cancelled', () => {
    ctl.open(spot.id, view('fighter'));
    tapAll(host);
    ctl.onView(view('fighter', { phase: 'meeting' }));
    expect(q(host, 'minigame-mimeograph')).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([{ t: 'taskStart', taskId: spot.id }]);
  });

  test('informed (alive true → false) closes; an existing ghost keeps its task', () => {
    ctl.open(spot.id, view('fighter'));
    ctl.onView(view('fighter'));
    expect(ctl.isOpen()).toBe(true);
    ctl.onView(view('fighter', {}, false));
    expect(ctl.isOpen()).toBe(false);

    ctl.open(spot.id, view('fighter', {}, false));
    ctl.onView(view('fighter', {}, false));
    expect(ctl.isOpen()).toBe(true);
  });

  test('close button closes without sending; only one at a time; rejection closes', () => {
    ctl.open(spot.id, view('fighter'));
    ctl.open(spot.id, view('fighter'));
    expect(host.querySelectorAll('.minigame')).toHaveLength(1);
    expect(sent).toHaveLength(1);
    q(host, 'minigame-close')!.click();
    expect(ctl.isOpen()).toBe(false);
    expect(ctl.rejected()).toBe(false);
    ctl.open(spot.id, view('fighter'));
    expect(ctl.rejected()).toBe(true);
    expect(ctl.isOpen()).toBe(false);
  });
});

describe('hud + keyboard integration', () => {
  test('hud task button opens the modal, rejection toasts and closes, keys ignored while open', () => {
    const host = document.createElement('div');
    const sent: Intent[] = [];
    const changes: [boolean, boolean][] = [];
    // record isOpen at notification time: the listener must already see the new state
    const hud: ReturnType<typeof createHud> = createHud(host, {
      send: (i) => sent.push(i),
      onTaskOpenChange: (o) => changes.push([o, hud.taskOpen()]),
    });
    hud.update(view('fighter'));
    q(host, 'btn-task')!.click();
    expect(hud.taskOpen()).toBe(true);
    expect(changes).toEqual([[true, true]]);

    let moved = 0;
    const kb = new KeyboardInput(() => moved++, () => {}, () => hud.taskOpen());
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(kb.keys.up).toBe(false);

    hud.rejected('OUT_OF_RANGE');
    expect(hud.taskOpen()).toBe(false);
    expect(q(host, 'hud-toast')!.hidden).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(kb.keys.up).toBe(true);
    expect(moved).toBeGreaterThan(0);
    kb.destroy();
    hud.destroy();
  });
});
