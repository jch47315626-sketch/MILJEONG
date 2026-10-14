import { describe, expect, test, vi } from 'vitest';
import { MAP, DEFAULT_CONFIG, FAST_CONFIG, type PlayerView } from '@miljeong/shared';
import { KeyboardInput, availableActions, inputToDir, MoveSender, sameDir } from '../src/game/input';

const none = { up: false, down: false, left: false, right: false };

function view(over: Partial<PlayerView> = {}, me: Partial<PlayerView['me']> = {}): PlayerView {
  return {
    phase: 'playing',
    now: 100_000,
    me: {
      id: 'me',
      role: 'fighter',
      alive: true,
      pos: { x: 20, y: 14 },
      tasks: [],
      informReadyAt: 0,
      bellUsed: false,
      fellowSpies: [],
      ...me,
    },
    roster: [],
    visible: [],
    traces: [],
    gauge: 0,
    sabotage: null,
    sabotageReadyAt: null,
    visionRadius: 5,
    meeting: null,
    lastEjection: null,
    chat: [],
    ghostChat: [],
    winner: null,
    startedAt: 0,
    ...over,
  };
}

describe('inputToDir', () => {
  test('diagonal is normalized, opposite keys cancel', () => {
    expect(inputToDir({ ...none, up: true }, null)).toEqual({ x: 0, y: -1 });
    const d = inputToDir({ ...none, right: true, down: true }, null);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
    expect(d.x).toBeGreaterThan(0);
    expect(d.y).toBeGreaterThan(0);
    expect(inputToDir({ ...none, left: true, right: true }, null)).toEqual({ x: 0, y: 0 });
  });
  test('stick overrides keys and is clamped to length 1', () => {
    expect(inputToDir({ ...none, up: true }, { x: 0.5, y: 0 })).toEqual({ x: 0.5, y: 0 });
    const d = inputToDir(none, { x: 3, y: 4 });
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
    expect(inputToDir({ ...none, up: true }, { x: 0, y: 0 })).toEqual({ x: 0, y: -1 });
  });
});

describe('MoveSender', () => {
  test('sends only when the direction changes', () => {
    const sent: unknown[] = [];
    const m = new MoveSender((i) => sent.push(i));
    m.set({ x: 0, y: 0 });
    m.set({ x: 1, y: 0 });
    m.set({ x: 1, y: 0 });
    m.set({ x: 0.99, y: 0.01 });
    m.set({ x: 0, y: 0 });
    expect(sent).toEqual([
      { t: 'move', dir: { x: 1, y: 0 } },
      { t: 'move', dir: { x: 0, y: 0 } },
    ]);
    expect(sameDir({ x: 0, y: 0 }, { x: 0.01, y: 0 })).toBe(false);
  });
});

