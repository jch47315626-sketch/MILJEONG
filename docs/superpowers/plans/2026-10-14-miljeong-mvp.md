# 「밀정」 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4~10명이 6자리 방 코드로 모여 독립투사 vs 밀정 한 판을 끝까지 플레이할 수 있는 웹/모바일 게임 MVP를 만든다.

**Architecture:** npm workspaces 모노레포. `shared`는 결정적(deterministic) 게임 규칙 엔진(시간·난수 주입, I/O 없음), `server`는 Colyseus 방이 의도(intent)를 받아 `shared` 규칙으로 검증·적용하고 20Hz로 **플레이어별 필터링된 view**를 개별 전송, `client`는 Phaser 3 월드 렌더링 + DOM 오버레이(로비·회의·채팅·미니게임).

**Tech Stack:** TypeScript 5.9.3, Node 22, Colyseus 0.18 (`@colyseus/core`, `@colyseus/ws-transport`, `@colyseus/sdk`), Phaser 3.90.0, Vite, Vitest, Playwright, Capacitor 8.

**Spec:** `docs/superpowers/specs/2026-10-14-miljeong-mvp-design.md`

## Global Constraints

- 모든 수치는 `shared/src/config.ts`의 `GameConfig`에서만 읽는다. 하드코딩 금지.
- 단위: 위치·거리는 **타일**(float), 시간은 **ms**(epoch 기준 `now` 주입).
- 클라이언트는 의도만 보낸다. 서버만 상태를 바꾼다.
- 다른 플레이어의 역할은 (본인이 밀정일 때 동료 밀정, 게임 종료 후 전체, `revealRoleOnEject` 축출 공개를 제외하고) 어떤 클라이언트에도 전송하지 않는다. 시야 밖 플레이어 위치도 전송하지 않는다.
- UI 문구는 한국어, `client/src/strings.ts`에만 둔다.
- 실존 인물·단체명 사용 금지. 폭력 묘사 없음("끌려감", "흔적"으로 표현).
- Phaser는 3.x(`phaser@3.90.0`)로 고정한다(4.x 아님).
- Playwright는 사전 설치된 Chromium을 쓴다: `launchOptions.executablePath = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium'`. `playwright install` 실행 금지.

### 스펙 해석으로 이 계획이 확정하는 것

- **상태 갱신 방식:** 스펙 3.3의 "순수 함수"는 "결정적·I/O 없음"으로 구현한다. 규칙 함수는 `GameState`를 제자리에서 바꾸되, **거부(reject)할 때는 절대 바꾸지 않는다**(검증을 모두 끝낸 뒤에 변경).
- **동기화 방식:** Colyseus schema 상태 동기화를 쓰지 않고, 매 틱 `client.send('view', view)`로 개별 전송한다(정보 은닉을 구조적으로 보장. 10명×20Hz JSON은 MVP 규모에 충분).
- **회의 조기 종료:** 생존자 전원이 투표하면 투표 시간을 기다리지 않고 즉시 결과를 낸다(어몽어스 관례).
- **축출 연출 단계:** 회의 결과 후 `ejecting` 단계 5초(이동·행동 불가) → `playing` 복귀.
- **사망 공개:** 생존 여부는 회의 시작 시점(그때까지 끌려간 모두)과 축출 시점에만 전체에 공개된다(`publiclyDead`).
- **시야:** 원형 반경만 적용(벽에 의한 시야 차단은 MVP 제외).
- **임무 배정:** 임무 종류가 5종이므로 1인당 5종 모두, 종류별로 맵의 해당 종류 지점 중 하나를 무작위 배정.
- **임무 최소 시간:** `taskStart` 후 `taskMinMs`(1500ms) 이상 지나야 `taskComplete` 인정.
- **회의 후 쿨다운:** 회의(축출 단계) 종료 시 모든 밀정 `informReadyAt = now + informCooldownMs`, `sabotageReadyAt = now + sabotageCooldownMs`.
- **테스트용 빠른 설정:** 서버는 `MILJEONG_FAST=1`이면 `FAST_CONFIG`를 쓴다(E2E 전용).

## Review Focus

1. **회의 중 연결 끊김/이탈** — 투표자 수가 줄면 "생존자 전원 투표" 판정이 이탈자를 제외해야 하고, 이탈자에게 몰린 표는 축출로 이어지지 않아야 한다. → Task 7에 테스트 추가.
2. **같은 틱에 두 밀정이 같은 대상 밀고 / 밀고 직후 대상이 신고** — 이미 끌려간 대상에 대한 두 번째 밀고는 `TARGET_INVALID`로 거부, 끌려간 플레이어의 신고·비상종은 `NOT_ALIVE`. → Task 4에 테스트 추가.
3. **방장이 게임 중 나가기** — 게임은 계속되고, 게임 종료 후 대기실로 돌아올 때 새 방장이 있어야 한다. → Task 9 통합 테스트에 추가.
4. **이미 시작한 방 / 가득 찬 방 / 없는 코드로 참가** — 각각 한국어 오류 안내(`ROOM_STARTED`, `ROOM_FULL`, `ROOM_NOT_FOUND`). → Task 9(서버 코드), Task 10(클라이언트 문구) 테스트.
5. **채팅 도배·초과 길이·HTML 문자열** — 100자 초과 거부, 초당 1건 초과 거부, `<script>`가 DOM에 텍스트로만 표시. → Task 5(길이), Task 9(속도), Task 13(이스케이프) 테스트.

---

## File Structure

