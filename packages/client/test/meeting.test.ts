import { describe, expect, test } from 'vitest';
import type { Intent, PlayerView } from '@miljeong/shared';
import { createMeeting, ejectionText, meetingTimerText, revealedRoles } from '../src/ui/meeting';
import { renderChat } from '../src/ui/chat';
import { resultContent } from '../src/ui/result';
import { S } from '../src/strings';

const roster = [
  { id: 'a', name: '철수', connected: true, left: false, publiclyDead: false, role: null },
  { id: 'b', name: 'Bob', connected: true, left: false, publiclyDead: false, role: null },
  { id: 'c', name: '영희', connected: true, left: false, publiclyDead: true, role: null },
];

function view(over: Partial<PlayerView> = {}): PlayerView {
  return {
    phase: 'meeting', now: 1000,
    me: { id: 'a', role: 'fighter', alive: true, pos: { x: 0, y: 0 }, tasks: [], informReadyAt: 0, bellUsed: false, fellowSpies: [] },
    roster, visible: [], traces: [], gauge: 0, sabotage: null, sabotageReadyAt: null, visionRadius: 5,
    meeting: { callerId: 'b', reason: 'bell', reportedVictimId: null, discussEndsAt: 61_000 + 1000, voteEndsAt: 91_000 + 1000, voted: [] },
    lastEjection: null, chat: [], ghostChat: [], winner: null, startedAt: 1, ...over,
  };
}
const q = (r: ParentNode, id: string) => r.querySelector(`[data-testid="${id}"]`) as HTMLElement;

describe('meetingTimerText', () => {
  test('switches from 토론 to 투표 at discussEndsAt', () => {
    const v = view();
    const m = v.meeting!;
    expect(meetingTimerText(v, m.discussEndsAt - 42_000)).toBe('토론 0:42');
    expect(meetingTimerText(v, m.discussEndsAt - 1)).toBe('토론 0:01');
    expect(meetingTimerText(v, m.discussEndsAt)).toBe(`투표 0:30`);
    expect(meetingTimerText(v, m.voteEndsAt - 17_000)).toBe('투표 0:17');
    expect(meetingTimerText(v, m.voteEndsAt + 5000)).toBe('투표 0:00');
  });
});

describe('ejectionText', () => {
  test('reveal on/off, skip, and 은/는 by batchim', () => {
    expect(ejectionText({ playerId: 'a', role: 'spy' }, roster)).toBe('철수는 조직에서 축출되었습니다. 그는 밀정이었습니다.');
    expect(ejectionText({ playerId: 'c', role: 'fighter' }, roster)).toBe('영희는 조직에서 축출되었습니다. 그는 독립투사였습니다.');
    expect(ejectionText({ playerId: 'a', role: null }, roster)).toBe('철수는 조직에서 축출되었습니다.');
    expect(ejectionText({ playerId: null, role: null }, roster)).toBe('아무도 축출되지 않았습니다.');
  });
  test('particle: no batchim -> 는, batchim -> 은, non-Hangul -> 은(는)', () => {
    const r = (name: string) => [{ id: 'x', name }];
    expect(ejectionText({ playerId: 'x', role: null }, r('나무'))).toMatch(/^나무는 /);
    expect(ejectionText({ playerId: 'x', role: null }, r('철수'))).toMatch(/^철수는 /);
    expect(ejectionText({ playerId: 'x', role: null }, r('김밥'))).toMatch(/^김밥은 /);
    expect(ejectionText({ playerId: 'x', role: null }, r('Bob'))).toMatch(/^Bob은\(는\) /);
    expect(ejectionText({ playerId: 'x', role: null }, r('철수1'))).toMatch(/^철수1은\(는\) /);
  });
});

describe('renderChat', () => {
  test('shows <script> as literal text', () => {
    const n = renderChat([{ from: 'a', text: '<script>x</script>', at: 0 }], roster);
    expect(n.querySelector('script')).toBeNull();
    expect(n.textContent).toContain('<script>x</script>');
    expect(n.querySelectorAll('[data-testid="chat-msg"]')).toHaveLength(1);
  });
});

