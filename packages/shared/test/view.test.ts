import { expect, test } from 'vitest';
import { DEFAULT_CONFIG, resolveMeeting, startMeeting, viewFor } from '../src/index';
import type { GameState } from '../src/index';
import { fighters, newGame, placeAt, spies } from './helpers';

const NOW = 5000;
const F = (s: GameState) => fighters(s)[0].id;
const S = (s: GameState) => spies(s)[0].id;

test('fighter view never contains another player role', () => {
  const s = newGame(6);
  const f = F(s);
  const v = viewFor(s, f, NOW);
  expect(v.roster.filter((r) => r.id !== f).every((r) => r.role === null)).toBe(true);
  expect(JSON.stringify(v)).not.toContain('"spy"');
  expect(v.me.fellowSpies).toEqual([]);
  expect(() => viewFor(s, 'nobody', NOW)).toThrow();
});

test('spy sees fellow spies', () => {
  const s = newGame(8);
  const [a, b] = spies(s);
  const v = viewFor(s, a.id, NOW);
  expect(v.me.fellowSpies).toEqual([b.id]);
  expect(v.roster.find((r) => r.id === b.id)!.role).toBe('spy');
  expect(v.roster.filter((r) => r.role === 'fighter')).toHaveLength(0);
  expect(v.roster.filter((r) => r.role === 'spy')).toHaveLength(2);
});

test('alive fighter: radius 5, 1.5 in blackout, ghosts invisible, self excluded', () => {
  const s = newGame(6);
  const f = F(s);
  const others = s.order.filter((id) => id !== f);
  placeAt(s, f, { x: 10, y: 10 });
  placeAt(s, others[0], { x: 14, y: 10 });
  placeAt(s, others[1], { x: 16, y: 10 });
  placeAt(s, others[2], { x: 11, y: 10 });
  s.players[others[2]].alive = false;
  for (const id of others.slice(3)) if (s.players[id].role !== 'spy') s.players[id].left = true;
  let v = viewFor(s, f, NOW);
  expect(v.visionRadius).toBe(5);
  expect(v.visible.map((x) => x.id)).toEqual([others[0]]);
  s.sabotage = { kind: 'blackout' };
  v = viewFor(s, f, NOW);
  expect(v.visionRadius).toBe(DEFAULT_CONFIG.visionBlackout);
  expect(v.visible).toEqual([]);
  expect(v.sabotage).toEqual({ kind: 'blackout' });
  // spy unaffected by blackout
  const sp = S(s);
  expect(viewFor(s, sp, NOW).visionRadius).toBe(6);
});

test('ghost sees everyone (not left) and ghostChat; alive gets []', () => {
  const s = newGame(6);
  const f = F(s);
  const sp = S(s);
  s.players[f].alive = false;
  s.ghostChat.push({ from: f, text: 'boo', at: 1 });
  s.traces.push({ id: 't1', victimId: f, pos: { x: 40, y: 40 } });
  const left = s.order.find((id) => id !== f && id !== sp)!;
  s.players[left].left = true;
  const v = viewFor(s, f, NOW);
  expect(v.visible.map((x) => x.id).sort()).toEqual(
    s.order.filter((id) => id !== f && id !== left).sort(),
  );
  expect(v.ghostChat).toHaveLength(1);
  expect(v.traces).toHaveLength(1);
  expect(Number.isFinite(v.visionRadius)).toBe(true);
  expect(viewFor(s, sp, NOW).ghostChat).toEqual([]);
});

test('traces filtered by radius for alive viewers', () => {
  const s = newGame(6);
  const f = F(s);
  placeAt(s, f, { x: 10, y: 10 });
  s.traces.push({ id: 'a', victimId: 'x', pos: { x: 12, y: 10 } });
  s.traces.push({ id: 'b', victimId: 'x', pos: { x: 30, y: 10 } });
  expect(viewFor(s, f, NOW).traces.map((t) => t.id)).toEqual(['a']);
});

test('meeting exposes who voted but not targets', () => {
  const s = newGame(6);
  startMeeting(s, 'p0', 'bell', null, 2000);
  s.meeting!.votes = { p1: 'p2', p3: 'skip' };
  const v = viewFor(s, 'p0', NOW);
  expect(v.meeting!.voted.sort()).toEqual(['p1', 'p3']);
  expect(JSON.stringify(v)).not.toContain('votes');
  expect(JSON.stringify(v.meeting)).not.toContain('skip');
});

