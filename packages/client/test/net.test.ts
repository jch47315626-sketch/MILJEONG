import { afterEach, describe, expect, test, vi } from 'vitest';

type Handler = (m: unknown) => void;
const handlers = new Map<string, Handler>();
let leaveHandler: ((code: number) => void) | null = null;
const sent: unknown[][] = [];

vi.mock('@colyseus/sdk', () => {
  class Client {
    constructor(public url: string) {}
    async create(_n: string, opts: unknown) {
      sent.push(['create', opts]);
      return fakeRoom();
    }
    async joinById(id: string, opts: unknown) {
      sent.push(['joinById', id, opts]);
      return fakeRoom();
    }
  }
  return { Client };
});

function fakeRoom() {
  return {
    roomId: 'ABC234',
    sessionId: 'me',
    onMessage: (t: string, cb: Handler) => handlers.set(t, cb),
    onLeave: (cb: (c: number) => void) => (leaveHandler = cb),
    send: (...a: unknown[]) => sent.push(['send', ...a]),
    leave: async () => {},
  };
}

import { Connection } from '../src/net';

afterEach(() => {
  handlers.clear();
  sent.length = 0;
});

describe('Connection', () => {
  test('registers all handlers synchronously and keeps the latest lobby', async () => {
    const c = await Connection.create('철수');
    for (const t of ['lobby', 'view', 'events', 'rejected', 'error']) expect(handlers.has(t)).toBe(true);
    expect(c.code).toBe('ABC234');
    expect(c.myId).toBe('me');
    const lobby = { code: 'ABC234', hostId: 'me', players: [{ id: 'me', name: '철수' }], phase: 'lobby' };
    handlers.get('lobby')!(lobby); // before any listener exists
    expect(c.lastLobby).toEqual(lobby);
    const seen: unknown[] = [];
    c.onLobby((m) => seen.push(m));
    handlers.get('lobby')!(lobby);
    expect(seen).toEqual([lobby]);
  });

  test('join uppercases the code; send/start/backToLobby message names', async () => {
    const c = await Connection.join(' abc234 ', '영희');
    expect(sent[0]).toEqual(['joinById', 'ABC234', { name: '영희' }]);
    c.start();
    c.send({ t: 'report' });
    c.backToLobby();
    expect(sent.slice(1)).toEqual([['send', 'start'], ['send', 'intent', { t: 'report' }], ['send', 'backToLobby']]);
  });

  test('forwards events, rejected, error, leave', async () => {
    const c = await Connection.create('a');
    const got: unknown[] = [];
    c.onEvents((m) => got.push(['ev', m]));
    c.onRejected((m) => got.push(['rej', m]));
    c.onError((m) => got.push(['err', m]));
    c.onLeave((m) => got.push(['leave', m]));
    handlers.get('events')!([{ e: 'x' }]);
    handlers.get('rejected')!({ reason: 'COOLDOWN' });
    handlers.get('error')!({ code: 'NOT_HOST' });
    leaveHandler!(1006);
    expect(got).toEqual([['ev', [{ e: 'x' }]], ['rej', { reason: 'COOLDOWN' }], ['err', { code: 'NOT_HOST' }], ['leave', 1006]]);
  });
});
