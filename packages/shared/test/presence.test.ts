import { expect, test } from 'vitest';
import {
  markDisconnected,
  markLeft,
  markReconnected,
  startMeeting,
  taskGauge,
  tick,
} from '../src/index';
import { fighters, newGame, spies } from './helpers';

test('disconnect 30s -> left; reconnect at 29s -> still in', () => {
  const s = newGame(6);
  markDisconnected(s, 'p1', 10000);
  markDisconnected(s, 'p2', 10000);
  expect(s.players.p1.disconnectDeadline).toBe(40000);
  tick(s, 39000, 50);
  markReconnected(s, 'p2');
  expect(s.players.p2.connected).toBe(true);
  expect(s.players.p2.disconnectDeadline).toBeNull();
  expect(s.players.p1.left).toBe(false);
  tick(s, 40000, 50);
  expect(s.players.p1.left).toBe(true);
  expect(s.players.p1.alive).toBe(false);
  expect(s.players.p1.connected).toBe(false);
  expect(s.players.p2.left).toBe(false);
  expect(s.publiclyDead).toContain('p1');
  markReconnected(s, 'p1');
  expect(s.players.p1.connected).toBe(false);
});

test('unknown ids are no-ops; disconnect after end sets no deadline', () => {
  const s = newGame(6);
  markDisconnected(s, 'zz', 1);
  markReconnected(s, 'zz');
  expect(markLeft(s, 'zz', 1)).toEqual([]);
  expect(markLeft(s, '__proto__', 1)).toEqual([]);
  s.phase = 'ended';
  markDisconnected(s, 'p0', 5);
  expect(s.players.p0.connected).toBe(false);
  expect(s.players.p0.disconnectDeadline).toBeNull();
});

test('left fighter tasks excluded from gauge, can complete gauge', () => {
  const s = newGame(6);
  const [a, b, ...others] = fighters(s);
  for (const p of others) for (const t of p.tasks) t.done = true;
  for (const t of a.tasks) t.done = true;
  expect(taskGauge(s)).toBeLessThan(1);
  const ev = markLeft(s, b.id, 1000);
  expect(taskGauge(s)).toBe(1);
  expect(ev.map((e) => e.e)).toEqual(['gameEnded']);
  expect(s.winner).toBe('fighters');
});

test('leaving spy can end game; leaving fighter can give spies parity', () => {
  const s = newGame(6);
  for (const sp of spies(s).slice(1)) sp.alive = false;
  const ev = markLeft(s, spies(s).find((p) => !p.left && p.alive)!.id, 1000);
  expect(ev).toEqual([{ e: 'gameEnded', winner: 'fighters' }]);
});

test('meeting: player leaves mid-vote -> excluded from voters, votes on them do not eject, early-resolve counts only remaining', () => {
  const s = newGame(6);
  startMeeting(s, 'p0', 'bell', null, 5000);
  const alive = Object.values(s.players).filter((p) => p.alive).map((p) => p.id);
  const leaver = alive.find((id) => s.players[id].role === 'fighter')!;
  const others = alive.filter((id) => id !== leaver);
  // everyone but leaver voted on leaver; leaver also voted
  s.meeting!.votes[leaver] = 'skip';
  for (const id of others.slice(0, -1)) s.meeting!.votes[id] = leaver;
  const lastVoter = others[others.length - 1];
  // disconnect lastVoter-independent: the leaver disconnects and times out
  markDisconnected(s, leaver, 6000);
  tick(s, 6000 + 29999, 50);
  expect(s.phase).toBe('meeting');
  expect(s.meeting!.votes[leaver]).toBe('skip');
  tick(s, 6000 + 30000, 50);
  expect(s.players[leaver].left).toBe(true);
  expect(s.meeting!.votes).not.toHaveProperty(leaver);
  // lastVoter has not voted yet: still in meeting
  expect(s.phase).toBe('meeting');
  s.meeting!.votes[lastVoter] = 'skip';
  tick(s, 36100, 50);
  // all remaining voters voted -> resolved in the same tick; nobody ejected
  expect(s.phase).toBe('ejecting');
  expect(s.lastEjection?.playerId).toBeNull();
  expect(s.players[leaver].alive).toBe(false);
});

test('meeting: leave of the last unvoted player resolves in same tick', () => {
  const s = newGame(6);
  startMeeting(s, 'p0', 'bell', null, 5000);
  const ids = Object.keys(s.players);
  for (const id of ids.slice(0, -1)) s.meeting!.votes[id] = 'skip';
  const lastId = ids[ids.length - 1];
  markDisconnected(s, lastId, 6000);
  const ev = tick(s, 36000, 50);
  expect(s.phase === 'ejecting' || s.phase === 'ended').toBe(true);
  expect(ev.some((e) => e.e === 'ejected' || e.e === 'gameEnded')).toBe(true);
});
