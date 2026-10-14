// 자모냥 게임 규칙 엔진 — 화면과 무관한 순수 로직. 브라우저와 Node(솔버) 양쪽에서 쓴다.
(function (root) {
  const Jamo = root.Jamo;
  const Engine = (root.Engine = {});

  const key = (x, y) => x + ',' + y;
  const STONE_GLYPHS = ['ㆆ', 'ㅿ', 'ㆁ'];
  const STONE_HP = 3;

  // 레벨 데이터 → 게임 상태
  Engine.load = function (level) {
    const h = level.map.length;
    const w = [...level.map[0]].length;
    const s = {
      w, h,
      dirRule: !!level.dirRule,
      hiddenWord: level.hiddenWord || null,
      blocks: [],
      tiles: {},
      stones: {},
      pouches: [],
      letters: [],
      words: [],
      doneLetters: [],
      moves: 0,
      nextId: 0,
    };
    let stoneN = 0;
    level.map.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        if (ch === '#') {
          s.stones[key(x, y)] = { hp: STONE_HP, glyph: STONE_GLYPHS[stoneN++ % STONE_GLYPHS.length] };
          return;
        }
        const color = Jamo.colorOf(ch);
        if (!color) throw new Error(`알 수 없는 칸 '${ch}' (${x},${y}) in level ${level.id}`);
        s.tiles[key(x, y)] = { c: ch, color, ice: 0 };
      });
    });
    (level.ice || []).forEach(([x, y]) => {
      const t = s.tiles[key(x, y)];
      if (!t) throw new Error(`얼음 위치에 자음이 없음 (${x},${y}) in level ${level.id}`);
      t.ice = 1;
    });
    level.blocks.forEach((b) => {
      if (!Jamo.VOWELS[b.v]) throw new Error(`알 수 없는 모음 ${b.v}`);
      s.blocks.push({
        id: s.nextId++,
        v: b.v,
        color: b.color,
        x: b.pos[0],
        y: b.pos[1],
        count: b.count,
        total: b.count,
        letters: [],
        flippable: !!b.flippable,
      });
    });
    (level.pouches || []).forEach((p) => {
      const feed = { top: [p.at, 0], bottom: [p.at, h - 1], left: [0, p.at], right: [w - 1, p.at] }[p.side];
      s.pouches.push({ side: p.side, at: p.at, fx: feed[0], fy: feed[1], queue: [...p.queue], idx: 0 });
    });
    // 겹침 검사
    const seen = new Set(Object.keys(s.tiles).concat(Object.keys(s.stones)));
    for (const b of s.blocks) {
      for (const [x, y] of Engine.cells(b)) {
        const k = key(x, y);
        if (x < 0 || y < 0 || x >= w || y >= h) throw new Error(`블록 ${b.v}가 보드 밖 (${x},${y}) in level ${level.id}`);
        if (seen.has(k)) throw new Error(`블록 ${b.v}가 겹침 (${x},${y}) in level ${level.id}`);
        seen.add(k);
      }
    }
    return s;
  };

  Engine.clone = (s) => JSON.parse(JSON.stringify(s));

  Engine.cells = function (b, ox = 0, oy = 0, v = b.v) {
    return Jamo.VOWELS[v].cells.map(([dx, dy]) => [b.x + ox + dx, b.y + oy + dy]);
  };

  Engine.axis = (b) => Jamo.VOWELS[b.v].axis;

  Engine.blockAt = function (s, x, y) {
    for (const b of s.blocks) for (const [cx, cy] of Engine.cells(b)) if (cx === x && cy === y) return b;
    return null;
  };

  // 칸이 비었는가 (ignore: 무시할 블록)
  Engine.isFree = function (s, x, y, ignore) {
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) return false;
    const k = key(x, y);
    if (s.tiles[k] || s.stones[k]) return false;
    const b = Engine.blockAt(s, x, y);
    return !b || b === ignore;
  };

  const fits = (s, b, ox, oy, v) => Engine.cells(b, ox, oy, v).every(([x, y]) => Engine.isFree(s, x, y, b));

  // 블록이 자기 축으로 갈 수 있는 범위 {min, max} (칸 단위 변위)
  Engine.moveRange = function (s, b) {
    const h = Engine.axis(b) === 'h';
    const off = (d) => (h ? [d, 0] : [0, d]);
    let min = 0, max = 0;
    while (fits(s, b, ...off(max + 1))) max++;
    while (fits(s, b, ...off(min - 1))) min--;
    return { min, max };
  };

  Engine.move = function (s, b, delta) {
    if (!delta) return [];
    const r = Engine.moveRange(s, b);
    if (delta < r.min || delta > r.max) throw new Error('이동 불가');
    if (Engine.axis(b) === 'h') b.x += delta;
    else b.y += delta;
    s.moves++;
    return Engine.settle(s);
  };

  // 회전 모음: ㅏ↔ㅓ, ㅗ↔ㅜ … 기둥 위치를 유지한 채 뒤집는다.
  Engine.flipTarget = function (s, b) {
    const nv = Jamo.FLIP[b.v];
    if (!b.flippable || !nv) return null;
    const [bx, by] = Jamo.VOWELS[b.v].bar;
    const [nx, ny] = Jamo.VOWELS[nv].bar;
    const ox = bx - nx, oy = by - ny;
    return fits(s, b, ox, oy, nv) ? { v: nv, ox, oy } : null;
  };

  Engine.flip = function (s, b) {
    const t = Engine.flipTarget(s, b);
    if (!t) return null;
    b.v = t.v;
    b.x += t.ox;
    b.y += t.oy;
    s.moves++;
    return Engine.settle(s);
  };

  // 블록 주변에서 자음을 받을 수 있는 칸들 (위치 규칙 반영)
  Engine.intakeCells = function (s, b) {
    const own = new Set(Engine.cells(b).map(([x, y]) => key(x, y)));
    const axis = Engine.axis(b);
    const dirs = s.dirRule ? (axis === 'v' ? [[-1, 0]] : [[0, -1]]) : [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const out = new Map();
    for (const [x, y] of Engine.cells(b)) {
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (!own.has(k) && !out.has(k)) out.set(k, [nx, ny]);
      }
    }
    return [...out.values()].sort((a, b2) => a[1] - b2[1] || a[0] - b2[0]);
  };

  function recordLetter(s, b, letter, events) {
    b.letters.push(letter);
    s.letters.push(letter);
    const seq = s.letters.join('');
    for (const len of [3, 2]) {
      if (seq.length < len) continue;
      const w = seq.slice(-len);
      if (Jamo.WORDS.has(w)) {
        s.words.push(w);
        events.push({ type: 'word', word: w });
        break;
      }
    }
  }

  // 흡수 → 블록 완성 → 주머니 보충을 더 이상 변화가 없을 때까지 반복
  Engine.settle = function (s) {
    const events = [];
    const cracked = new Set();
    for (let guard = 0; guard < 200; guard++) {
      let changed = false;

      for (const b of s.blocks) {
        for (const [x, y] of Engine.intakeCells(s, b)) {
          if (b.count <= 0) break;
          const k = key(x, y);
          const t = s.tiles[k];
          if (!t || t.color !== b.color) continue;
          if (t.ice > 0) {
            if (!cracked.has(k)) {
              t.ice--;
              cracked.add(k);
              events.push({ type: 'crack', x, y });
              changed = true;
            }
            continue;
          }
          if (cracked.has(k)) continue;
          const need = Jamo.isDouble(t.c) ? 2 : 1;
          if (b.count < need) continue;
          delete s.tiles[k];
          b.count -= need;
          const letter = Jamo.compose(t.c, b.v);
          events.push({ type: 'absorb', x, y, c: t.c, color: t.color, blockId: b.id, letter });
          recordLetter(s, b, letter, events);
          changed = true;
        }
      }

      const done = s.blocks.filter((b) => b.count <= 0);
      for (const b of done) {
        const cells = Engine.cells(b);
        s.blocks.splice(s.blocks.indexOf(b), 1);
        s.doneLetters.push(b.letters);
        events.push({ type: 'clear', block: JSON.parse(JSON.stringify(b)), cells });
        // 옛한글 장애물: 인접한 블록이 완성될 때마다 금이 간다
        const hit = new Set();
        for (const [x, y] of cells)
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const k = key(x + dx, y + dy);
            if (s.stones[k]) hit.add(k);
          }
        for (const k of hit) {
          const st = s.stones[k];
          st.hp--;
          const [sx, sy] = k.split(',').map(Number);
          if (st.hp <= 0) {
            delete s.stones[k];
            events.push({ type: 'stoneBreak', x: sx, y: sy, glyph: st.glyph });
          } else events.push({ type: 'stoneHit', x: sx, y: sy });
        }
        changed = true;
      }

      for (const p of s.pouches) {
        if (p.idx >= p.queue.length) continue;
        if (!Engine.isFree(s, p.fx, p.fy)) continue;
        const c = p.queue[p.idx++];
        s.tiles[key(p.fx, p.fy)] = { c, color: Jamo.colorOf(c), ice: 0 };
        events.push({ type: 'refill', x: p.fx, y: p.fy, c, side: p.side });
        changed = true;
      }

      if (!changed) break;
    }
    return events;
  };

  Engine.isWon = (s) => s.blocks.length === 0;

  Engine.hiddenFound = function (s) {
    const w = s.hiddenWord;
    if (!w) return false;
    return s.letters.join('').includes(w) || s.doneLetters.some((ls) => ls.join('').includes(w));
  };

  // 남은 블록 중 하나라도 움직이거나 뒤집을 수 있는가
  Engine.hasMoves = function (s) {
    return s.blocks.some((b) => {
      const r = Engine.moveRange(s, b);
      return r.min < 0 || r.max > 0 || !!Engine.flipTarget(s, b);
    });
  };

  // ── 아이템 ──
  Engine.recolor = function (s, x, y, color) {
    const t = s.tiles[key(x, y)];
    if (!t) return null;
    t.color = color;
    return Engine.settle(s);
  };

  Engine.erase = function (s, x, y) {
    const k = key(x, y);
    if (s.tiles[k]) delete s.tiles[k];
    else if (s.stones[k]) delete s.stones[k];
    else return null;
    return Engine.settle(s);
  };

  Engine.stamp = function (s, b) {
    b.count = 0;
    return Engine.settle(s);
  };

  // 솔버용 상태 키
  Engine.stateKey = function (s) {
    const bs = s.blocks.map((b) => `${b.id}${b.v}${b.x},${b.y},${b.count}`).join('|');
    const ts = Object.keys(s.tiles).sort().map((k) => k + s.tiles[k].c + s.tiles[k].ice).join('|');
    const st = Object.keys(s.stones).sort().map((k) => k + s.stones[k].hp).join('|');
    const ps = s.pouches.map((p) => p.idx).join(',');
    return bs + '#' + ts + '#' + st + '#' + ps;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