test('sabotageReadyAt only for spies', () => {
  const s = newGame(6);
  expect(viewFor(s, S(s), NOW).sabotageReadyAt).toBe(s.sabotageReadyAt);
  expect(viewFor(s, F(s), NOW).sabotageReadyAt).toBeNull();
});

test('ended view reveals all roles', () => {
  const s = newGame(6);
  s.phase = 'ended';
  s.winner = 'spies';
  const v = viewFor(s, F(s), NOW);
  for (const r of v.roster) expect(r.role).toBe(s.players[r.id].role);
});

test('ejection reveal respects config; no leaks across states; no null radius', () => {
  const states: [string, GameState][] = [];
  states.push(['playing', newGame(7)]);
  const m = newGame(7);
  startMeeting(m, 'p0', 'bell', null, 2000);
  m.meeting!.votes = { p1: 'p2' };
  states.push(['meeting', m]);
  const hidden = newGame(7);
  hidden.config = { ...hidden.config, revealRoleOnEject: false };
  const target = spies(hidden)[0].id;
  startMeeting(hidden, F(hidden), 'bell', null, 2000);
  for (const id of hidden.order) if (id !== target) hidden.meeting!.votes[id] = target;
  resolveMeeting(hidden, 3000);
  expect(hidden.phase).toBe('ejecting');
  states.push(['ejecting-hidden', hidden]);
  const shown = newGame(7);
  startMeeting(shown, F(shown), 'bell', null, 2000);
  const t2 = spies(shown)[0].id;
  for (const id of shown.order) if (id !== t2) shown.meeting!.votes[id] = t2;
  resolveMeeting(shown, 3000);
  states.push(['ejecting-shown', shown]);
  const ended = newGame(7);
  ended.phase = 'ended';
  ended.winner = 'fighters';
  states.push(['ended', ended]);

  for (const [name, s] of states) {
    for (const id of s.order) {
      const v = viewFor(s, id, NOW);
      const json = JSON.stringify(v);
      const parsed = JSON.parse(json);
      expect(typeof parsed.visionRadius, name).toBe('number');
      expect(parsed.visionRadius, name).toBeGreaterThan(0);
      if (s.players[id].role === 'fighter' && s.phase !== 'ended') {
        for (const r of v.roster) {
          if (r.id === id) continue;
          const revealed = s.lastEjection?.role && s.lastEjection.playerId === r.id;
          if (!revealed) expect(r.role, `${name} ${id}->${r.id}`).toBeNull();
        }
        if (!s.lastEjection?.role) expect(json, name).not.toContain('"spy"');
      }
    }
  }
  // reveal off: ejected spy hidden from fighter; reveal on: shown
  const fh = viewFor(hidden, F(hidden), NOW);
  expect(fh.roster.find((r) => r.id === target)!.role).toBeNull();
  expect(fh.lastEjection).toEqual({ playerId: target, role: null });
  const fs = viewFor(shown, F(shown), NOW);
  expect(fs.roster.find((r) => r.id === t2)!.role).toBe('spy');
});

test('left viewer gets no positions or traces', () => {
  const s = newGame(6);
  const f = F(s);
  s.players[f].alive = false;
  s.players[f].left = true;
  s.traces.push({ id: 't1', victimId: 'x', pos: { x: 3, y: 3 } });
  const v = viewFor(s, f, NOW);
  expect(v.visible).toEqual([]);
  expect(v.traces).toEqual([]);
  expect(v.ghostChat).toEqual([]);
});

test('returned view does not alias state', () => {
  const s = newGame(6);
  const f = F(s);
  s.traces.push({ id: 't1', victimId: 'x', pos: { x: s.players[f].pos.x, y: s.players[f].pos.y } });
  s.meetingChat.push({ from: f, text: 'hi', at: 1 });
  const before = JSON.stringify(s);
  const v = viewFor(s, f, NOW);
  v.me.pos.x += 99;
  v.me.tasks[0].done = !v.me.tasks[0].done;
  v.traces[0].pos.x += 99;
  v.chat[0].text = 'changed';
  expect(JSON.stringify(s)).toBe(before);
});
