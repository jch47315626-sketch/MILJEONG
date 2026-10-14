import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './GameRoom';

const port = Number(process.env.PORT ?? 2567);
const fast = process.env.MILJEONG_FAST === '1';

const server = new Server({ transport: new WebSocketTransport(), greet: false });
server.define('game', GameRoom, { configName: fast ? 'fast' : 'default' });

await server.listen(port);
console.log(`[miljeong] server listening on :${port}${fast ? ' (FAST_CONFIG)' : ''}`);
