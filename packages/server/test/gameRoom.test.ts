import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { type ColyseusSDK, type Room as SDKRoom } from '@colyseus/sdk';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { DEFAULT_CONFIG, FAST_CONFIG, type GameEvent, type PlayerView } from '@miljeong/shared';
import { GameRoom, type LobbyMsg } from '../src/GameRoom';

/** Records every message a client receives. */
interface Probe {
  room: SDKRoom;
  views: PlayerView[];
  events: GameEvent[];
  lobby: LobbyMsg[];
  rejected: { reason: string }[];
  errors: { code: string }[];
}

let colyseus: ColyseusTestServer;
let sdk: ColyseusSDK;
const open: SDKRoom[] = [];

function probe(room: SDKRoom): Probe {
  const p: Probe = { room, views: [], events: [], lobby: [], rejected: [], errors: [] };
  room.onMessage('view', (v: PlayerView) => p.views.push(v));
  room.onMessage('events', (e: GameEvent[]) => p.events.push(...e));
  room.onMessage('lobby', (l: LobbyMsg) => p.lobby.push(l));
  room.onMessage('rejected', (r: { reason: string }) => p.rejected.push(r));
  room.onMessage('error', (e: { code: string }) => p.errors.push(e));
  open.push(room);
  return p;
}

async function waitFor(cond: () => boolean, ms = 5000, what = 'condition'): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const serverRoom = (id: string): GameRoom => colyseus.getRoomById<GameRoom>(id);

async function createLobby(n: number): Promise<{ code: string; ps: Probe[]; room: GameRoom }> {
  const host = probe(await sdk.create('game', { name: 'P0' }));
  const code = host.room.roomId;
  const ps = [host];
  for (let i = 1; i < n; i++) ps.push(probe(await sdk.joinById(code, { name: `P${i}` })));
  await waitFor(() => ps.every((p) => p.lobby.at(-1)?.players.length === n), 5000, 'lobby sync');
  return { code, ps, room: serverRoom(code) };
}

async function startGame(n: number) {
  const lob = await createLobby(n);
  lob.ps[0].room.send('start');
  await waitFor(() => lob.room.game !== null && lob.ps.every((p) => p.views.length > 0), 5000, 'game start');
  return lob;
}

async function joinError(p: Promise<unknown>): Promise<{ code: number; message: string }> {
  try {
    const r = await p;
    open.push(r as SDKRoom);
  } catch (e) {
    const err = e as { code: number; message: string };
    return { code: err.code, message: err.message };
  }
  throw new Error('join unexpectedly succeeded');
}

beforeAll(async () => {
  const server = new Server({ transport: new WebSocketTransport(), greet: false });
  server.define('game', GameRoom, { configName: 'default' });
  server.define('game-fast', GameRoom, { configName: 'fast' });
  colyseus = await boot(server);
  sdk = colyseus.sdk;
});

