// 백성을 구해라 — 규칙 엔진 (화면과 무관, 브라우저·Node 공용)
// 자모 모양 블록을 끌어 같은 모양의 자리에 딱 맞게 덮으면 그 자리의 백성이 구조되고, 지붕은 백성과 함께 떠나 길이 열린다.
// 초가집이 붙은 자리는 구할 때마다 다음 백성 무리가 나와 새 글자 자리가 생긴다.
(function (root) {
  const Jamo = root.Jamo;
  const Engine = (root.Engine = {});
  const key = (x, y) => x + ',' + y;
  const SIDES = ['top', 'bottom', 'left', 'right'];

  Engine.cells = (v, x, y) => Jamo.SHAPES[v].map(([dx, dy]) => [x + dx, y + dy]);

  // 글자 모양 안에서 백성이 서 있는 칸: 처음·가운데·끝
  Engine.peopleCells = function (v, x, y) {
    const cells = Engine.cells(v, x, y);
    const idx = [...new Set([0, Math.floor(cells.length / 2), cells.length - 1])];
    return idx.map((i) => cells[i]);
  };

  Engine.load = function (level) {
    const h = level.map.length, w = level.map[0].length;
    const s = { w, h, walls: {}, targets: [], blocks: [], moves: 0, saved: 0 };
    level.map.forEach((row, y) => {
      if (row.length !== w) throw new Error(`${y}번째 줄 길이가 다름 in level ${level.id}`);
      [...row].forEach((ch, x) => {
        if (ch === '#') s.walls[key(x, y)] = 'rock';
        else if (ch === '~') s.walls[key(x, y)] = 'water';
        else if (ch === ' ') s.walls[key(x, y)] = 'void';
        else if (ch !== '.') throw new Error(`알 수 없는 칸 '${ch}' (${x},${y}) in level ${level.id}`);
      });
    });
    // 같은 글자는 같은 단청 색
    const colorOf = {};
    const colorFor = (v) => {
      if (!Jamo.SHAPES[v]) throw new Error(`모양 없음 ${v} in level ${level.id}`);
      if (colorOf[v] === undefined) colorOf[v] = Object.keys(colorOf).length % Jamo.PALETTE.length;
      return colorOf[v];
    };
    level.targets.forEach((t, i) => {
      const queue = Array.isArray(t.v) ? t.v : [t.v];
      queue.forEach(colorFor);
      for (const v of queue) {
        for (const [x, y] of Engine.cells(v, ...t.pos)) {
          if (x < 0 || y < 0 || x >= w || y >= h || s.walls[key(x, y)]) throw new Error(`자리 ${v}가 막힌 칸에 있음 in level ${level.id}`);
        }
      }
      if (t.house && !SIDES.includes(t.house)) throw new Error(`초가집 방향 ${t.house} in level ${level.id}`);
      s.targets.push({ id: i, x: t.pos[0], y: t.pos[1], queue, wave: 0, house: t.house || null });
    });
    level.blocks.forEach((b, i) => {
      if (colorOf[b.v] === undefined) throw new Error(`블록 ${b.v}의 자리가 없음 in level ${level.id}`);
      s.blocks.push({ id: i, v: b.v, x: b.pos[0], y: b.pos[1], color: colorOf[b.v] });
    });
    s.colorOf = colorOf;
    s.total = s.targets.reduce((n, t) => n + t.queue.reduce((m, v) => m + Engine.peopleCells(v, t.x, t.y).length, 0), 0);
    for (const b of s.blocks) if (!Engine.canPlace(s, b, b.x, b.y)) throw new Error(`블록 ${b.v} 시작 위치가 막힘 in level ${level.id}`);
    return s;
  };

  Engine.clone = (s) => JSON.parse(JSON.stringify(s));

  // 지금 백성이 기다리는 글자 (다 구했으면 null)
  Engine.current = (t) => (t.wave < t.queue.length ? t.queue[t.wave] : null);

  Engine.blockAt = function (s, x, y) {
    for (const b of s.blocks) for (const [cx, cy] of Engine.cells(b.v, b.x, b.y)) if (cx === x && cy === y) return b;
    return null;
  };
  Engine.targetAt = function (s, x, y) {
    for (const t of s.targets) {
      const v = Engine.current(t);
      if (v) for (const [cx, cy] of Engine.cells(v, t.x, t.y)) if (cx === x && cy === y) return t;
    }
    return null;
  };

  // 블록 b가 (x, y)에 놓일 수 있는가 — 백성 위는 지나갈 수 있고, 바위·물·판 밖·다른 블록은 못 지나간다
  Engine.canPlace = function (s, b, x, y) {
    for (const [cx, cy] of Engine.cells(b.v, x, y)) {
      if (cx < 0 || cy < 0 || cx >= s.w || cy >= s.h || s.walls[key(cx, cy)]) return false;
      const o = Engine.blockAt(s, cx, cy);
      if (o && o !== b) return false;
    }
    return true;
  };

  // 한 칸씩 움직여 갈 수 있는 모든 위치 (BFS). Map<"x,y", [x, y]>
  Engine.reach = function (s, b) {
    const out = new Map([[key(b.x, b.y), [b.x, b.y]]]);
    const q = [[b.x, b.y]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (out.has(k) || !Engine.canPlace(s, b, nx, ny)) continue;
        out.set(k, [nx, ny]);
        q.push([nx, ny]);
      }
    }
    return out;
  };

  Engine.matchingTarget = (s, b, x, y) =>
    s.targets.find((t) => Engine.current(t) === b.v && t.x === x && t.y === y) || null;

  // 블록을 옮긴다. 같은 모양 자리에 딱 맞으면 백성을 구하고, 지붕은 백성과 함께 떠난다.
  Engine.place = function (s, b, x, y) {
    if (!Engine.reach(s, b).has(key(x, y))) throw new Error('갈 수 없는 위치');
    b.x = x;
    b.y = y;
    s.moves++;
    const t = Engine.matchingTarget(s, b, x, y);
    if (!t) return [];
    const people = Engine.peopleCells(b.v, x, y);
    s.blocks.splice(s.blocks.indexOf(b), 1);
    t.wave++;
    s.saved += people.length;
    const events = [{ type: 'save', block: { ...b }, target: t.id, people }];
    const next = Engine.current(t);
    if (next) events.push({ type: 'wave', target: t.id, v: next, people: Engine.peopleCells(next, t.x, t.y), left: t.queue.length - t.wave });
    return events;
  };

  Engine.isWon = (s) => s.targets.every((t) => !Engine.current(t));

  // ── 솔버 ──
  const stateKey = (s) =>
    s.blocks.map((b) => b.id + ':' + b.x + ',' + b.y).join('|') + '#' + s.targets.map((t) => t.wave).join(',');

  Engine.moves = function (s) {
    const out = [];
    for (const b of s.blocks) {
      for (const [x, y] of Engine.reach(s, b).values()) if (x !== b.x || y !== b.y) out.push({ id: b.id, x, y });
    }
    // 자리에 맞추는 수를 먼저 살펴본다
    const fits = (m) => (Engine.matchingTarget(s, s.blocks.find((b) => b.id === m.id), m.x, m.y) ? 1 : 0);
    return out.sort((a, c) => fits(c) - fits(a));
  };

  Engine.apply = (s, m) => Engine.place(s, s.blocks.find((b) => b.id === m.id), m.x, m.y);

  // BFS 최소 수 풀이
  Engine.solve = function (start, { maxStates = 200000 } = {}) {
    const seen = new Set([stateKey(start)]);
    let frontier = [{ state: start, path: [] }];
    while (frontier.length) {
      const next = [];
      for (const node of frontier) {
        if (Engine.isWon(node.state)) return { ok: true, path: node.path, state: node.state, explored: seen.size };
        for (const m of Engine.moves(node.state)) {
          const n = Engine.clone(node.state);
          Engine.apply(n, m);
          const k = stateKey(n);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push({ state: n, path: node.path.concat(m) });
          if (seen.size > maxStates) return { ok: false, reason: '상태 수 초과' };
        }
      }
      frontier = next;
    }
    return { ok: false, reason: '해답 없음', explored: seen.size };
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