describe('meeting overlay', () => {
  function mount() {
    const host = document.createElement('div');
    const sent: Intent[] = [];
    const ui = createMeeting(host, { send: (i) => sent.push(i) });
    return { host, sent, ui };
  }
  test('hidden outside meetings; vote buttons for living players; one vote then disabled', () => {
    const { host, sent, ui } = mount();
    ui.update(view({ phase: 'playing', meeting: null }));
    expect(q(host, 'meeting').hidden).toBe(true);
    ui.update(view());
    expect(q(host, 'meeting').hidden).toBe(false);
    expect((q(host, 'vote-c') as HTMLButtonElement).disabled).toBe(true);
    q(host, 'vote-b').click();
    q(host, 'vote-skip').click();
    expect(sent).toEqual([{ t: 'vote', target: 'b' }]);
    expect((q(host, 'vote-skip') as HTMLButtonElement).disabled).toBe(true);
    expect((q(host, 'vote-a') as HTMLButtonElement).disabled).toBe(true);
    ui.update(view({ meeting: { ...view().meeting!, voted: ['a', 'b'] } }));
    expect(q(host, 'voted-b').textContent).toBe(S.meeting.voted);
    // a new meeting re-enables voting
    ui.update(view({ meeting: { ...view().meeting!, discussEndsAt: 999_999 } }));
    expect((q(host, 'vote-skip') as HTMLButtonElement).disabled).toBe(false);
  });
  test('ghost cannot vote and chats in ghost chat', () => {
    const { host, sent, ui } = mount();
    ui.update(view({ me: { ...view().me, alive: false }, ghostChat: [{ from: 'c', text: '으악', at: 1 }], chat: [{ from: 'b', text: '산자', at: 1 }] }));
    expect((q(host, 'vote-b') as HTMLButtonElement).disabled).toBe(true);
    expect(q(host, 'vote-skip').hidden).toBe(true);
    expect(host.textContent).toContain('으악');
    expect(host.textContent).not.toContain('산자');
    const input = q(host, 'chat-input') as HTMLInputElement;
    input.value = '  안녕  ';
    q(host, 'chat-send').click();
    expect(sent).toEqual([{ t: 'chat', text: '안녕' }]);
    expect(input.value).toBe('');
  });
  test('chat: maxlength 100, Enter sends, whitespace not sent', () => {
    const { host, sent, ui } = mount();
    ui.update(view());
    const input = q(host, 'chat-input') as HTMLInputElement;
    expect(input.maxLength).toBe(100);
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    q(host, 'chat-send').click();
    expect(sent).toEqual([]);
    input.value = 'hi';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(sent).toEqual([{ t: 'chat', text: 'hi' }]);
  });
  test('ejection overlay shows text only while ejecting; revealed role is remembered', () => {
    const { host, ui } = mount();
    ui.update(view({ phase: 'ejecting', meeting: null, lastEjection: { playerId: 'b', role: 'spy' } }));
    expect(q(host, 'ejection').hidden).toBe(false);
    expect(q(host, 'ejection').textContent).toContain('Bob은(는) 조직에서 축출되었습니다. 그는 밀정이었습니다.');
    ui.update(view({ phase: 'playing', meeting: null, lastEjection: { playerId: null, role: null } }));
    expect(q(host, 'ejection').hidden).toBe(true);
    expect(revealedRoles.get('b')).toBe('spy');
    ui.update(view({ startedAt: 2 }));
    expect(revealedRoles.has('b')).toBe(false);
  });
  test('ghost chat float only for ghosts while playing', () => {
    const { host, ui } = mount();
    ui.setGhostChatOpen(true);
    ui.update(view({ phase: 'playing', meeting: null }));
    expect(q(host, 'ghost-chat')).toBeNull();
    ui.update(view({ phase: 'playing', meeting: null, me: { ...view().me, alive: false } }));
    expect(q(host, 'ghost-chat')).not.toBeNull();
    ui.setGhostChatOpen(false);
    expect(q(host, 'ghost-chat')).toBeNull();
    ui.destroy();
  });
});

describe('result', () => {
  test('banner, all roles, host-only back button', () => {
    const r = roster.map((p, i) => ({ ...p, role: i === 1 ? ('spy' as const) : ('fighter' as const) }));
    let back = 0;
    const host = resultContent(view({ phase: 'ended', winner: 'fighters', roster: r }), true, () => back++);
    expect(q(host, 'result-winner').textContent).toBe('독립투사 승리');
    expect(q(host, 'result-player-b').textContent).toContain('밀정');
    expect(q(host, 'result-player-a').textContent).toContain('독립투사');
    q(host, 'back-to-lobby').click();
    expect(back).toBe(1);
    const guest = resultContent(view({ phase: 'ended', winner: 'spies', roster: r }), false, () => {});
    expect(q(guest, 'result-winner').textContent).toBe('밀정 승리');
    expect(q(guest, 'back-to-lobby')).toBeNull();
  });
});