afterEach(async () => {
  for (const r of open.splice(0)) {
    if (r.connection?.isOpen) await r.leave(true).catch(() => {});
  }
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe('GameRoom', () => {
  test('create → code; 4 join by code; non-host start → NOT_HOST; host start with 3 → NOT_ENOUGH_PLAYERS', async () => {
    const { code, ps, room } = await createLobby(3);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    const last = ps[2].lobby.at(-1)!;
    expect(last).toEqual({
      code,
      hostId: ps[0].room.sessionId,
      players: ps.map((p, i) => ({ id: p.room.sessionId, name: `P${i}` })),
      phase: 'lobby',
    });
    ps[1].room.send('start');
    await waitFor(() => ps[1].errors.length > 0);
    expect(ps[1].errors[0]).toEqual({ code: 'NOT_HOST' });
    ps[0].room.send('start');
    await waitFor(() => ps[0].errors.length > 0);
    expect(ps[0].errors[0]).toEqual({ code: 'NOT_ENOUGH_PLAYERS' });
    expect(room.game).toBeNull();

    ps.push(probe(await sdk.joinById(code, { name: '  P3  ' })));
    await waitFor(() => ps[0].lobby.at(-1)?.players.length === 4);
    expect(ps[0].lobby.at(-1)!.players[3].name).toBe('P3');
    ps[0].room.send('start');
    await waitFor(() => ps.every((p) => p.views.length > 0));
    expect(room.game).not.toBeNull();
    expect(ps[0].lobby.at(-1)!.phase).toBe('inGame');
    for (const p of ps) expect(p.views.at(-1)!.me.id).toBe(p.room.sessionId);
  });

  test('config comes from the room definition only, never from client options', async () => {
    const a = probe(await sdk.create('game', { name: 'A', configName: 'fast' }));
    expect(serverRoom(a.room.roomId).config).toBe(DEFAULT_CONFIG);
    const b = probe(await sdk.create('game-fast', { name: 'B' }));
    expect(serverRoom(b.room.roomId).config).toBe(FAST_CONFIG);
    expect(serverRoom(b.room.roomId).maxClients).toBe(10);
  });

  test('lobby: host leaves → earliest remaining becomes host', async () => {
    const { ps } = await createLobby(3);
    await ps[0].room.leave(true);
    await waitFor(() => ps[1].lobby.at(-1)?.players.length === 2);
    const l = ps[1].lobby.at(-1)!;
    expect(l.hostId).toBe(ps[1].room.sessionId);
    expect(l.players.map((p) => p.id)).toEqual([ps[1].room.sessionId, ps[2].room.sessionId]);
  });

  test('full round via intents: start, spy informs fighter (teleport via test hook), fighter reports, all vote spy, fighters win', async () => {
    const { ps, room } = await startGame(4);
    const game = room.game!;
    const byId = new Map(ps.map((p) => [p.room.sessionId, p]));
    const spyId = game.order.find((id) => game.players[id].role === 'spy')!;
    const fighters = game.order.filter((id) => id !== spyId);
    const [victim, reporter] = fighters;
    // test hook: put the victim next to the spy and clear the cooldown
    const sp = game.players[spyId];
    game.players[victim].pos = { x: sp.pos.x, y: sp.pos.y };
    sp.informReadyAt = 0;
    byId.get(spyId)!.room.send('intent', { t: 'inform', target: victim });
    await waitFor(() => game.players[victim].alive === false, 5000, 'inform');
    // informed event only to spies and the victim
    await waitFor(() => byId.get(victim)!.events.some((e) => e.e === 'informed'));
    await waitFor(() => byId.get(spyId)!.events.some((e) => e.e === 'informed'));
    await new Promise((r) => setTimeout(r, 150));
    for (const id of fighters.filter((f) => f !== victim)) {
      expect(byId.get(id)!.events.some((e) => e.e === 'informed')).toBe(false);
    }
    // reporter next to the trace
    const tr = game.traces[0];
    game.players[reporter].pos = { x: tr.pos.x, y: tr.pos.y };
    byId.get(reporter)!.room.send('intent', { t: 'report' });
    await waitFor(() => ps.every((p) => p.events.some((e) => e.e === 'meetingStarted')), 5000, 'meeting');
    expect(game.phase).toBe('meeting');
    for (const id of game.order) {
      if (game.players[id].alive) byId.get(id)!.room.send('intent', { t: 'vote', target: spyId });
    }
    await waitFor(
      () => ps.every((p) => p.views.at(-1)?.phase === 'ended' && p.views.at(-1)?.winner === 'fighters'),
      5000,
      'ended views',
    );
    for (const p of ps) expect(p.events.some((e) => e.e === 'gameEnded' && e.winner === 'fighters')).toBe(true);
  });

  test('rejected intent goes only to the sender with a reason; malformed intent → BAD_INPUT', async () => {
    const { ps, room } = await startGame(4);
    const game = room.game!;
    const fighterId = game.order.find((id) => game.players[id].role === 'fighter')!;
    const f = ps.find((p) => p.room.sessionId === fighterId)!;
    f.room.send('intent', { t: 'inform', target: game.order[0] });
    await waitFor(() => f.rejected.length > 0);
    expect(f.rejected[0]).toEqual({ reason: 'WRONG_ROLE' });
    f.room.send('intent', 'garbage');
    f.room.send('intent', null);
    await waitFor(() => f.rejected.length >= 3);
    expect(f.rejected.slice(1)).toEqual([{ reason: 'BAD_INPUT' }, { reason: 'BAD_INPUT' }]);
    await new Promise((r) => setTimeout(r, 100));
    for (const p of ps) if (p !== f) expect(p.rejected).toEqual([]);
  });

  test('info hiding: every fighter client never received a view whose roster leaks another role or a non-visible pos', async () => {
    const { ps, room } = await startGame(7);
    const game = room.game!;
    // spread players around: move everybody for a while in different directions
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 0.7071, y: 0.7071 },
      { x: -0.7071, y: 0.7071 },
      { x: 0.7071, y: -0.7071 },
    ];
    ps.forEach((p, i) => p.room.send('intent', { t: 'move', dir: dirs[i] }));
    const leaks: string[] = [];
    // check each view against the authoritative state at reception time
    for (const p of ps) {
      p.room.onMessage('view', (v: PlayerView) => {
        const me = game.players[v.me.id];
        if (me.role !== 'fighter' || game.phase === 'ended') return;
        for (const r of v.roster) {
          if (r.id !== v.me.id && r.role !== null) leaks.push(`role of ${r.id} to ${v.me.id}`);
        }
        for (const o of v.visible) {
          const d = Math.hypot(o.pos.x - v.me.pos.x, o.pos.y - v.me.pos.y);
          if (d > v.visionRadius + 1e-9) leaks.push(`pos of ${o.id} at ${d} to ${v.me.id}`);
        }
      });
    }
    await new Promise((r) => setTimeout(r, 1500));
    ps.forEach((p) => p.room.send('intent', { t: 'move', dir: { x: 0, y: 0 } }));
    await new Promise((r) => setTimeout(r, 150));
    const byId = new Map(ps.map((p) => [p.room.sessionId, p]));
    const spies = game.order.filter((id) => game.players[id].role === 'spy');
    const fighters = game.order.filter((id) => game.players[id].role === 'fighter');
    // two fighters complete a task each (teleport onto the spot, backdate the start)
    for (const fid of fighters.slice(0, 2)) {
      const task = game.players[fid].tasks[0];
      const spot = game.map.taskSpots.find((t) => t.id === task.taskId)!;
      game.players[fid].pos = { ...spot.pos };
      byId.get(fid)!.room.send('intent', { t: 'taskStart', taskId: task.taskId });
      await waitFor(() => task.startedAt !== null, 5000, 'taskStart');
      task.startedAt = Date.now() - game.config.taskMinMs - 100;
      byId.get(fid)!.room.send('intent', { t: 'taskComplete', taskId: task.taskId });
      await waitFor(() => task.done, 5000, 'taskComplete');
    }
    // a spy informs a third fighter
    const victim = fighters[2];
    const sp = game.players[spies[0]];
    game.players[victim].pos = { ...sp.pos };
    sp.informReadyAt = 0;
    byId.get(spies[0])!.room.send('intent', { t: 'inform', target: victim });
    await waitFor(() => !game.players[victim].alive, 5000, 'inform');
    await new Promise((r) => setTimeout(r, 200));
    expect(game.phase).toBe('playing');
    // event delivery: taskDone only to its own player; informed only to spies + victim
    for (const p of ps) {
      const me = p.room.sessionId;
      for (const e of p.events) {
        if (e.e === 'taskDone') expect(e.player).toBe(me);
        if (e.e === 'informed') expect(spies.includes(me) || e.victim === me).toBe(true);
      }
    }
    for (const fid of fighters.slice(0, 2)) {
      expect(byId.get(fid)!.events.filter((e) => e.e === 'taskDone')).toEqual([{ e: 'taskDone', player: fid }]);
    }
    for (const id of [...spies, victim]) {
      expect(byId.get(id)!.events.some((e) => e.e === 'informed' && e.victim === victim)).toBe(true);
    }
    const fighterProbes = ps.filter((p) => game.players[p.room.sessionId].role === 'fighter');
    expect(fighterProbes.length).toBe(5);
    for (const p of fighterProbes) {
      expect(p.views.length).toBeGreaterThan(10);
      for (const v of p.views) {
        for (const r of v.roster) if (r.id !== v.me.id) expect(r.role).toBeNull();
        expect(v.me.fellowSpies).toEqual([]);
        expect(v.sabotageReadyAt).toBeNull();
        for (const o of v.visible) {
          expect(Math.hypot(o.pos.x - v.me.pos.x, o.pos.y - v.me.pos.y)).toBeLessThanOrEqual(v.visionRadius);
        }
      }
    }
    // at least one fighter must have lost sight of someone, otherwise the test proves nothing
    expect(fighterProbes.some((p) => p.views.at(-1)!.visible.length < 6)).toBe(true);
    expect(leaks).toEqual([]);
  });

  test('join started room → ROOM_STARTED; 11th join fails; bad name rejected', async () => {
    // the SDK console.warn()s when a join is refused after the socket opened
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // bad names
    const lob = await createLobby(1);
    for (const name of ['', '   ', 'ABCDEFGHIJKLM', undefined, 42]) {
      const err = await joinError(sdk.joinById(lob.code, { name } as never));
      expect(err.message).toBe('BAD_NAME');
      expect(err.code).toBe(4100);
    }
    const badCreate = await joinError(sdk.create('game', { name: ' ' }));
    expect(badCreate).toEqual({ code: 4100, message: 'BAD_NAME' });
    // 12 chars after trim is fine
    open.push(await sdk.joinById(lob.code, { name: ' 가나다라마바사아자차카타 ' }));

    // room not found
    const nf = await joinError(sdk.joinById('ZZZZZZ', { name: 'X' }));
    expect(nf.code).toBe(522);
    expect(nf.message).toBe('room "ZZZZZZ" not found');

    // full room: 10 players then the 11th
    const full = await createLobby(10);
    const eleventh = await joinError(sdk.joinById(full.code, { name: 'P10' }));
    expect(eleventh.code).toBe(522);
    expect(eleventh.message).toBe(`room "${full.code}" is locked`);

    // started room
    const st = await startGame(4);
    const started = await joinError(sdk.joinById(st.code, { name: 'Late' }));
    expect(started.code).toBe(4101);
    expect(started.message).toBe('ROOM_STARTED');
    expect(Object.keys(st.room.game!.players)).toHaveLength(4);
    warn.mockRestore();
  });

  test('chat rate: second chat within 1s → CHAT_RATE error', async () => {
    const { ps, room } = await startGame(4);
    const game = room.game!;
    // make the first player a ghost so that chat is allowed outside a meeting
    const p = ps[0];
    game.players[p.room.sessionId].alive = false;
    p.room.send('intent', { t: 'chat', text: 'hello' });
    p.room.send('intent', { t: 'chat', text: 'again' });
    await waitFor(() => p.errors.length > 0);
    expect(p.errors).toEqual([{ code: 'CHAT_RATE' }]);
    expect(game.ghostChat.map((c) => c.text)).toEqual(['hello']);
    await new Promise((r) => setTimeout(r, game.config.chatMinIntervalMs + 50));
    p.room.send('intent', { t: 'chat', text: 'later' });
    await waitFor(() => game.ghostChat.length === 2);
    expect(p.errors).toHaveLength(1);
  });

  test('host leaves mid-game → game continues; after end, backToLobby by new host works', async () => {
    const { ps, room, code } = await startGame(5);
    const game = room.game!;
    const hostId = ps[0].room.sessionId;
    // make sure the host is a fighter so the game continues after they leave
    const spyId = game.order.find((id) => game.players[id].role === 'spy')!;
    if (spyId === hostId) {
      const other = game.order[1];
      game.players[hostId].role = 'fighter';
      game.players[hostId].tasks = game.players[other].tasks.map((t) => ({ ...t }));
      game.players[other].role = 'spy';
      game.players[other].tasks = [];
    }
    await ps[0].room.leave(true);
    await waitFor(() => game.players[hostId].left === true);
    expect(game.phase).toBe('playing');
    const newHost = ps[1];
    await waitFor(() => newHost.lobby.at(-1)?.hostId === newHost.room.sessionId, 5000, 'host passed');
    expect(newHost.lobby.at(-1)!.phase).toBe('inGame');

    // backToLobby before the end is ignored
    newHost.room.send('backToLobby');
    await new Promise((r) => setTimeout(r, 100));
    expect(room.game).not.toBeNull();

    // end the game: everyone votes out the spy
    const realSpy = game.order.find((id) => game.players[id].role === 'spy')!;
    const reporter = game.order.find((id) => id !== realSpy && !game.players[id].left)!;
    const victim = game.order.find((id) => id !== realSpy && id !== reporter && !game.players[id].left)!;
    const sp = game.players[realSpy];
    game.players[victim].pos = { ...sp.pos };
    sp.informReadyAt = 0;
    const byId = new Map(ps.map((p) => [p.room.sessionId, p]));
    byId.get(realSpy)!.room.send('intent', { t: 'inform', target: victim });
    await waitFor(() => game.traces.length === 1);
    game.players[reporter].pos = { ...game.traces[0].pos };
    byId.get(reporter)!.room.send('intent', { t: 'report' });
    await waitFor(() => game.phase === 'meeting');
    for (const id of game.order) {
      if (game.players[id].alive && !game.players[id].left) byId.get(id)!.room.send('intent', { t: 'vote', target: realSpy });
    }
    await waitFor(() => game.phase === 'ended');
    expect(game.winner).toBe('fighters');

    // a non-host cannot go back
    const nonHost = ps[2];
    nonHost.room.send('backToLobby');
    await waitFor(() => nonHost.errors.length > 0);
    expect(nonHost.errors[0]).toEqual({ code: 'NOT_HOST' });

    newHost.room.send('backToLobby');
    await waitFor(() => newHost.lobby.at(-1)?.phase === 'lobby', 5000, 'back to lobby');
    const l = newHost.lobby.at(-1)!;
    expect(l.code).toBe(code);
    expect(l.hostId).toBe(newHost.room.sessionId);
    expect(l.players.map((p) => p.id)).toEqual(ps.slice(1).map((p) => p.room.sessionId));
    expect(room.game).toBeNull();
    // the room accepts joins again and can start a new game
    const late = probe(await sdk.joinById(code, { name: 'Late' }));
    await waitFor(() => newHost.lobby.at(-1)?.players.length === 5);
    newHost.room.send('start');
    await waitFor(() => room.game !== null && late.views.length > 0, 5000, 'second game');
  });

  test('disconnect then reconnect within grace keeps player in game', async () => {
    const { ps, room } = await startGame(4);
    const game = room.game!;
    const p = ps[1];
    const id = p.room.sessionId;
    p.room.reconnection.enabled = false;
    const token = p.room.reconnectionToken;
    await p.room.leave(false);
    await waitFor(() => game.players[id].connected === false, 5000, 'disconnected');
    expect(game.players[id].left).toBe(false);
    expect(game.players[id].disconnectDeadline).not.toBeNull();
    await waitFor(() => ps[0].views.at(-1)!.roster.find((r) => r.id === id)!.connected === false);

    const again = probe(await sdk.reconnect(token));
    expect(again.room.sessionId).toBe(id);
    await waitFor(() => game.players[id].connected === true, 5000, 'reconnected');
    expect(game.players[id].left).toBe(false);
    expect(game.players[id].disconnectDeadline).toBeNull();
    await waitFor(() => again.views.length > 0);
    expect(again.views.at(-1)!.me.id).toBe(id);
    again.room.send('intent', { t: 'move', dir: { x: 0, y: 0 } });
    await new Promise((r) => setTimeout(r, 100));
    expect(again.rejected).toEqual([]);
  });

  test('disconnect past the grace period → player is marked left', async () => {
    const { ps, room } = await startGame(5);
    const game = room.game!;
    const p = ps[2];
    const id = p.room.sessionId;
    p.room.reconnection.enabled = false;
    const token = p.room.reconnectionToken;
    await p.room.leave(false);
    await waitFor(() => game.players[id].connected === false);
    // pull the deadline into the past; the tick loop must mark the player left
    game.players[id].disconnectDeadline = Date.now() - 1;
    await waitFor(() => game.players[id].left === true, 5000, 'left by deadline');
    // ...and the pending Colyseus reconnection must have been rejected
    await new Promise((r) => setTimeout(r, 100));
    let reconnected = false;
    try {
      open.push(await sdk.reconnect(token));
      reconnected = true;
    } catch (e) {
      expect((e as { code: number }).code).toBe(524);
    }
    expect(reconnected).toBe(false);
    expect(room.clients.getById(id)).toBeUndefined();
  });

  test('exception inside tick closes only that room; another room keeps running', async () => {
    const a = await startGame(4);
    const b = await startGame(4);
    const left: number[] = [];
    a.ps[0].room.onLeave((code) => left.push(code));
    const errSpy = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      // sabotage room A's state so that tick() throws
      (a.room.game as unknown as { order: unknown }).order = null;
      await waitFor(() => left.length > 0, 5000, 'room A closed');
    } finally {
      console.error = errSpy;
    }
    expect(logged.length).toBeGreaterThan(0);
    await waitFor(() => matchMaker.getLocalRoomById(a.code) === undefined, 5000, 'room A disposed');
    const before = b.ps[0].views.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(b.ps[0].views.length).toBeGreaterThan(before);
    expect(matchMaker.getLocalRoomById(b.code)).toBeDefined();
  });

  test('exception inside onLeave closes only that room', async () => {
    const a = await createLobby(2);
    const b = await createLobby(2);
    const codes: number[] = [];
    a.ps[1].room.onLeave((code) => codes.push(code));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      (a.room as unknown as { lobby: unknown }).lobby = null; // handleLeave will throw
      await a.ps[0].room.leave(true);
      await waitFor(() => codes.length > 0, 5000, 'room A closed');
      expect(codes[0]).toBe(4002);
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
    await waitFor(() => matchMaker.getLocalRoomById(a.code) === undefined, 5000, 'room A disposed');
    expect(matchMaker.getLocalRoomById(b.code)).toBeDefined();
    const late = probe(await sdk.joinById(b.code, { name: 'Late' }));
    await waitFor(() => late.lobby.at(-1)?.players.length === 3);
  });
});
