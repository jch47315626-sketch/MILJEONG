import { expect, test } from 'vitest';
import { applyIntent, resolveMeeting, startMeeting, tallyVotes, tick } from '../src/index';
import type { GameState } from '../src/index';
import { newGame, spies } from './helpers';

const vote = (s: GameState, id: string, target: string, now = 2000) =>
  applyIntent(s, id, { t: 'vote', target }, now);

function meeting(n = 6): GameState {
  const s = newGame(n, 1, 1000);
  startMeeting(s, 'p0', 'bell', null, 5000);
  return s;
}

test('tallyVotes', () => {
  expect(tallyVotes({ a: 'x', b: 'x', c: 'y' }, ['a', 'b', 'c', 'd'])).toBe('x');
  expect(tallyVotes({ a: 'x', b: 'y' }, ['a', 'b'])).toBeNull();
  expect(tallyVotes({ a: 'x' }, ['a', 'b', 'c'])).toBeNull();
  expect(tallyVotes({ a: 'x', b: 'skip' }, ['a', 'b'])).toBeNull();
  expect(tallyVotes({}, [])).toBeNull();
});

test('vote rejections', () => {
  const s = meeting();
  s.players.p1.alive = false;
  expect(vote(s, 'p1', 'skip')).toEqual({ ok: false, reason: 'NOT_ALIVE' });
  s.players.p2.left = true;
  expect(vote(s, 'p2', 'skip')).toEqual({ ok: false, reason: 'NOT_ALIVE' });
  expect(vote(s, 'p0', 'p1')).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  expect(vote(s, 'p0', 'p2')).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  expect(vote(s, 'p0', 'nobody')).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  expect(vote(s, 'p0', '__proto__')).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  expect(vote(s, 'p0', 'p0').ok).toBe(true);
  expect(vote(s, 'p0', 'skip')).toEqual({ ok: false, reason: 'ALREADY_USED' });
  expect(s.meeting!.votes).toEqual({ p0: 'p0' });
  const g = newGame();
  expect(vote(g, 'p0', 'skip')).toEqual({ ok: false, reason: 'WRONG_PHASE' });
});

test('meeting resolves at voteEndsAt; early when all alive voted', () => {
  const s = meeting();
  const end = s.meeting!.voteEndsAt;
  tick(s, end - 1, 100);
  expect(s.phase).toBe('meeting');
  tick(s, end, 100);
  expect(s.phase).toBe('ejecting');
  expect(s.meeting).toBeNull();
  expect(s.ejectingEndsAt).toBe(end + s.config.ejectingMs);

  const e = meeting();
  e.players.p5.alive = false;
  e.players.p4.left = true;
  for (const id of ['p0', 'p1', 'p2']) vote(e, id, 'skip');
  tick(e, 6000, 100);
  expect(e.phase).toBe('meeting');
  vote(e, 'p3', 'skip');
  const ev = tick(e, 6100, 100);
  expect(e.phase).toBe('ejecting');
  expect(ev).toEqual([{ e: 'ejected', ejection: { playerId: null, role: null } }]);
  expect(e.lastEjection).toEqual({ playerId: null, role: null });
});

test('ejection: ghost, publiclyDead, role shown/hidden', () => {
  for (const reveal of [true, false]) {
    const s = meeting();
    s.config = { ...s.config, revealRoleOnEject: reveal };
    s.players.p1.dir = { x: 1, y: 0 };
    for (const id of ['p0', 'p2', 'p3', 'p4']) vote(s, id, 'p1');
    s.publiclyDead.push('p1');
    const ev = resolveMeeting(s, 9000);
    expect(s.players.p1.alive).toBe(false);
    expect(s.players.p1.dir).toEqual({ x: 0, y: 0 });
    expect(s.publiclyDead.filter((x) => x === 'p1')).toHaveLength(1);
    const exp = { playerId: 'p1', role: reveal ? s.players.p1.role : null };
    expect(s.lastEjection).toEqual(exp);
    expect(ev).toEqual([{ e: 'ejected', ejection: exp }]);
    expect(s.phase).toBe('ejecting');
  }
});

test('ejection guard: left or dead top target is not ejected', () => {
  const s = meeting();
  for (const id of ['p0', 'p2', 'p3', 'p4']) vote(s, id, 'p1');
  s.players.p1.left = true;
  resolveMeeting(s, 9000);
  expect(s.players.p1.alive).toBe(true);
  expect(s.lastEjection).toEqual({ playerId: null, role: null });
  expect(s.publiclyDead).not.toContain('p1');
  expect(s.phase).toBe('ejecting');
});

test('ejecting -> playing after ejectingMs; spy cooldowns reset', () => {
  const s = meeting();
  resolveMeeting(s, 9000);
  const end = s.ejectingEndsAt!;
  s.players.p0.dir = { x: 1, y: 0 };
  tick(s, end - 1, 100);
  expect(s.phase).toBe('ejecting');
  tick(s, end, 100);
  expect(s.phase).toBe('playing');
  expect(s.ejectingEndsAt).toBeNull();
  expect(s.players.p0.dir).toEqual({ x: 0, y: 0 });
  for (const p of spies(s)) expect(p.informReadyAt).toBe(end + s.config.informCooldownMs);
  expect(s.sabotageReadyAt).toBe(end + s.config.sabotageCooldownMs);
});
