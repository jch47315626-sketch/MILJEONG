import { describe, expect, test, vi } from 'vitest';
import type { Intent, PlayerView } from '@miljeong/shared';

const destroy = vi.fn();
vi.mock('../src/game/GameScene', () => ({ createGame: () => ({ destroy }) }));

import { render } from '../src/ui/game';

function view(): PlayerView {
  return {
    phase: 'playing', now: 1,
    me: { id: 'me', role: 'fighter', alive: true, pos: { x: 20, y: 14 }, tasks: [], informReadyAt: 0, bellUsed: false, fellowSpies: [] },
    roster: [], visible: [], traces: [], gauge: 0, sabotage: null, sabotageReadyAt: null, visionRadius: 5,
    meeting: null, lastEjection: null, chat: [], ghostChat: [], winner: null, startedAt: 1,
  };
}

describe('game screen', () => {
  test('cleanup unsubscribes, sends a final zero move, destroys phaser and key handling', async () => {
    let viewCb: ((v: PlayerView) => void) | null = null;
    const offView = vi.fn();
    const offRej = vi.fn();
    const offErr = vi.fn();
    const sent: Intent[] = [];
    const conn = {
      lastView: null,
      send: (i: Intent) => sent.push(i),
      onView: (cb: (v: PlayerView) => void) => ((viewCb = cb), offView),
      onRejected: () => offRej,
      onError: () => offErr,
    };
    const root = document.createElement('div');
    document.body.append(root);
    const cleanup = render(root, { conn } as never);
    expect(root.querySelector('[data-testid="game-screen"]')).not.toBeNull();
    viewCb!(view());
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(sent).toEqual([{ t: 'move', dir: { x: 1, y: 0 } }]);
    await vi.waitFor(() => expect(root.querySelector('[data-testid="hud"]')).not.toBeNull());
    await new Promise((r) => setTimeout(r, 0));
    cleanup();
    expect(offView).toHaveBeenCalledTimes(1);
    expect(offRej).toHaveBeenCalledTimes(1);
    expect(offErr).toHaveBeenCalledTimes(1);
    expect(sent[sent.length - 1]).toEqual({ t: 'move', dir: { x: 0, y: 0 } });
    expect(destroy).toHaveBeenCalledTimes(1);
    const n = sent.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    expect(sent.length).toBe(n);
  });
});
