#!/usr/bin/env node
// BFS 솔버 — 모든 레벨에 해답이 있는지 확인하고 최소 이동 수를 계산한다.
// 사용법: node tools/solve.js [레벨id ...] [--path]
const path = require('path');
require(path.join(__dirname, '../js/hangul.js'));
require(path.join(__dirname, '../js/engine.js'));
require(path.join(__dirname, '../js/levels.js'));
const { Engine, LEVELS } = globalThis;

const MAX_STATES = 300000;

function successors(s) {
  const out = [];
  for (const b of s.blocks) {
    const r = Engine.moveRange(s, b);
    for (let d = r.min; d <= r.max; d++) {
      if (!d) continue;
      const n = Engine.clone(s);
      Engine.move(n, n.blocks.find((x) => x.id === b.id), d);
      out.push({ move: `${b.v}(${b.color})${Engine.axis(b) === 'h' ? (d > 0 ? '→' : '←') : d > 0 ? '↓' : '↑'}${Math.abs(d)}`, state: n });
    }
    if (Engine.flipTarget(s, b)) {
      const n = Engine.clone(s);
      Engine.flip(n, n.blocks.find((x) => x.id === b.id));
      out.push({ move: `${b.v}(${b.color})뒤집기`, state: n });
    }
  }
  return out;
}

function solve(level, needHidden) {
  const start = Engine.load(level);
  Engine.settle(start);
  const keyOf = (st) => Engine.stateKey(st) + (needHidden ? '#' + st.letters.join('') : '');
  const seen = new Map([[keyOf(start), null]]);
  let frontier = [{ state: start, path: [] }];
  let explored = 0;
  while (frontier.length) {
    const next = [];
    for (const node of frontier) {
      explored++;
      if (Engine.isWon(node.state) && (!needHidden || Engine.hiddenFound(node.state))) return { ok: true, path: node.path, explored, state: node.state };
      for (const { move, state } of successors(node.state)) {
        const k = keyOf(state);
        if (seen.has(k)) continue;
        seen.set(k, true);
        next.push({ state, path: node.path.concat(move) });
      }
      if (seen.size > MAX_STATES) return { ok: false, reason: '상태 수 초과', explored };
    }
    frontier = next;
  }
  return { ok: false, reason: '해답 없음', explored };
}

const args = process.argv.slice(2);
const showPath = args.includes('--path');
const ids = args.filter((a) => !a.startsWith('--')).map(Number);
let failed = 0;
for (const level of LEVELS) {
  if (ids.length && !ids.includes(level.id)) continue;
  const t0 = Date.now();
  const r = solve(level);
  const ms = Date.now() - t0;
  if (r.ok) {
    let hidden = '';
    if (level.hiddenWord) {
      const h = solve(level, true);
      if (h.ok) hidden = ` · 숨은단어 「${level.hiddenWord}」 최소 ${h.path.length}수`;
      else { hidden = ` · 숨은단어 「${level.hiddenWord}」 불가`; failed++; }
      if (showPath && h.ok) hidden += '\n   (숨은단어) ' + h.path.join('  ') + '  → ' + h.state.letters.join('');
    }
    const par = level.par !== r.path.length ? ` ⚠ par=${level.par} 불일치` : '';
    if (par) failed++;
    console.log(`✔ ${String(level.id).padStart(2)} ${level.name.padEnd(8)} 최소 ${r.path.length}수 (탐색 ${r.explored}, ${ms}ms)${par}`);
    if (showPath) console.log('   ' + r.path.join('  ') + '  → ' + r.state.letters.join(''));
    if (hidden) console.log('  ' + hidden);
  } else {
    failed++;
    console.log(`✘ ${String(level.id).padStart(2)} ${level.name} — ${r.reason} (탐색 ${r.explored})`);
  }
}
process.exit(failed ? 1 : 0);