```
package.json                     workspaces, 루트 스크립트(test, typecheck, e2e, dev)
tsconfig.base.json
packages/shared/
  package.json  tsconfig.json  vitest.config.ts
  src/index.ts                   re-export
  src/config.ts                  GameConfig, DEFAULT_CONFIG, FAST_CONFIG, spyCountFor
  src/types.ts                   GameState, PlayerState, Intent, GameEvent, RejectReason ...
  src/rng.ts                     createRng(seed)
  src/map/types.ts               MapData
  src/map/gyeongseong.json       맵 데이터
  src/map/map.ts                 loadMap, isWalkable, zoneAt
  src/geometry.ts                dist, moveWithCollision, withinRange
  src/game.ts                    createGame
  src/tasks.ts                   assignTasks, taskGauge
  src/actions.ts                 applyIntent (디스패처)
  src/actions/*.ts               move, inform, report, bell, sabotage, task, vote, chat
  src/meeting.ts                 startMeeting, resolveMeeting, tallyVotes
  src/tick.ts                    tick
  src/win.ts                     checkWinner
  src/presence.ts                markDisconnected, markReconnected, markLeft
  src/view.ts                    viewFor, PlayerView
  test/*.test.ts
packages/server/
  package.json  tsconfig.json  vitest.config.ts
  src/index.ts                   서버 부트스트랩(포트 2567)
  src/roomCode.ts                generateRoomCode, isValidRoomCode
  src/GameRoom.ts                Colyseus Room
  test/roomCode.test.ts  test/gameRoom.test.ts
packages/client/
  package.json  tsconfig.json  vite.config.ts  index.html  capacitor.config.ts
  src/main.ts                    부트스트랩, 화면 전환
  src/strings.ts                 한국어 문구
  src/net.ts                     Connection 래퍼
  src/ui/{title,lobby,roleReveal,hud,meeting,result,chat,dom}.ts
  src/game/{GameScene,render,joystick,input}.ts
  src/minigames/{index,mimeograph,cipher,funds,flag,telegraph}.ts
  test/*.test.ts                 미니게임 모델·dom 이스케이프 단위 테스트
  e2e/fullRound.spec.ts  playwright.config.ts
```

---

### Task 1: 모노레포 골격 + 설정값 + 난수 + 역할 배정

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `packages/shared/{package.json,tsconfig.json,vitest.config.ts}`, `packages/shared/src/{index,config,types,rng}.ts`, `packages/shared/src/roles.ts`
- Test: `packages/shared/test/roles.test.ts`, `packages/shared/test/rng.test.ts`

**Interfaces:**
- Produces:
  - `interface GameConfig { minPlayers:4; maxPlayers:10; moveSpeed:number /*tiles/s, 4*/; informRange:1.5; informCooldownMs:30000; reportRange:1.5; bellRange:1.5; bellUnlockMs:15000; taskRange:1.5; taskMinMs:1500; sabotageCooldownMs:40000; checkpointDurationMs:15000; fixRange:1.5; discussMs:60000; voteMs:30000; ejectingMs:5000; reconnectGraceMs:30000; visionFighter:5; visionSpy:6; visionBlackout:1.5; revealRoleOnEject:boolean /*true*/; chatMaxLen:100; chatMinIntervalMs:1000 }`
  - `DEFAULT_CONFIG: GameConfig`, `FAST_CONFIG: GameConfig` (bellUnlockMs 1000, discussMs 3000, voteMs 3000, ejectingMs 1000, informCooldownMs 2000, sabotageCooldownMs 2000)
  - `spyCountFor(n: number): 1 | 2` — 4~6 → 1, 7~10 → 2
  - `type Rng = { next(): number /*[0,1)*/; int(maxExclusive:number): number; shuffle<T>(a: readonly T[]): T[] }`, `createRng(seed: number): Rng` (mulberry32)
  - `type Role = 'fighter' | 'spy'`
  - `assignRoles(playerIds: string[], rng: Rng): Record<string, Role>`

