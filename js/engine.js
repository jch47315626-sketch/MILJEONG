// 백성을 구해라 — 규칙 엔진 (화면과 무관, 브라우저·Node 공용)
// 자모 모양 블록을 끌어 같은 모양의 자리에 딱 맞게 덮으면 그 자리의 백성이 구조되고, 블록은 지붕이 되어 고정된다.
(function (root) {
  const Jamo = root.Jamo;
  const Engine = (root.Engine = {});
  const key = (x, y) => x + ',' + y;

  Engine.cells = (v, x, y) => Jamo.SHAPES[v].map(([dx, dy]) => [x + dx, y + dy]);

  Engine.load = function (level) {
    const h = level.map.length, w = level.map[0].length;
    const s = { w, h, walls: {}, people: [], targets: [], blocks: [], moves: 0 };
    level.map.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '#') s.walls[key(x, y)] = 'rock';
      else if (ch === '~') s.walls[key(x, y)] = 'water';
      else if (ch === 'o') s.people.push([x, y]);
      else if (ch !== '.') throw new Error(`알 수 없는 칸 '${ch}' (${x},${y}) in level ${level.id}`);
    }));
    const colorOf = {};
    level.targets.forEach((t, i) => {
      if (!Jamo.SHAPES[t.v]) throw new Error(`모양 없음 ${t.v}`);
      if (colorOf[t.v] === undefined) colorOf[t.v] = Object.keys(colorOf).length % Jamo.PALETTE.length;
      const cells = Engine.cells(t.v, ...t.pos);
      for (const [x, y] of cells) {
        if (x < 0 || y < 0 || x >= w || y >= h || s.walls[key(x, y)]) throw new Error(`자리 ${t.v}가 막힌 칸에 있음 in level ${level.id}`);
      }
      const people = s.people.filter(([px, py]) => cells.some(([x, y]) => x === px && y === py));
      if (!people.length) throw new Error(`자리 ${t.v}에 백성이 없음 in level ${level.id}`);
      s.targets.push({ id: i, v: t.v, x: t.pos[0], y: t.pos[1], people, saved: false, color: colorOf[t.v] });
    });
    const covered = s.targets.reduce((n, t) => n + t.people.length, 0);
    if (covered !== s.people.length) throw new Error(`자리 밖에 있는 백성이 있음 in level ${level.id}`);
    level.blocks.forEach((b, i) => {
      if (colorOf[b.v] === undefined) throw new Error(`블록 ${b.v}의 자리가 없음 in level ${level.id}`);
      s.blocks.push({ id: i, v: b.v, x: b.pos[0], y: b.pos[1], locked: false, color: colorOf[b.v] });
    });
    for (const b of s.blocks) if (!Engine.canPlace(s, b, b.x, b.y)) throw new Error(`블록 ${b.v} 시작 위치가 막힘 in level ${level.id}`);
    return s;
  };

  Engine.clone = (s) => JSON.parse(JSON.stringify(s));

  Engine.blockAt = function (s, x, y) {
    for (const b of s.blocks) for (const [cx, cy] of Engine.cells(b.v, b.x, b.y)) if (cx === x && cy === y) return b;
    return null;
  };
  Engine.targetAt = function (s, x, y) {
    for (const t of s.targets) for (const [cx, cy] of Engine.cells(t.v, t.x, t.y)) if (cx === x && cy === y) return t;
    return null;
  };

  // 블록 b가 (x, y)에 놓일 수 있는가 — 백성 위는 지나갈 수 있고, 바위·물·다른 블록은 못 지나간다
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
    s.targets.find((t) => !t.saved && t.v === b.v && t.x === x && t.y === y) || null;

  // 블록을 옮긴다. 같은 모양 자리에 딱 맞으면 백성을 구하고 지붕으로 고정.
  Engine.place = function (s, b, x, y) {
    if (b.locked) throw new Error('고정된 블록');
    if (!Engine.reach(s, b).has(key(x, y))) throw new Error('갈 수 없는 위치');
    b.x = x;
    b.y = y;
    s.moves++;
    const t = Engine.matchingTarget(s, b, x, y);
    if (!t) return [];
    t.saved = true;
    b.locked = true;
    return [{ type: 'save', target: t, block: b }];
  };

  Engine.isWon = (s) => s.targets.every((t) => t.saved);
  Engine.savedCount = (s) => s.targets.filter((t) => t.saved).reduce((n, t) => n + t.people.length, 0);

  // ── 솔버 ──
  const stateKey = (s) => s.blocks.map((b) => (b.locked ? 'L' : '') + b.x + ',' + b.y).join('|');

  Engine.moves = function (s) {
    const out = [];
    for (const b of s.blocks) {
      if (b.locked) continue;
      for (const [x, y] of Engine.reach(s, b).values()) if (x !== b.x || y !== b.y) out.push({ id: b.id, x, y });
    }
    // 자리에 맞추는 수를 먼저 살펴본다
    const fits = (m) => (Engine.matchingTarget(s, s.blocks[m.id], m.x, m.y) ? 1 : 0);
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
