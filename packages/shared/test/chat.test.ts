import { expect, test } from 'vitest';
import { CHAT_HISTORY_MAX, applyIntent, resolveMeeting, startMeeting, viewFor } from '../src/index';
import type { GameState } from '../src/index';
import { newGame } from './helpers';

const chat = (s: GameState, id: string, text: unknown, now = 2000) =>
  applyIntent(s, id, { t: 'chat', text } as any, now);

test('chat rules', () => {
  const s = newGame();
  expect(chat(s, 'p0', 'hi')).toEqual({ ok: false, reason: 'WRONG_PHASE' });
  s.players.p1.alive = false;
  expect(chat(s, 'p1', '  boo  ').ok).toBe(true);
  expect(s.ghostChat).toEqual([{ from: 'p1', text: 'boo', at: 2000 }]);
  startMeeting(s, 'p0', 'bell', null, 5000);
  expect(chat(s, 'p0', ' hello ', 6000).ok).toBe(true);
  expect(s.meetingChat).toEqual([{ from: 'p0', text: 'hello', at: 6000 }]);
  expect(chat(s, 'p0', 'a'.repeat(100)).ok).toBe(true);
  expect(chat(s, 'p0', 'a'.repeat(101))).toEqual({ ok: false, reason: 'BAD_INPUT' });
  expect(chat(s, 'p0', '   ')).toEqual({ ok: false, reason: 'BAD_INPUT' });
  expect(chat(s, 'p0', 5)).toEqual({ ok: false, reason: 'BAD_INPUT' });
  expect(chat(s, 'p1', 'ghost in meeting').ok).toBe(true);
  expect(s.ghostChat).toHaveLength(2);
  expect(s.meetingChat).toHaveLength(2);
  s.players.p2.left = true;
  expect(chat(s, 'p2', 'x')).toEqual({ ok: false, reason: 'NOT_ALIVE' });
  expect(chat(s, '__proto__', 'x')).toEqual({ ok: false, reason: 'NOT_ALIVE' });
});

test('chat history is capped at CHAT_HISTORY_MAX (oldest dropped), in state and in every view', () => {
  expect(CHAT_HISTORY_MAX).toBe(50);
  const s = newGame();
  s.players.p1.alive = false;
  startMeeting(s, 'p0', 'bell', null, 1000);
  for (let i = 0; i < 70; i++) {
    expect(chat(s, 'p0', `m${i}`, 2000 + i).ok).toBe(true);
    expect(chat(s, 'p1', `g${i}`, 2000 + i).ok).toBe(true);
  }
  expect(s.meetingChat).toHaveLength(50);
  expect(s.meetingChat[0].text).toBe('m20');
  expect(s.meetingChat.at(-1)!.text).toBe('m69');
  expect(s.ghostChat).toHaveLength(50);
  expect(s.ghostChat[0].text).toBe('g20');
  // even if state was filled past the cap some other way, the view stays bounded
  s.ghostChat.push(...Array.from({ length: 30 }, (_, i) => ({ from: 'p1', text: `x${i}`, at: 0 })));
  const ghostView = viewFor(s, 'p1', 3000);
  expect(ghostView.chat).toHaveLength(50);
  expect(ghostView.ghostChat).toHaveLength(50);
  expect(ghostView.ghostChat.at(-1)!.text).toBe('x29');
});

test('meeting chat is cleared when the meeting resolves (not re-sent during the next playing phase)', () => {
  const s = newGame();
  startMeeting(s, 'p0', 'bell', null, 1000);
  expect(chat(s, 'p0', 'hello', 2000).ok).toBe(true);
  expect(viewFor(s, 'p2', 2000).chat).toHaveLength(1);
  resolveMeeting(s, 3000);
  expect(s.meetingChat).toEqual([]);
  expect(viewFor(s, 'p2', 3000).chat).toEqual([]);
});
