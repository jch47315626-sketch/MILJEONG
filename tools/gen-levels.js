#!/usr/bin/env node
// 단계 생성기 — 글자 목록을 주면 바위·빈 곳·자리·블록을 무작위로 놓아 보고,
// 솔버로 풀리는(그리고 아이에게 알맞게 짧은) 배치를 골라 levels.js에 붙일 데이터로 출력한다.
// 사용법: node tools/gen-levels.js  (아래 SPECS를 고쳐서 쓴다)
const path = require('path');
require(path.join(__dirname, '../js/hangul.js'));
require(path.join(__dirname, '../js/engine.js'));
const { Engine } = globalThis;

const SPECS = [
  { id: 11, world: 4, name: '어와 야', w: 6, h: 8, letters: ['ㅓ', 'ㅑ'], say: '어와 야 지붕이옵니다. 작은 가지가 어느 쪽에 붙었는지 잘 보시옵소서.' },
  { id: 12, world: 4, name: '여와 요', w: 6, h: 8, letters: ['ㅕ', 'ㅛ'], say: '여는 가지가 둘, 요는 기둥이 둘이옵니다.' },
  { id: 13, world: 4, name: '유와 요 초가집', w: 6, h: 8, letters: [], house: { v: ['ㅠ', 'ㅛ'], side: 'top' }, say: '초가집에서 유 자리, 그다음 요 자리가 나오옵니다.' },
  { id: 14, world: 5, name: '시옷과 지읒', w: 6, h: 8, letters: ['ㅅ', 'ㅈ'], say: '시옷은 사람 모양, 지읒은 시옷에 모자를 쓴 모양이옵니다.' },
  { id: 15, world: 5, name: '치읓과 키읔', w: 6, h: 8, letters: ['ㅊ', 'ㅋ'], say: '치읓은 지읒 위에 점이 있고, 키읔은 기역에 줄이 하나 더 있사옵니다.' },
  { id: 16, world: 5, name: '티읕과 피읖', w: 8, h: 10, wide: true, letters: ['ㅌ', 'ㅍ'], say: '티읕과 피읖이옵니다. 줄이 몇 개인지 세어 보시옵소서.' },
  { id: 17, world: 5, name: '히읗과 디귿', w: 7, h: 9, letters: ['ㅎ', 'ㄷ'], say: '히읗은 모자 쓴 이응이옵니다. 디귿도 함께 구해 주시옵소서.' },
  { id: 18, world: 6, name: '쌍기역 쌍디귿', w: 7, h: 9, letters: ['ㄲ', 'ㄸ'], say: '기역이 둘이면 쌍기역, 디귿이 둘이면 쌍디귿이옵니다.' },
  { id: 19, world: 6, name: '쌍비읍 쌍시옷', w: 8, h: 11, wide: true, letters: ['ㅃ', 'ㅆ'], say: '비읍과 시옷도 쌍둥이가 있사옵니다.' },
  { id: 20, world: 6, name: '쌍지읒', w: 7, h: 10, wide: true, letters: ['ㅉ', 'ㅅ', 'ㅈ'], say: '쌍지읒, 시옷, 지읒이옵니다. 비슷하니 잘 보시옵소서.' },
  { id: 21, world: 7, name: '애와 에', w: 6, h: 8, letters: ['ㅐ', 'ㅔ'], say: '애는 아에 이가 붙고, 에는 어에 이가 붙었사옵니다.' },
  { id: 22, world: 7, name: '얘와 예', w: 7, h: 10, wide: true, letters: ['ㅒ', 'ㅖ'], say: '얘와 예이옵니다. 가지가 두 개씩이옵니다.' },
  { id: 23, world: 7, name: '와와 외', w: 8, h: 10, wide: true, letters: ['ㅘ', 'ㅚ'], say: '오에 아가 붙으면 와, 이가 붙으면 외이옵니다.' },
  { id: 24, world: 7, name: '왜', w: 8, h: 10, wide: true, letters: ['ㅙ', 'ㅗ'], say: '오에 애가 붙으면 왜이옵니다. 오 지붕도 함께 구해 주시옵소서.' },
  { id: 25, world: 7, name: '워와 위', w: 8, h: 11, wide: true, letters: ['ㅝ', 'ㅟ'], say: '우에 어가 붙으면 워, 이가 붙으면 위이옵니다.' },
  { id: 26, world: 7, name: '웨와 의', w: 8, h: 9, letters: ['ㅞ', 'ㅢ'], say: '전하, 마지막 마을이옵니다. 웨와 의를 구해 주시옵소서.' },
];

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bbox(v) {
  const c = globalThis.Jamo.SHAPES[v];
  return [Math.max(...c.map((p) => p[0])) + 1, Math.max(...c.map((p) => p[1])) + 1];
}

