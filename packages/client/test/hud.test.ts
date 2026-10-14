import { describe, expect, test, vi } from 'vitest';
import { MAP, type Intent, type PlayerView } from '@miljeong/shared';
import { createHud, rejectText } from '../src/ui/hud';
import { resetRoleReveal, roleRevealElement, takeReveal } from '../src/ui/roleReveal';
import { S } from '../src/strings';

function view(role: 'fighter' | 'spy', over: Partial<PlayerView> = {}): PlayerView {
  return {
    phase: 'playing', now: 50_000,
    me: { id: 'me', role, alive: true, pos: { x: 20, y: 14 }, tasks: [], informReadyAt: 60_000, bellUsed: false, fellowSpies: role === 'spy' ? ['b'] : [] },
    roster: [{ id: 'me', name: '나', connected: true, left: false, publiclyDead: false, role }, { id: 'b', name: '동지', connected: true, left: false, publiclyDead: false, role: 'spy' }],
    visible: [], traces: [], gauge: 0.25, sabotage: null, sabotageReadyAt: role === 'spy' ? 0 : null,
    visionRadius: 5, meeting: null, lastEjection: null, chat: [], ghostChat: [], winner: null, startedAt: 7, ...over,
  };
}
const q = (root: HTMLElement, id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;

describe('hud', () => {
  test('fighter: gauge, no spy buttons; spy: cooldown number and sabotage menu sends intents', () => {
    const sent: Intent[] = [];
    const host = document.createElement('div');
    const hud = createHud(host, { send: (i) => sent.push(i) });
    hud.update(view('fighter'));
    expect(q(host, 'hud-gauge').dataset.value).toBe('25');
    expect(q(host, 'btn-inform').hidden).toBe(true);
    expect(q(host, 'btn-sabotage').hidden).toBe(true);
    expect(q(host, 'btn-fix').hidden).toBe(false);

    hud.update(view('spy'));
    expect(q(host, 'btn-inform').hidden).toBe(false);
    expect(q(host, 'btn-inform').textContent).toBe(`${S.game.btn.inform} 10`);
    expect(q(host, 'btn-task').textContent).toBe(S.game.btn.camouflage);
    q(host, 'btn-sabotage').click();
    const items = [...host.querySelectorAll('[data-testid="sabotage-menu"] button')] as HTMLButtonElement[];
    expect(items).toHaveLength(1 + MAP.passages.length);
    expect(items[0].textContent).toBe('정전');
    items[0].click();
    items[1].click();
    expect(sent).toEqual([
      { t: 'sabotage', kind: 'blackout' },
      { t: 'sabotage', kind: 'checkpoint', passageId: MAP.passages[0].id },
    ]);
  });
  test('buttons send matching intents; disabled when unavailable', () => {
    const sent: Intent[] = [];
    const host = document.createElement('div');
    const hud = createHud(host, { send: (i) => sent.push(i) });
    const t = { id: 't', victimId: 'x', pos: { x: 20.5, y: 14 } };
    hud.update(view('fighter', { traces: [t] }));
    expect(q(host, 'btn-report').disabled).toBe(false);
    expect(q(host, 'btn-bell').disabled).toBe(true);
    q(host, 'btn-report').click();
    hud.update(view('fighter'));
    expect(q(host, 'btn-report').disabled).toBe(true);
    hud.trigger('report');
    expect(sent).toEqual([{ t: 'report' }]);
    hud.update(view('spy', { visible: [{ id: 'f', pos: { x: 20.5, y: 14 }, ghost: false }] , me: { ...view('spy').me, informReadyAt: 0 } }));
    hud.trigger('inform');
    expect(sent[1]).toEqual({ t: 'inform', target: 'f' });
  });
  test('sabotage indicator follows view.sabotage (정전 / 검문: <통로>), hidden otherwise', () => {
    const host = document.createElement('div');
    const hud = createHud(host, { send: () => {} });
    const ind = () => q(host, 'hud-sabotage');
    hud.update(view('fighter'));
    expect(ind().hidden).toBe(true);
    hud.update(view('fighter', { sabotage: { kind: 'blackout' } }));
    expect(ind().hidden).toBe(false);
    expect(ind().textContent).toBe('정전');
    const p = MAP.passages[1];
    hud.update(view('spy', { sabotage: { kind: 'checkpoint', passageId: p.id, endsAt: 60_000 } }));
    expect(ind().textContent).toBe(`검문: ${p.name}`);
    hud.update(view('spy'));
    expect(ind().hidden).toBe(true);
  });
  test('notice: shown longer than a toast', () => {
    vi.useFakeTimers();
    try {
      const host = document.createElement('div');
      const hud = createHud(host, { send: () => {} });
      hud.notice(S.game.notice.informed);
      const t = q(host, 'hud-toast');
      expect(t.hidden).toBe(false);
      expect(t.textContent).toBe(S.game.notice.informed);
      vi.advanceTimersByTime(2000);
      expect(t.hidden).toBe(false);
      vi.advanceTimersByTime(3000);
      expect(t.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  test('rejected text', () => {
    expect(rejectText('COOLDOWN')).toBe(S.game.rejected.COOLDOWN);
    expect(rejectText('OUT_OF_RANGE')).toBe(S.game.rejected.OUT_OF_RANGE);
    expect(rejectText('WRONG_ROLE')).toBe(S.game.rejected.generic);
  });
});

describe('role reveal', () => {
  test('once per game (startedAt); spy shows fellow names', () => {
    resetRoleReveal();
    const v = view('spy');
    expect(takeReveal(v)).toBe(true);
    expect(takeReveal(v)).toBe(false);
    expect(takeReveal({ ...v, startedAt: 8 })).toBe(true);
    const n = roleRevealElement(v);
    expect(n.dataset.testid).toBe('role-reveal');
    expect(n.textContent).toContain('밀정');
    expect(n.textContent).toContain('동지');
    expect(roleRevealElement(view('fighter')).textContent).toBe('독립투사');
  });
});