- [ ] **Step 1:** 루트 `package.json`(`"private":true`, `"workspaces":["packages/*"]`, scripts: `"test":"npm test -ws --if-present"`, `"typecheck":"tsc -b packages/shared packages/server packages/client"`), `tsconfig.base.json`(strict, ES2022, moduleResolution bundler), `.gitignore`(node_modules, dist, test-results, android, ios) 작성. shared는 devDeps `typescript@5.9.3 vitest`.
- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// roles.test.ts
test('spyCountFor', () => {
  expect([4,5,6].map(spyCountFor)).toEqual([1,1,1]);
  expect([7,8,9,10].map(spyCountFor)).toEqual([2,2,2,2]);
});
test('assignRoles gives exact spy count and covers all ids', () => {
  const ids = ['a','b','c','d','e','f','g'];
  const r = assignRoles(ids, createRng(1));
  expect(Object.keys(r).sort()).toEqual(ids);
  expect(Object.values(r).filter(x => x === 'spy')).toHaveLength(2);
});
test('assignRoles is deterministic per seed and varies across seeds', () => {
  const ids = ['a','b','c','d','e','f'];
  expect(assignRoles(ids, createRng(5))).toEqual(assignRoles(ids, createRng(5)));
  const spies = new Set(Array.from({length:30}, (_, s) =>
    Object.entries(assignRoles(ids, createRng(s))).find(([,v]) => v==='spy')![0]));
  expect(spies.size).toBeGreaterThan(3);
});
// rng.test.ts: next() in [0,1), int(n) in [0,n), shuffle keeps elements
```

- [ ] **Step 3:** `npm install` 후 `npx vitest run -w packages/shared` → FAIL(모듈 없음) 확인.
- [ ] **Step 4:** `config.ts`, `rng.ts`, `roles.ts`, `types.ts`(이 시점엔 `Role`만) 구현, `index.ts`에서 re-export.
- [ ] **Step 5:** `npm test` → PASS.
- [ ] **Step 6: Commit** `feat(shared): 모노레포 골격, 설정값, 역할 배정`

---

### Task 2: 맵 데이터 + 기하(충돌·거리)

**Files:**
- Create: `packages/shared/src/map/{types.ts,gyeongseong.json,map.ts}`, `packages/shared/src/geometry.ts`
- Test: `packages/shared/test/map.test.ts`, `packages/shared/test/geometry.test.ts`

**Interfaces:**
- Produces:
  - `type TaskType = 'mimeograph' | 'cipher' | 'funds' | 'flag' | 'telegraph'`
  - `interface Vec { x:number; y:number }`
  - `interface MapData { width:number; height:number; tiles:string[] /*height개 문자열, '#'=벽 '.'=바닥*/; zones:{id:string; name:string; rect:{x,y,w,h}}[]; spawns:Vec[] /*10개, 서점 뒷방*/; bell:Vec; breaker:Vec /*전신국*/; taskSpots:{id:string; type:TaskType; pos:Vec}[]; passages:{id:string; name:string; tiles:Vec[]}[] }`
  - `MAP: MapData` (gyeongseong.json 로드), `isWalkable(map, x, y): boolean`(타일 좌표 floor 기준), `zoneAt(map, pos): string | null`
  - `dist(a: Vec, b: Vec): number`, `withinRange(a: Vec, b: Vec, r: number): boolean`
  - `moveWithCollision(map: MapData, pos: Vec, delta: Vec, blocked: (tx:number, ty:number)=>boolean): Vec` — x, y축을 분리해 이동하고 벽/차단 타일에 들어가면 그 축 이동을 취소(플레이어 반경 0.3타일 기준 4모서리 검사).

- [ ] **Step 1: 실패하는 테스트**

```ts
// map.test.ts
test('map has the 8 zones from spec', () => {
  expect(MAP.zones.map(z => z.name).sort()).toEqual(
    ['골목','다방','서점 뒷방','인쇄소','전신국','전차 정류장','지하 창고','한약방'].sort());
});
test('10 spawns in 서점 뒷방, bell in 서점 뒷방, breaker in 전신국', () => {
  expect(MAP.spawns).toHaveLength(10);
  for (const s of MAP.spawns) expect(zoneAt(MAP, s)).toBe(zoneIdByName('서점 뒷방'));
  expect(zoneAt(MAP, MAP.bell)).toBe(zoneIdByName('서점 뒷방'));
  expect(zoneAt(MAP, MAP.breaker)).toBe(zoneIdByName('전신국'));
});
test('each task type has >=2 spots in different zones', ...);
test('>=3 passages, each tile walkable', ...);
test('every spot, bell, breaker reachable from spawn by BFS over walkable tiles', ...);
test('blocking any single passage still leaves every zone reachable (no soft-lock)', ...);
// geometry.test.ts
test('moveWithCollision stops at wall but slides along it', ...);
test('moveWithCollision respects blocked() callback', ...);
test('withinRange inclusive at exactly r', () => expect(withinRange({x:0,y:0},{x:1.5,y:0},1.5)).toBe(true));
```

- [ ] **Step 2:** 실행 → FAIL 확인.
- [ ] **Step 3:** 약 48×32 타일 맵 JSON을 작성(구역 8개, 통로 3개 이상, 임무 지점 종류별 2개 = 10개 이상)하고 `map.ts`, `geometry.ts` 구현. 마지막 테스트를 통과하도록 통로를 단일 절단점이 되지 않게 배치(순환 구조).
- [ ] **Step 4:** 실행 → PASS.
- [ ] **Step 5: Commit** `feat(shared): 경성 아지트 맵과 충돌 이동`

---

### Task 3: 게임 생성 + 이동 + 임무

**Files:**
- Create: `packages/shared/src/{game,tasks,tick,actions}.ts`, `packages/shared/src/actions/{move,task}.ts`; Modify: `types.ts`
- Test: `packages/shared/test/game.test.ts`, `test/tasks.test.ts`, `test/tick.test.ts`

**Interfaces:**
- Consumes: Task 1, 2.
- Produces (types.ts):
  - `type Phase = 'playing' | 'meeting' | 'ejecting' | 'ended'`
  - `interface TaskAssignment { taskId:string /*spot id*/; type:TaskType; done:boolean; startedAt:number|null }`
  - `interface PlayerState { id; name; role:Role; alive:boolean; left:boolean; connected:boolean; disconnectDeadline:number|null; pos:Vec; dir:Vec; tasks:TaskAssignment[]; informReadyAt:number; bellUsed:boolean }`
  - `interface Trace { id:string; victimId:string; pos:Vec }`
  - `type Sabotage = { kind:'blackout' } | { kind:'checkpoint'; passageId:string; endsAt:number }`
  - `interface Meeting { callerId:string; reason:'report'|'bell'; reportedVictimId:string|null; discussEndsAt:number; voteEndsAt:number; votes:Record<string,string /*playerId|'skip'*/> }`
  - `interface ChatMsg { from:string; text:string; at:number }`
  - `interface Ejection { playerId:string|null; role:Role|null /*공개 옵션 꺼지면 null*/ }`
  - `interface GameState { config:GameConfig; map:MapData; phase:Phase; players:Record<string,PlayerState>; order:string[]; startedAt:number; traces:Trace[]; sabotage:Sabotage|null; sabotageReadyAt:number; meeting:Meeting|null; ejectingEndsAt:number|null; lastEjection:Ejection|null; publiclyDead:string[]; meetingChat:ChatMsg[]; ghostChat:ChatMsg[]; winner:'fighters'|'spies'|null; seq:number /*id 생성용*/ }`
  - `type Intent = {t:'move'; dir:Vec} | {t:'taskStart'; taskId:string} | {t:'taskComplete'; taskId:string} | {t:'inform'; target:string} | {t:'report'} | {t:'bell'} | {t:'sabotage'; kind:'blackout'} | {t:'sabotage'; kind:'checkpoint'; passageId:string} | {t:'fixBreaker'} | {t:'vote'; target:string /*id|'skip'*/} | {t:'chat'; text:string}`
  - `type RejectReason = 'WRONG_PHASE'|'NOT_ALIVE'|'WRONG_ROLE'|'OUT_OF_RANGE'|'COOLDOWN'|'TARGET_INVALID'|'ALREADY_USED'|'LOCKED'|'SABOTAGE_ACTIVE'|'NOT_STARTED'|'TOO_FAST'|'BAD_INPUT'`
  - `type GameEvent = {e:'informed'; victim:string} | {e:'meetingStarted'; reason:'report'|'bell'; caller:string} | {e:'ejected'; ejection:Ejection} | {e:'sabotageStarted'; kind:'blackout'|'checkpoint'} | {e:'sabotageEnded'} | {e:'taskDone'; player:string} | {e:'gameEnded'; winner:'fighters'|'spies'}`
  - `type ApplyResult = { ok:true; events:GameEvent[] } | { ok:false; reason:RejectReason }`
  - `createGame(players:{id:string;name:string}[], config:GameConfig, rng:Rng, now:number, map?:MapData): GameState` — 역할·임무 배정, 스폰 위치 배정, 모든 `informReadyAt = now + informCooldownMs`, `sabotageReadyAt = now + sabotageCooldownMs`.
  - `assignTasks(map, rng): TaskAssignment[]`, `taskGauge(state): number` /*0~1, 분모는 left가 아닌 투사들의 임무 수*/
  - `applyIntent(state, playerId, intent, now): ApplyResult` — `intent.t`로 `actions/*`에 위임. 모르는 형태/잘못된 타입은 `BAD_INPUT`.
  - `tick(state, now, dtMs): GameEvent[]` — 이동 적용(이 Task), 이후 Task에서 타이머 처리 추가.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('createGame: roles, 5 tasks of distinct types for fighters, spawns, cooldowns', () => {
  const s = createGame(players(6), DEFAULT_CONFIG, createRng(1), 1000);
  expect(spies(s)).toHaveLength(1);
  for (const p of fighters(s)) expect(new Set(p.tasks.map(t=>t.type)).size).toBe(5);
  for (const p of spies(s)) expect(p.tasks).toEqual([]);
  expect(Object.values(s.players).every(p => p.informReadyAt === 31000)).toBe(true);
});
test('move: dir is clamped to length<=1, tick moves by moveSpeed*dt', ...);   // dir {x:3,y:0} → 1초 후 x가 +4
test('move: ghost passes through walls, alive does not', ...);
test('move rejected with WRONG_PHASE during meeting', ...);
test('taskComplete requires taskStart, range, and taskMinMs', () => {
  // taskComplete without start → NOT_STARTED; start then complete at +1000ms → TOO_FAST; at +1500 → ok
  // out of range → OUT_OF_RANGE; spy → WRONG_ROLE; already done → ALREADY_USED
});
test('ghost fighter can still complete tasks', ...);
test('taskGauge excludes left players', ...);
test('BAD_INPUT for malformed intent', () =>
  expect(applyIntent(s, id, {t:'move', dir:{x:NaN,y:0}} as any, now)).toEqual({ok:false, reason:'BAD_INPUT'}));
```

- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** 구현. 테스트 헬퍼 `players(n)`, `fighters(s)`, `spies(s)`, `placeAt(s,id,pos)`는 `test/helpers.ts`에 둔다.
- [ ] **Step 4:** 실행 → PASS.
- [ ] **Step 5: Commit** `feat(shared): 게임 생성, 이동, 거사 임무`

---

### Task 4: 밀고 + 흔적 + 신고 + 비상종 + 회의 시작

**Files:**
- Create: `packages/shared/src/actions/{inform,report,bell}.ts`, `packages/shared/src/meeting.ts`(startMeeting)
- Test: `packages/shared/test/inform.test.ts`, `test/meetingStart.test.ts`

**Interfaces:**
- Produces: `startMeeting(state, callerId, reason, victimId|null, now): GameEvent[]` — 생존자를 `spawns`로 순간이동, `traces=[]`, `sabotage=null`, `dir` 0, 끌려간 모두를 `publiclyDead`에 추가, `meetingChat=[]`, `phase='meeting'`, `discussEndsAt=now+discussMs`, `voteEndsAt=now+discussMs+voteMs`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('inform succeeds: victim becomes ghost, trace at victim pos, cooldown reset', ...); // events [{e:'informed',victim}]
test('inform rejections', () => {
  // fighter → WRONG_ROLE; before informReadyAt → COOLDOWN; dist 1.6 → OUT_OF_RANGE;
  // target spy or ghost or self → TARGET_INVALID; dead spy → NOT_ALIVE; phase meeting → WRONG_PHASE
});
test('two spies inform same target in same tick: second is TARGET_INVALID', ...);   // Review Focus 2
test('informed player cannot report or bell: NOT_ALIVE', ...);                       // Review Focus 2
test('report within 1.5 of trace starts meeting; without trace → OUT_OF_RANGE', ...);
test('bell: locked before 15s (LOCKED), once per player (ALREADY_USED), range, blocked by active sabotage (SABOTAGE_ACTIVE)', ...);
test('startMeeting teleports alive to spawns, clears traces & sabotage, sets publiclyDead and timers', ...);
```

- [ ] **Step 2:** 실행 → FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(shared): 밀고, 신고, 비상종, 회의 시작`

---

### Task 5: 투표 집계 + 축출 + 회의 타이머 + 채팅

**Files:**
- Create: `packages/shared/src/actions/{vote,chat}.ts`; Modify: `meeting.ts`(tallyVotes, resolveMeeting), `tick.ts`
- Test: `packages/shared/test/vote.test.ts`, `test/chat.test.ts`

**Interfaces:**
- Produces:
  - `tallyVotes(votes: Record<string,string>, voterIds: string[]): string | null` — 미투표는 'skip'. 단독 최다 득표자 && 그 표 수 > skip 표 수일 때 그 id, 아니면 null.
  - `resolveMeeting(state, now): GameEvent[]` — 축출 대상은 유령이 되고 `publiclyDead`에 추가, `lastEjection` 설정(`revealRoleOnEject`가 false면 role null), `phase='ejecting'`, `ejectingEndsAt=now+ejectingMs`, `meeting=null`. 승리 판정은 Task 7에서 연결.
  - `tick`: `meeting` 단계에서 `now >= voteEndsAt` 또는 투표 자격자(생존 && !left) 전원 투표 시 `resolveMeeting`; `ejecting`에서 `now >= ejectingEndsAt`이면 `phase='playing'`, 밀정 쿨다운 재설정(Global Constraints 참고).
  - 투표 규칙: 회의 중 생존자만, 대상은 생존자 id 또는 'skip', 한 번만(`ALREADY_USED`), 토론 중에도 가능.
  - 채팅 규칙: `text`는 trim 후 1~`chatMaxLen`자(아니면 `BAD_INPUT`). 생존자는 `meeting` 단계에만 `meetingChat`에 추가(아니면 `WRONG_PHASE`). 유령은 언제나 `ghostChat`에 추가. 속도 제한은 서버(Task 9).

- [ ] **Step 1: 실패하는 테스트**

```ts
test('tallyVotes', () => {
  expect(tallyVotes({a:'x',b:'x',c:'y'}, ['a','b','c','d'])).toBe('x');    // x2 > skip1(d)
  expect(tallyVotes({a:'x',b:'y'}, ['a','b'])).toBeNull();                  // tie
  expect(tallyVotes({a:'x'}, ['a','b','c'])).toBeNull();                    // skip2 > x1
  expect(tallyVotes({a:'x',b:'skip'}, ['a','b'])).toBeNull();               // x1 == skip1
});
test('vote rejections: ghost NOT_ALIVE, twice ALREADY_USED, dead target TARGET_INVALID, outside meeting WRONG_PHASE', ...);
test('meeting resolves at voteEndsAt; early when all alive voted', ...);
test('ejection: ghost, publiclyDead, lastEjection role shown/hidden per revealRoleOnEject', ...);
test('ejecting → playing after ejectingMs; spy cooldowns reset to now+cooldown', ...);
test('chat: 101 chars → BAD_INPUT, whitespace-only → BAD_INPUT, alive outside meeting → WRONG_PHASE, ghost anytime → ghostChat', ...);
```

- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5: Commit** `feat(shared): 투표, 축출, 채팅`

---

### Task 6: 방해 공작 (정전·일경 검문)

**Files:**
- Create: `packages/shared/src/actions/sabotage.ts`; Modify: `tick.ts`, `actions/move.ts`(blocked 콜백)
- Test: `packages/shared/test/sabotage.test.ts`

**Interfaces:**
- Produces: `isTileBlocked(state, tx, ty): boolean` — 활성 checkpoint 통로 타일이면 true(생존자 이동에만 적용, 유령 무시). 규칙: 밀정·생존·`playing`, `now >= sabotageReadyAt`(아니면 `COOLDOWN`), 활성 방해 있으면 `SABOTAGE_ACTIVE`, 없는 passageId → `BAD_INPUT`. 발동 시 `sabotageReadyAt = now + sabotageCooldownMs`. `fixBreaker`: 생존 투사, `breaker` 1.5 이내, blackout 활성일 때만(아니면 `TARGET_INVALID`). tick: checkpoint `endsAt` 경과 시 해제 + `sabotageEnded`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('blackout starts, persists until fixBreaker by alive fighter in range', ...);
test('checkpoint blocks passage tiles for alive players, not ghosts, auto-ends after 15s', ...);
test('cooldown 40s shared, one active at a time, fighter → WRONG_ROLE', ...);
test('player standing on passage tile when checkpoint starts can still move off it', ...); // 갇힘 방지: 현재 타일이 차단 타일이면 차단 무시하고 빠져나갈 수 있음
```

- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5: Commit** `feat(shared): 방해 공작`

---

### Task 7: 승리 판정 + 연결 끊김/이탈

**Files:**
- Create: `packages/shared/src/{win,presence}.ts`; Modify: `actions/inform.ts`, `actions/task.ts`, `meeting.ts`, `tick.ts`
- Test: `packages/shared/test/win.test.ts`, `test/presence.test.ts`

**Interfaces:**
- Produces:
  - `checkWinner(state): 'fighters' | 'spies' | null` — 스펙 2.8 순서(생존 밀정 0 → 투사 / 생존 투사 ≤ 생존 밀정 → 밀정 / 게이지 1 → 투사). "생존" = `alive && !left`.
  - `endIfWon(state): GameEvent[]` — 승자가 있으면 `phase='ended'`, `winner` 설정, `gameEnded` 이벤트. 밀고·임무 완료·축출 처리 직후와 이탈 처리 직후에 호출.
  - `markDisconnected(state, id, now)`: `connected=false`, `disconnectDeadline=now+reconnectGraceMs`(로비가 아닌 게임 상태에서만). `markReconnected(state, id)`: 복구. `markLeft(state, id, now): GameEvent[]`: `left=true, alive=false`, 진행 중 회의 표에서 그 사람의 표 제거, 승리 판정.
  - `tick`: `disconnectDeadline` 경과 시 `markLeft`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('checkWinner priority: zero spies beats parity; parity beats gauge', ...);
test('last inform causing parity ends game with spies', ...);
test('final task completion ends game with fighters', ...);
test('ejecting last spy ends game with fighters (phase ended, not ejecting)', ...);
test('disconnect 30s → left; reconnect at 29s → still in', ...);
test('left fighter tasks excluded from gauge, can complete gauge', ...);
test('meeting: player leaves mid-vote → excluded from voters, votes on them do not eject, early-resolve counts only remaining', ...); // Review Focus 1
```

- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5: Commit** `feat(shared): 승리 판정, 연결 끊김 처리`

---

### Task 8: 플레이어별 view (정보 은닉)

**Files:**
- Create: `packages/shared/src/view.ts`
- Test: `packages/shared/test/view.test.ts`

**Interfaces:**
- Produces:
  - `interface PlayerView { phase:Phase; now:number; me:{ id; role:Role; alive:boolean; pos:Vec; tasks:TaskAssignment[]; informReadyAt:number; bellUsed:boolean; fellowSpies:string[] }; roster:{ id; name; connected:boolean; left:boolean; publiclyDead:boolean; role:Role|null }[]; visible:{ id; pos:Vec; ghost:boolean }[]; traces:Trace[]; gauge:number; sabotage:Sabotage|null; sabotageReadyAt:number|null /*밀정만*/; visionRadius:number; meeting:null | { callerId; reason; reportedVictimId; discussEndsAt; voteEndsAt; voted:string[] /*누가 투표했는지만*/ }; lastEjection:Ejection|null; chat:ChatMsg[]; ghostChat:ChatMsg[] /*유령만, 아니면 []*/; winner:'fighters'|'spies'|null; startedAt:number }`
  - `viewFor(state, playerId, now): PlayerView`
- 규칙: `roster[].role`은 본인, (내가 밀정이면) 동료 밀정, 축출 공개분, `ended` 단계의 전원만 채우고 나머지 null. `visible`: 유령이면 모두; 생존자면 반경 내 생존자만(유령 제외). `traces`: 반경 내만(유령은 전부). 반경: 생존 투사는 blackout 시 `visionBlackout` 아니면 `visionFighter`, 생존 밀정 `visionSpy`, 유령 Infinity.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('fighter view never contains another player role', () => {
  const v = viewFor(s, fighterId, now);
  expect(v.roster.filter(r => r.id !== fighterId).every(r => r.role === null)).toBe(true);
  expect(JSON.stringify(v)).not.toContain('"spy"');           // 문자열 수준으로도 누출 없음
});
test('spy sees fellow spies', ...);
test('alive fighter: only alive players within 5 tiles; 1.5 during blackout; ghosts invisible', ...);
test('ghost sees everyone and ghostChat; alive gets ghostChat []', ...);
test('meeting exposes who voted but not targets', ...);
test('ended view reveals all roles', ...);
test('sabotageReadyAt only for spies', ...);
```

- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5: Commit** `feat(shared): 플레이어별 view 필터링`

---

### Task 9: Colyseus 게임 서버

**Files:**
- Create: `packages/server/{package.json,tsconfig.json,vitest.config.ts}`, `src/{index,roomCode,GameRoom}.ts`
- Test: `packages/server/test/roomCode.test.ts`, `test/gameRoom.test.ts`

**Interfaces:**
- Consumes: `shared` 전체 공개 API.
- Produces (클라이언트 프로토콜):
  - 방 이름 `'game'`. 생성: `client.create('game', {name})`, 참가: `client.joinById(code, {name})`. `name`: trim 1~12자 아니면 참가 거부.
  - 서버→클라: `'lobby'` `{ code:string; hostId:string; players:{id,name}[]; phase:'lobby'|'inGame' }` (로비 변경 시 전체 방송), `'view'` `PlayerView` (게임 중 50ms마다 개별), `'events'` `GameEvent[]`(발생 시 전체 방송, 단 `informed`는 밀정들과 피해자에게만), `'rejected'` `{reason:RejectReason}`, `'error'` `{code:'NOT_HOST'|'NOT_ENOUGH_PLAYERS'|'CHAT_RATE'}`.
  - 클라→서버: `'start'`(방장만), `'intent'` `Intent`, `'backToLobby'`(종료 후 방장만).
  - 참가 실패 코드(onAuth/onJoin에서 `ServerError` throw): `ROOM_STARTED`, `ROOM_FULL`(Colyseus maxClients=10 기본 에러를 그대로 쓰되 클라가 매핑), 없는 방은 Colyseus 기본 not-found → 클라가 `ROOM_NOT_FOUND`로 매핑.
  - `generateRoomCode(rng?): string` — 6자, 문자집합 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`(0,O,1,I,L 제외). `isValidRoomCode(s)`.
- 구현 결정: `onCreate`에서 중복 없는 코드로 `this.roomId` 설정. 게임 시작 시 `createGame(..., createRng(Date.now()))`. `setSimulationInterval(50ms)`에서 `tick` → 이벤트 방송 → 각 클라이언트에 `viewFor` 전송. `onLeave`: 로비면 제거 + 방장 승계(남은 사람 중 가장 먼저 들어온 사람); 게임 중이면 `markDisconnected` 후 `allowReconnection(client, 30)`, 재접속 시 `markReconnected`. 채팅 속도 제한: 플레이어별 마지막 채팅 시각 기록, `chatMinIntervalMs` 미만이면 `'error' CHAT_RATE`. 게임 종료 후 `backToLobby`로 로비 복귀(left/끊긴 플레이어 제거). `MILJEONG_FAST=1`이면 `FAST_CONFIG`. 틱·메시지 처리 중 예외가 나면 로그를 남기고 `this.disconnect()`로 그 방만 종료한다(스펙 3.7).

- [ ] **Step 1: 실패하는 테스트** (`@colyseus/testing` `boot()` + `@colyseus/sdk` 클라이언트 사용)

```ts
test('roomCode: 6 chars from allowed set; isValidRoomCode rejects O/0/I/1/L', ...);
test('create → code; 4 join by code; non-host start → NOT_HOST; host start with 3 → NOT_ENOUGH_PLAYERS', ...);
test('full round via intents: start, spy informs fighter (teleport via test hook), fighter reports, all vote spy, fighters win', async () => {
  // 테스트 훅: room.state 접근은 서버 인스턴스(room.game)로 직접 위치 조정
  // 기대: 각 클라 마지막 view.phase === 'ended' && view.winner === 'fighters'
});
test('info hiding: every fighter client never received a view whose roster leaks another role or a non-visible pos', ...);
test('join started room → ROOM_STARTED; 11th join fails; bad name rejected', ...);  // Review Focus 4
test('chat rate: second chat within 1s → CHAT_RATE error', ...);                     // Review Focus 5
test('host leaves mid-game → game continues; after end, backToLobby by new host works', ...); // Review Focus 3
test('disconnect then reconnect within grace keeps player in game', ...);
test('exception inside tick closes only that room; another room keeps running', ...);
```

- [ ] **Step 2:** `npm test -w packages/server` → FAIL.
- [ ] **Step 3:** 구현. `GameRoom`에 테스트용 public 필드 `game: GameState | null`을 둔다(프로토콜에는 노출 안 됨).
- [ ] **Step 4:** PASS. 추가로 `npm run typecheck` 통과.
- [ ] **Step 5: Commit** `feat(server): Colyseus 게임 방, 방 코드, 재접속`

---

### Task 10: 클라이언트 골격 + 타이틀/방 참가/대기실

**Files:**
- Create: `packages/client/{package.json,tsconfig.json,vite.config.ts,index.html}`, `src/{main,strings,net}.ts`, `src/ui/{dom,title,lobby}.ts`
- Test: `packages/client/test/{strings,net}.test.ts`

**Interfaces:**
- Consumes: Task 9 프로토콜, `shared` 타입.
- Produces:
  - `class Connection { static create(name):Promise<Connection>; static join(code,name):Promise<Connection>; readonly code:string; readonly myId:string; onLobby(cb); onView(cb); onEvents(cb); onRejected(cb); onError(cb); onLeave(cb); start(); send(intent:Intent); backToLobby(); leave() }` — 서버 주소는 `import.meta.env.VITE_SERVER_URL ?? 'ws://<location.hostname>:2567'`.
  - `joinErrorMessage(err: unknown): string` — `ROOM_NOT_FOUND`/`ROOM_FULL`/`ROOM_STARTED`/기타를 `strings`의 한국어 문구로.
  - `el(tag, attrs, ...children)` (`ui/dom.ts`) — 문자열 자식은 항상 `textContent`로 넣는다(innerHTML 금지).
  - 화면 전환: `main.ts`의 `show(screen: 'title'|'lobby'|'game'|'result')`. 의도치 않은 연결 종료(`onLeave` 코드가 정상 종료가 아님)면 "연결이 끊어졌습니다" 안내 후 타이틀로.
- 화면: 타이틀(닉네임 입력, "방 만들기", 코드 입력 + "참가"), 대기실(방 코드 크게, 참가자 목록, 방장에게만 "시작" 버튼, 4명 미만이면 비활성 + 안내).
- 테스트 셀렉터: 주요 요소에 `data-testid` (`nickname`, `create`, `code-input`, `join`, `room-code`, `lobby-player`, `start`).

- [ ] **Step 1: 실패하는 테스트**

```ts
test('joinErrorMessage maps codes to Korean strings', () => {
  expect(joinErrorMessage({code: 'ROOM_STARTED'})).toBe(S.err.roomStarted);  // "이미 시작된 방입니다"
  ...
});
test('el() escapes text children', () => {
  expect(el('div', {}, '<b>x</b>').innerHTML).toBe('&lt;b&gt;x&lt;/b&gt;');
});
```
(vitest `environment: 'jsdom'`)

- [ ] **Step 2–4:** FAIL → 구현 → PASS. 수동 확인: `npm run dev`(서버+클라 동시 실행 루트 스크립트) 후 브라우저 2개로 방 생성·참가 확인.
- [ ] **Step 5: Commit** `feat(client): 타이틀, 방 참가, 대기실`

---

### Task 11: 게임 화면 (월드 렌더링·조작·HUD)

**Files:**
- Create: `packages/client/src/game/{GameScene,render,joystick,input}.ts`, `src/ui/{roleReveal,hud}.ts`
- Test: `packages/client/test/{input,render}.test.ts`

**Interfaces:**
- Consumes: `PlayerView`, `MAP`, `withinRange`, `Connection`.
- Produces:
  - `inputToDir(keys:{up,down,left,right:boolean}, stick:Vec|null): Vec` — 스틱 우선, 길이 ≤1. 방향이 바뀔 때만 `move` 의도 전송(같으면 생략).
  - `availableActions(view: PlayerView, map: MapData): { task:string|null /*가까운 미완료 임무 id 또는 밀정은 위장용 아무 지점*/; inform:string|null /*사거리 내 가장 가까운 대상*/; report:boolean; bell:boolean; fixBreaker:boolean; sabotage:boolean }` — 버튼 활성화를 결정하는 순수 함수(최종 판정은 서버).
  - `interpolate(prev:Vec, next:Vec, t:number): Vec`
- 렌더: 타일 사각형(벽/바닥), 구역 이름 라벨, 임무 지점(내 미완료만 강조), 플레이어 원 + 이름, 흔적 아이콘, 시야 밖 어둡게(원형 마스크 `visionRadius`), 카메라는 나를 추적. 원격 플레이어는 직전 두 view 사이 보간.
- HUD(DOM): 거사 게이지 바, 내 임무 목록, 액션 버튼(임무/밀고/신고/비상종/방해/차단기), 밀정은 쿨다운 숫자 표시, 방해 메뉴(정전 / 검문 통로 선택). 역할 공개 화면 3초(투사: "독립투사", 밀정: "밀정" + 동료 이름).
- 입력: WASD/방향키, E=임무/차단기, Q=밀고, R=신고, B=비상종. 모바일: 좌하단 가상 조이스틱, 우하단 버튼.
- 테스트 셀렉터: `hud-gauge`, `btn-task`, `btn-inform`, `btn-report`, `btn-bell`, `btn-sabotage`, `btn-fix`, `role-reveal`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('inputToDir: diagonal normalized; stick overrides keys', ...);
test('availableActions: inform only for alive spy with fighter in 1.5 and cooldown elapsed', ...);
test('availableActions: bell only near bell, unused, after unlock, no sabotage', ...);
test('availableActions: ghost fighter gets task but not report/bell', ...);
```

