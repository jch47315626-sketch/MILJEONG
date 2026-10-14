#!/usr/bin/env node
// 레벨 검증 — 모든 레벨에 해답이 있는지, par(최소 수)가 맞는지, 그림 단어를 순서대로 만들 수 있는지 확인한다.
// 사용법: node tools/solve.js [레벨id ...] [--path]
const path = require('path');
require(path.join(__dirname, '../js/hangul.js'));
require(path.join(__dirname, '../js/engine.js'));
require(path.join(__dirname, '../js/levels.js'));
const { Engine, LEVELS } = globalThis;

const args = process.argv.slice(2);
const showPath = args.includes('--path');
const ids = args.filter((a) => !a.startsWith('--')).map(Number);

function fmt(level, r) {
  const s = Engine.load(level);
  Engine.settle(s);
  return r.path.map((m) => {
    const b = s.blocks.find((x) => x.id === m.id);
    const txt = m.flip ? `${b.v}뒤집기` : `${b.v}${Engine.axis(b) === 'h' ? (m.d > 0 ? '→' : '←') : m.d > 0 ? '↓' : '↑'}${Math.abs(m.d)}`;
    Engine.apply(s, m);
    return txt;
  }).join('  ') + '  → ' + r.state.letters.join('');
}

let failed = 0;
for (const level of LEVELS) {
  if (ids.length && !ids.includes(level.id)) continue;
  const start = Engine.load(level);
  const initEvents = Engine.settle(start);
  const problems = [];
  if (initEvents.some((e) => e.type === 'absorb')) problems.push('시작하자마자 흡수됨');
  const r = Engine.solve(start);
  if (!r.ok) {
    failed++;
    console.log(`✘ ${String(level.id).padStart(2)} ${level.name} — ${r.reason}`);
    continue;
  }
  if (level.par !== r.path.length) problems.push(`par=${level.par} 인데 최소 ${r.path.length}수`);
  let word = '';
  if (level.word) {
    const w = Engine.solve(Engine.clone(start), { needWord: true });
    if (!w.ok) problems.push(`「${level.word}」 순서대로 불가`);
    else word = ` · 「${level.word}」 ${w.path.length}수`;
    if (showPath && w.ok) word += '\n     단어: ' + fmt(level, w);
  }
  if (problems.length) failed++;
  console.log(`${problems.length ? '✘' : '✔'} ${String(level.id).padStart(2)} ${level.emoji || ''} ${level.name} 최소 ${r.path.length}수${word}${problems.length ? '  ⚠ ' + problems.join(', ') : ''}`);
  if (showPath) console.log('     최소: ' + fmt(level, r));
}
process.exit(failed ? 1 : 0);