function attempt(spec, R) {
  const { w, h } = spec;
  const grid = Array.from({ length: h }, () => Array(w).fill('.'));
  // 빈 곳: 모서리 0~2개
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  for (const [x, y] of corners) if (R() < 0.35) grid[y][x] = ' ';
  // 바위 1~3개 (가운데 줄 쪽)
  const rocks = 1 + Math.floor(R() * 3);
  for (let i = 0; i < rocks; i++) grid[2 + Math.floor(R() * (h - 4))][Math.floor(R() * w)] = '#';
  const used = new Set();
  const free = (v, x, y) => Engine.cells(v, x, y).every(([cx, cy]) => cx >= 0 && cy >= 0 && cx < w && cy < h && grid[cy][cx] === '.' && !used.has(cx + ',' + cy));
  const take = (v, x, y) => Engine.cells(v, x, y).forEach(([cx, cy]) => used.add(cx + ',' + cy));
  const pick = (v, yMin, yMax) => {
    const [bw, bh] = bbox(v);
    for (let k = 0; k < 3000; k++) {
      const x = Math.floor(R() * (w - bw + 1));
      const y = yMin + Math.floor(R() * Math.max(1, Math.min(yMax, h - bh) - yMin + 1));
      if (free(v, x, y)) { take(v, x, y); return [x, y]; }
    }
    return null;
  };
  const targets = [], blocks = [];
  // 자리는 아래쪽, 블록은 위쪽에 놓는다
  if (spec.house) {
    const vs = spec.house.v;
    const bw = Math.max(...vs.map((v) => bbox(v)[0]));
    const x = Math.floor(R() * (w - bw + 1));
    if (!vs.every((v) => free(v, x, 0))) return null;
    vs.forEach((v) => take(v, x, 0));
    targets.push({ v: vs, pos: [x, 0], house: spec.house.side });
  }
  for (const v of spec.letters) {
    const p = pick(v, spec.wide ? 0 : Math.floor(h / 2) - 1, h);
    if (!p) return null;
    targets.push({ v, pos: p });
  }
  const blockLetters = spec.letters.concat(spec.house ? spec.house.v : []);
  for (const v of blockLetters) {
    const p = pick(v, spec.house ? 2 : 0, spec.house || spec.wide ? h : Math.floor(h / 2));
    if (!p) return null;
    blocks.push({ v, pos: p });
  }
  return { map: grid.map((r) => r.join('')), targets, blocks };
}

const out = [];
for (const spec of SPECS) {
  const R = rng(spec.id * 7919);
  let found = null;
  const stats = {};
  for (let tries = 0; tries < 8000 && !found; tries++) {
    const lv = attempt(spec, R);
    if (!lv) continue;
    const level = { id: spec.id, ...lv };
    let s;
    try { s = Engine.load(level); } catch (e) { continue; }
    const r = Engine.solve(Engine.clone(s), { maxStates: 40000 });
    stats[r.ok ? 'ok' : r.reason] = (stats[r.ok ? 'ok' : r.reason] || 0) + 1;
    if (!r.ok) continue;
    // 아이에게 알맞게: 블록마다 한 번씩만 움직이면 되는 배치, 뒤쪽 마을은 한 번 비켜 주기까지 허용
    const nb = level.blocks.length;
    if (r.path.length > nb + (spec.world >= 6 ? 1 : 0)) continue;
    found = { ...level, par: r.path.length };
  }
  if (!found) { console.error(`✘ ${spec.id} ${spec.name}: 배치를 찾지 못함`, JSON.stringify(stats)); process.exitCode = 1; continue; }
  out.push({ id: spec.id, world: spec.world, name: spec.name, par: found.par, say: spec.say, map: found.map, targets: found.targets, blocks: found.blocks });
  console.error(`✔ ${spec.id} ${spec.name} par ${found.par}`);
}
console.log(JSON.stringify(out));
