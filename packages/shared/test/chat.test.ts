import { expect, test } from 'vitest';
import { applyIntent, startMeeting } from '../src/index';
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