- [ ] **Step 2–4:** FAIL → 구현 → PASS. 수동: 4개 브라우저 탭으로 이동·밀고·신고 동작 확인.
- [ ] **Step 5: Commit** `feat(client): 게임 화면, 조작, HUD`

---

### Task 12: 미니게임 5종

**Files:**
- Create: `packages/client/src/minigames/{index,mimeograph,cipher,funds,flag,telegraph}.ts`
- Test: `packages/client/test/minigames.test.ts`

**Interfaces:**
- Produces: 각 미니게임은 순수 모델 + DOM 뷰로 나눈다.
  - `interface MiniGameModel<A> { readonly done: boolean; apply(action: A): void }`
  - 모델 생성자(난수 주입): `mimeograph(): taps 12회`, `cipher(rng): 4쌍 기호 짝 맞추기`, `funds(rng): 목표 금액(10~90전, 10전 단위)을 10전/50전 엽전 드래그로 정확히 맞추기(초과 시 되돌리기 가능)`, `flag(): 4방향 스와이프 순서(위→오른쪽→아래→왼쪽) 맞추기, 틀리면 처음부터`, `telegraph(rng): 장/단 4~5자 패턴 입력, 틀리면 처음부터`.
  - `openMiniGame(type: TaskType, root: HTMLElement, opts:{ rng:Rng; onDone():void; onClose():void }): () => void /*닫기*/`
