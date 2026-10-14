import { expect, test } from 'vitest';
import { startMeeting } from '../src/index';
import { newGame, placeAt } from './helpers';

test('startMeeting teleports alive to spawns, clears traces & sabotage, sets publiclyDead and timers', () => {
  const s = newGame(6, 1, 1000);
  const [a, b, c, d] = s.order;
  s.players[b].alive = false;
  placeAt(s, b, { x: 3, y: 3 });
  s.players[d].alive = false;
  s.publiclyDead = [d];
  s.players[a].dir = { x: 1, y: 0 };
  s.traces.push({ id: 't0', victimId: b, pos: { x: 3, y: 3 } });
  s.sabotage = { kind: 'blackout' };
  s.meetingChat = [{ from: 'x', text: 'old', at: 0 }];
  const ev = startMeeting(s, c, 'report', b, 5000);
  expect(ev).toEqual([{ e: 'meetingStarted', reason: 'report', caller: c }]);
  expect(s.phase).toBe('meeting');
  expect(s.traces).toEqual([]);
  expect(s.sabotage).toBeNull();
  expect(s.meetingChat).toEqual([]);
  expect(s.players[a].pos).toEqual(s.map.spawns[0]);
  expect(s.players[c].pos).toEqual(s.map.spawns[1]);
  expect(s.players[s.order[4]].pos).toEqual(s.map.spawns[2]);
  expect(s.players[a].dir).toEqual({ x: 0, y: 0 });
  expect(s.players[b].pos).toEqual({ x: 3, y: 3 });
  expect([...s.publiclyDead].sort()).toEqual([b, d].sort());
  expect(s.meeting).toEqual({
    callerId: c,
    reason: 'report',
    reportedVictimId: b,
    discussEndsAt: 5000 + s.config.discussMs,
    voteEndsAt: 5000 + s.config.discussMs + s.config.voteMs,
    votes: {},
  });
});
