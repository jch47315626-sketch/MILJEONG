#!/usr/bin/env node
// 단계 검증 — 해답이 있는지, par(최소 수)가 맞는지, 첫 수로 자리를 잘못 고르면 막히는 함정이 몇 개인지 본다.
// 사용법: node tools/solve.js [단계id ...] [--path]
const path = require('path');
require(path.join(__dirname, '../js/hangul.js'));
require(path.join(__dirname, '../js/engine.js'));
require(path.join(__dirname, '../js/levels.js'));
const { Engine, LEVELS } = globalThis;

const args = process.argv.slice(2);
const showPath = args.includes('--path');
const ids = args.filter((a) => !a.startsWith('--')).map(Number);

let failed = 0;
for (const level of LEVELS) {
  if (ids.length && !ids.includes(level.id)) continue;
  let start;
  try {
    start = Engine.load(level);
  } catch (e) {
    failed++;
    console.log(`✘ ${String(level.id).padStart(2)} ${level.name} — ${e.message}`);
    continue;
  }
  const r = Engine.solve(Engine.clone(start));
  if (!r.ok) {
    failed++;
    console.log(`✘ ${String(level.id).padStart(2)} ${level.name} — ${r.reason}`);
    continue;
  }
  // 함정: 블록을 바로 자리에 맞추는 첫 수 중 더는 풀 수 없게 되는 것
  const fits = Engine.moves(start).filter((m) => Engine.matchingTarget(start, start.blocks[m.id], m.x, m.y));
  const traps = fits.filter((m) => {
    const n = Engine.clone(start);
    Engine.apply(n, m);
    return !Engine.solve(n).ok;
  });
  const problems = [];
  if (level.par !== r.path.length) problems.push(`par=${level.par} 인데 최소 ${r.path.length}수`);
  if (problems.length) failed++;
  const people = start.people.length;
  console.log(`${problems.length ? '✘' : '✔'} ${String(level.id).padStart(2)} ${level.name.padEnd(8)} 최소 ${r.path.length}수 · 백성 ${people}명 · 함정 ${traps.length}/${fits.length}${problems.length ? '  ⚠ ' + problems.join(', ') : ''}`);
  if (showPath) console.log('     ' + r.path.map((m) => `${start.blocks[m.id].v}→(${m.x},${m.y})`).join('  '));
}
process.exit(failed ? 1 : 0);