- 흐름: 임무 버튼 → `taskStart` 의도 전송 → 미니게임 열기 → 완료 시 `taskComplete` 전송. 밀정(위장)은 같은 UI를 열되 의도를 보내지 않는다. 회의가 시작되거나 내가 끌려가면 열린 미니게임을 닫는다.
- 각 미니게임에는 `data-testid="minigame-<type>"`와 E2E용 `data-testid="minigame-autocomplete"` 버튼을 `import.meta.env.VITE_E2E === '1'`일 때만 렌더.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('mimeograph done after 12 taps, not 11', ...);
test('cipher: wrong pair does not progress; all 4 pairs → done', ...);
test('funds: exact target → done; overshoot not done until corrected', ...);
test('flag: wrong swipe resets progress', ...);
test('telegraph: correct pattern → done; wrong symbol resets', ...);
```

- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5: Commit** `feat(client): 거사 임무 미니게임 5종`

---

### Task 13: 회의·투표·채팅·결과 화면

**Files:**
- Create: `packages/client/src/ui/{meeting,chat,result}.ts`
- Test: `packages/client/test/meeting.test.ts`

**Interfaces:**
- Consumes: `PlayerView.meeting`, `roster`, `chat`, `ghostChat`, `lastEjection`, `winner`.
- Produces:
  - `meetingTimerText(view, now): string` — 토론 중 "토론 0:42", 투표 중 "투표 0:17".
  - `ejectionText(e: Ejection, roster): string` — "OOO은(는) 조직에서 축출되었습니다." + 공개 시 "그는 밀정이었습니다/독립투사였습니다", 대상 null이면 "아무도 축출되지 않았습니다."
  - `renderChat(list: ChatMsg[], roster): HTMLElement` — `el()`만 사용.
- 회의 화면: 소집자·사유("흔적 신고"/"비상종") 표시, 생존자 카드(투표 완료 표시), 끌려간/축출된 사람은 회색, "건너뛰기" 버튼, 채팅 입력(100자 `maxlength`). 유령은 투표 불가, 유령 채팅 탭만. 축출 연출(`ejecting` 단계) 동안 `ejectionText` 표시. 결과 화면: 승리 진영 + 전원 역할, 방장에게 "대기실로" 버튼.
- 테스트 셀렉터: `meeting`, `vote-<playerId>`, `vote-skip`, `chat-input`, `chat-send`, `chat-msg`, `ejection`, `result`, `back-to-lobby`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('meetingTimerText switches from 토론 to 투표 at discussEndsAt', ...);
test('ejectionText with reveal on/off and skip', ...);
test('renderChat shows <script> as literal text', () => {   // Review Focus 5
  const n = renderChat([{from:'a', text:'<script>x</script>', at:0}], roster);
  expect(n.querySelector('script')).toBeNull();
  expect(n.textContent).toContain('<script>x</script>');
});
```

- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5: Commit** `feat(client): 회의, 투표, 채팅, 결과 화면`

---

### Task 14: E2E — 브라우저 4개로 한 판

**Files:**
- Create: `packages/client/playwright.config.ts`, `packages/client/e2e/fullRound.spec.ts`; Modify: 루트 `package.json`(`"e2e"` 스크립트)

**Interfaces:**
- Consumes: Task 10–13의 `data-testid`, 서버 `MILJEONG_FAST=1`, 클라 `VITE_E2E=1`.
- `playwright.config.ts`: `webServer` 2개(서버 `MILJEONG_FAST=1 npm start -w packages/server` 포트 2567, 클라 `VITE_E2E=1 vite --port 5173`), Chromium `executablePath`는 Global Constraints대로.

- [ ] **Step 1: 테스트 작성**

```ts
test('4 players: create, join, start, bell meeting, all skip, resume; then spy ejected → fighters win', async ({ browser }) => {
  // 1. 컨텍스트 4개. p1 방 만들기 → room-code 읽기 → p2~4 참가 → lobby-player 4개 확인 → p1 start
  // 2. 모두 role-reveal 표시 확인. 역할은 각 페이지의 role-reveal 텍스트로 파악(밀정 1명)
  // 3. 스폰이 비상종 근처이므로 bellUnlock(1s) 후 p1이 btn-bell 클릭 → 4명 모두 meeting 표시
  // 4. 모두 vote-skip → ejection 텍스트 "아무도 축출되지 않았습니다." → meeting 사라짐
  // 5. 두 번째 비상종(p2) → 투사 3명이 밀정에게 투표, 밀정은 skip → result에 독립투사 승리
  // 6. 방장 p1이 back-to-lobby 클릭 → 4명 모두 대기실(lobby-player 4개) 복귀
});
```