describe('availableActions', () => {
  const spy = { role: 'spy' as const };
  test('inform only for alive spy with fighter in 1.5 and cooldown elapsed', () => {
    const near = [{ id: 'f', pos: { x: 21, y: 14 }, ghost: false }];
    expect(availableActions(view({ visible: near }, spy), MAP).inform).toBe('f');
    expect(availableActions(view({ visible: near }), MAP).inform).toBeNull(); // fighter
    expect(availableActions(view({ visible: near }, { ...spy, alive: false }), MAP).inform).toBeNull();
    expect(availableActions(view({ visible: near }, { ...spy, informReadyAt: 100_001 }), MAP).inform).toBeNull();
    const far = [{ id: 'f', pos: { x: 22, y: 14 }, ghost: false }];
    expect(availableActions(view({ visible: far }, spy), MAP).inform).toBeNull();
    const ghost = [{ id: 'f', pos: { x: 21, y: 14 }, ghost: true }];
    expect(availableActions(view({ visible: ghost }, spy), MAP).inform).toBeNull();
    const fellow = [{ id: 'f', pos: { x: 21, y: 14 }, ghost: false }];
    expect(availableActions(view({ visible: fellow }, { ...spy, fellowSpies: ['f'] }), MAP).inform).toBeNull();
  });
  test('inform picks the closest target', () => {
    const v = view(
      {
        visible: [
          { id: 'a', pos: { x: 21.4, y: 14 }, ghost: false },
          { id: 'b', pos: { x: 20.5, y: 14 }, ghost: false },
        ],
      },
      spy,
    );
    expect(availableActions(v, MAP).inform).toBe('b');
  });
  test('bell only near bell, unused, after unlock, no sabotage', () => {
    const at = { pos: { x: MAP.bell.x + 1, y: MAP.bell.y } };
    const base = { startedAt: 100_000 - DEFAULT_CONFIG.bellUnlockMs };
    expect(availableActions(view(base, at), MAP).bell).toBe(true);
    expect(availableActions(view(base, { pos: { x: 20, y: 14 } }), MAP).bell).toBe(false);
    expect(availableActions(view(base, { ...at, bellUsed: true }), MAP).bell).toBe(false);
    expect(availableActions(view({ startedAt: 100_000 - DEFAULT_CONFIG.bellUnlockMs + 1 }, at), MAP).bell).toBe(false);
    expect(availableActions(view({ ...base, sabotage: { kind: 'blackout' } }, at), MAP).bell).toBe(false);
    expect(availableActions(view({ ...base, phase: 'meeting' }, at), MAP).bell).toBe(false);
  });
  test('ghost fighter gets task but not report/bell', () => {
    const spot = MAP.taskSpots[0];
    const v = view(
      {
        startedAt: 0,
        traces: [{ id: 't', victimId: 'x', pos: { x: spot.pos.x, y: spot.pos.y } }],
      },
      {
        alive: false,
        pos: { ...spot.pos },
        tasks: [{ taskId: spot.id, type: spot.type, done: false, startedAt: null }],
      },
    );
    const a = availableActions(v, MAP);
    expect(a.task).toBe(spot.id);
    expect(a.report).toBe(false);
    expect(a.bell).toBe(false);
    expect(a.fixBreaker).toBe(false);
    // non-vacuous: ghost standing at the bell / at the breaker during a blackout
    const atBell = view({ startedAt: 0 }, { alive: false, pos: { ...MAP.bell } });
    expect(availableActions({ ...atBell, now: 100_000 }, MAP).bell).toBe(false);
    const alive = view({ startedAt: 0 }, { pos: { ...MAP.bell } });
    expect(availableActions(alive, MAP).bell).toBe(true); // same spot, alive: enabled
    const atBreaker = view({ sabotage: { kind: 'blackout' } }, { pos: { ...MAP.breaker } });
    expect(availableActions(atBreaker, MAP).fixBreaker).toBe(true);
    expect(availableActions(view({ sabotage: { kind: 'blackout' } }, { alive: false, pos: { ...MAP.breaker } }), MAP).fixBreaker).toBe(false);
  });
  test('FAST_CONFIG: bell available after 1s', () => {
    const at = { pos: { x: MAP.bell.x + 1, y: MAP.bell.y } };
    const v = view({ startedAt: 100_000 - FAST_CONFIG.bellUnlockMs }, at);
    expect(availableActions(v, MAP).bell).toBe(false);
    expect(availableActions(v, MAP, FAST_CONFIG).bell).toBe(true);
  });
  test('task: nearest unfinished own task in range; done tasks ignored; spy gets any spot', () => {
    const spot = MAP.taskSpots[0];
    const tasks = [{ taskId: spot.id, type: spot.type, done: false, startedAt: null }];
    const at = { pos: { x: spot.pos.x + 1, y: spot.pos.y }, tasks };
    expect(availableActions(view({}, at), MAP).task).toBe(spot.id);
    expect(availableActions(view({}, { ...at, tasks: [{ ...tasks[0], done: true }] }), MAP).task).toBeNull();
    expect(availableActions(view({}, { pos: at.pos, tasks: [] }), MAP).task).toBeNull();
    expect(availableActions(view({}, { pos: at.pos, role: 'spy' }), MAP).task).toBe(spot.id);
    expect(availableActions(view({}, { pos: { x: 20, y: 14 }, role: 'spy' }), MAP).task).toBeNull();
  });
  test('report near a trace; fixBreaker during blackout near breaker; sabotage for ready spy', () => {
    const t = { id: 't', victimId: 'x', pos: { x: 21, y: 14 } };
    expect(availableActions(view({ traces: [t] }), MAP).report).toBe(true);
    expect(availableActions(view({ traces: [{ ...t, pos: { x: 23, y: 14 } }] }), MAP).report).toBe(false);
    const near = { pos: { x: MAP.breaker.x, y: MAP.breaker.y + 1 } };
    expect(availableActions(view({ sabotage: { kind: 'blackout' } }, near), MAP).fixBreaker).toBe(true);
    expect(availableActions(view({}, near), MAP).fixBreaker).toBe(false);
    expect(availableActions(view({ sabotage: { kind: 'blackout' } }, { ...near, role: 'spy' }), MAP).fixBreaker).toBe(false);
    expect(availableActions(view({ sabotageReadyAt: 100_000 }, spy), MAP).sabotage).toBe(true);
    expect(availableActions(view({ sabotageReadyAt: 100_001 }, spy), MAP).sabotage).toBe(false);
    expect(availableActions(view({ sabotageReadyAt: 0, sabotage: { kind: 'blackout' } }, spy), MAP).sabotage).toBe(false);
    expect(availableActions(view({ sabotageReadyAt: 0 }), MAP).sabotage).toBe(false);
  });
});

describe('KeyboardInput', () => {
  const key = (type: string, code: string, target: EventTarget = window) =>
    target.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));

  test('tracks keys, fires actions, zeroes on blur and visibilitychange', () => {
    const onChange = vi.fn();
    const onAction = vi.fn();
    const k = new KeyboardInput(onChange, onAction);
    key('keydown', 'KeyD');
    expect(k.keys.right).toBe(true);
    key('keydown', 'KeyQ');
    expect(onAction).toHaveBeenCalledWith('inform');
    window.dispatchEvent(new Event('blur'));
    expect(k.keys.right).toBe(false);
    key('keydown', 'ArrowUp');
    expect(k.keys.up).toBe(true);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    expect(k.keys.up).toBe(false);
    k.destroy();
  });

  test('ignores keys typed in inputs', () => {
    const onChange = vi.fn();
    const onAction = vi.fn();
    const k = new KeyboardInput(onChange, onAction);
    const input = document.createElement('input');
    document.body.append(input);
    key('keydown', 'KeyD', input);
    key('keydown', 'KeyE', input);
    expect(k.keys.right).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    input.remove();
    k.destroy();
  });

  test('destroy removes listeners', () => {
    const onChange = vi.fn();
    const onAction = vi.fn();
    const k = new KeyboardInput(onChange, onAction);
    k.destroy();
    key('keydown', 'KeyD');
    key('keydown', 'KeyE');
    window.dispatchEvent(new Event('blur'));
    expect(k.keys.right).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