- [ ] **Step 2:** `npm run e2e` → 실패 원인 확인 후 앞 Task 코드 버그면 수정(셀렉터 누락 등).
- [ ] **Step 3:** `npm run e2e` → PASS.
- [ ] **Step 4: Commit** `test(e2e): 4인 한 판 시나리오`

---

### Task 15: Capacitor 패키징 설정 + 실행 문서

**Files:**
- Create: `packages/client/capacitor.config.ts`; Modify: `packages/client/package.json`, `README.md`

**Interfaces:**
- `capacitor.config.ts`: `appId: 'com.miljeong.game'`, `appName: '밀정'`, `webDir: 'dist'`. 의존성 `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios` (8.x). 화면 방향 가로 고정은 네이티브 프로젝트 생성 후 적용하므로 README에 절차만 기재.
- 스크립트: `"build"`(vite build), `"cap:sync"`(`npm run build && cap sync`). `android/`, `ios/` 폴더는 생성하지 않는다(사용자 PC에서 `npx cap add android|ios`).
- README(한국어): 프로젝트 소개, 요구사항(Node 22), `npm install` / `npm run dev` / `npm test` / `npm run e2e`, 모바일 빌드 절차(Android Studio, Xcode/Mac 필요), 서버 주소 `VITE_SERVER_URL` 설정.

- [ ] **Step 1:** 설정 추가 후 `npm run build -w packages/client` → `dist/index.html` 생성 확인.
- [ ] **Step 2:** `npx cap doctor` (client 디렉터리) → 설정 오류 없음 확인(플랫폼 미추가 경고는 정상).
- [ ] **Step 3:** 전체 검증: `npm run typecheck && npm test && npm run e2e` 모두 PASS.
- [ ] **Step 4: Commit** `chore(client): Capacitor 설정, README`
