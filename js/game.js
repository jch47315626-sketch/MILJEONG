// 자모냥 — 화면, 입력, 애니메이션, 진행 저장.
(function () {
  const { Jamo, Engine, LEVELS } = window;
  const $ = (id) => document.getElementById(id);
  const WORLD_NAMES = { 1: '서당', 2: '장터', 3: '궁궐' };
  const ITEMS = [
    { id: 'brush', ico: '🖌️', name: '붓', desc: '자음 하나의 색을 바꿉니다' },
    { id: 'eraser', ico: '🧽', name: '지우개', desc: '자음이나 옛한글 돌 하나를 지웁니다' },
    { id: 'stamp', ico: '🔴', name: '도장', desc: '블록 하나를 즉시 완성합니다' },
    { id: 'hanji', ico: '📜', name: '한지', desc: '타이머를 30초 멈춥니다' },
  ];
  const FREEZE_MS = 30000;

  // ── 진행 저장 (브라우저 저장소가 막혀 있어도 동작) ──
  const SAVE_KEY = 'jamonyang.progress.v1';
  let progress = { stars: {}, best: {} };
  try { progress = Object.assign(progress, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) { /* 무시 */ }
  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); } catch (e) { /* 무시 */ } };

  // ── 소리 (WebAudio 합성) ──
  let audio = null, muted = false;
  function tone(freq, dur, type = 'sine', vol = 0.15, slide = 0) {
    if (muted) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime;
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur);
    } catch (e) { /* 소리 없이 진행 */ }
  }
  const sfx = {
    pop: () => tone(660, 0.12, 'triangle', 0.15, 200),
    slide: () => tone(180, 0.08, 'sine', 0.06),
    stamp: () => { tone(90, 0.3, 'square', 0.12, -40); tone(140, 0.2, 'sine', 0.2, -60); },
    word: () => { tone(523, 0.15, 'triangle', 0.12); setTimeout(() => tone(784, 0.25, 'triangle', 0.12), 120); },
    crack: () => tone(1400, 0.08, 'square', 0.05, -600),
    fail: () => tone(220, 0.5, 'sawtooth', 0.08, -120),
  };

  // ── 상태 ──
  let level = null, state = null, game = null;
  const canvas = $('board'), ctx = canvas.getContext('2d');
  let cs = 48, ox = 0, oy = 0, dpr = 1;
  let anims = [];
  const hiddenTiles = new Map(); // 보충 애니메이션 동안 숨길 칸
  let drag = null;

  // ── 메뉴 ──
  function buildMenu() {
    const wrap = $('worlds');
    wrap.innerHTML = '';
    const worlds = [...new Set(LEVELS.map((l) => l.world))];
    for (const w of worlds) {
      const ls = LEVELS.filter((l) => l.world === w);
      const got = ls.reduce((a, l) => a + (progress.stars[l.id] || 0), 0);
      const el = document.createElement('div');
      el.className = 'world';
      el.innerHTML = `<h2>${w}. ${WORLD_NAMES[w] || ''} <small>★ ${got}/${ls.length * 3}</small></h2><div class="level-grid"></div>`;
      const grid = el.querySelector('.level-grid');
      for (const l of ls) {
        const b = document.createElement('button');
        b.className = 'level-btn';
        const st = progress.stars[l.id] || 0;
        b.innerHTML = `${l.id}<span class="st">${'★'.repeat(st)}</span>`;
        b.title = l.name;
        b.disabled = !isUnlocked(l);
        b.onclick = () => startLevel(l.id);
        grid.appendChild(b);
      }
      wrap.appendChild(el);
    }
    $('legendList').innerHTML = Jamo.COLOR_ORDER.map((k) => {
      const g = Jamo.GROUPS[k];
      return `<li><span class="chip" style="background:${g.fill}"></span>${g.name} (${g.desc}) — ${g.consonants.join(' ')}</li>`;
    }).join('');
  }
  function isUnlocked(l) {
    const i = LEVELS.indexOf(l);
    return i === 0 || progress.stars[LEVELS[i - 1].id] > 0;
  }
  function showMenu() {
    game = null;
    $('game').classList.add('hidden');
    $('overlay').classList.add('hidden');
    $('menu').classList.remove('hidden');
    buildMenu();
  }

  // ── 레벨 시작 ──
  function startLevel(id) {
    level = LEVELS.find((l) => l.id === id);
    state = Engine.load(level);
    anims = [];
    hiddenTiles.clear();
    drag = null;
    game = {
      timeLeft: level.time * 1000,
      frozenUntil: 0,
      last: performance.now(),
      over: false,
      items: Object.fromEntries(ITEMS.map((i) => [i.id, 1])),
      itemMode: null,
      brushTarget: null,
      hiddenShown: false,
    };
    $('menu').classList.add('hidden');
    $('overlay').classList.add('hidden');
    $('game').classList.remove('hidden');
    $('worldName').textContent = `${level.world}. ${WORLD_NAMES[level.world]} · ${level.id}단계`;
    $('levelName').textContent = level.name;
    $('tip').textContent = level.tip || '';
    $('ruleBox').innerHTML = level.dirRule ? '<span class="rule-on">위치 규칙 ON</span>' : '';
    closePalette();
    buildItems();
    layout();
    playEvents(Engine.settle(state));
    updateHud();
  }

  // ── 레이아웃 ──
  function layout() {
    if (!state) return;
    const wrap = $('boardWrap');
    const maxW = Math.min(wrap.clientWidth || 360, 460);
    const maxH = Math.max(320, window.innerHeight - 330);
    const m = state.pouches.length ? 1.8 : 1.0; // 주머니가 있으면 여백을 넓게
    cs = Math.floor(Math.min(maxW / (state.w + m), maxH / (state.h + m)));
    const W = cs * (state.w + m), H = cs * (state.h + m);
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ox = cs * m / 2;
    oy = cs * m / 2;
  }
  window.addEventListener('resize', layout);

  // ── HUD ──
  function score() {
    let s = state.letters.length * Jamo.SCORE.letter;
    for (const w of state.words) s += w.length * Jamo.SCORE.letter * (w.length - 1);
    return s;
  }
  function updateHud() {
    $('score').textContent = score();
    $('moves').textContent = state.moves;
    const found = Engine.hiddenFound(state);
    if (level.hiddenWord) {
      $('hiddenBox').innerHTML = found
        ? `숨은 단어 <b style="color:#ffb4a8">「${level.hiddenWord}」</b>`
        : `숨은 단어 <b>「${'○'.repeat(level.hiddenWord.length)}」</b>`;
      if (found && !game.hiddenShown) {
        game.hiddenShown = true;
        toast(`숨은 단어 「${level.hiddenWord}」!`);
      }
    } else $('hiddenBox').innerHTML = `목표 <b>${level.par + 1}수</b> 이내`;
    // 완성 글자 — 단어가 된 부분은 붉게
    const seq = state.letters;
    const mark = new Array(seq.length).fill(false);
    const joined = seq.join('');
    for (const w of new Set(state.words)) {
      let i = joined.indexOf(w);
      while (i >= 0) { for (let k = 0; k < w.length; k++) mark[i + k] = true; i = joined.indexOf(w, i + 1); }
    }
    const el = $('letters');
    el.innerHTML = seq.map((c, i) => (mark[i] ? `<span class="word">${c}</span>` : c)).join('');
    el.scrollLeft = el.scrollWidth;
    for (const it of ITEMS) {
      const b = document.querySelector(`.item[data-id="${it.id}"]`);
      if (!b) continue;
      b.disabled = game.items[it.id] <= 0 || game.over;
      b.classList.toggle('active', game.itemMode === it.id);
      b.querySelector('.n').textContent = game.items[it.id];
    }
  }

  function buildItems() {
    $('items').innerHTML = ITEMS.map(
      (i) => `<button class="item" data-id="${i.id}" title="${i.desc}"><span class="ico">${i.ico}</span>${i.name}<span class="n">1</span></button>`
    ).join('');
    document.querySelectorAll('.item').forEach((b) => {
      b.onclick = () => useItem(b.dataset.id);
    });
  }

  let toastTimer = 0;
  function toast(text, info) {
    const t = $('toast');
    t.textContent = text;
    t.classList.toggle('info', !!info);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), info ? 2200 : 1400);
  }

  // ── 아이템 ──
  function useItem(id) {
    if (!game || game.over || game.items[id] <= 0) return;
    closePalette();
    if (id === 'hanji') {
      game.items.hanji--;
      game.frozenUntil = performance.now() + FREEZE_MS;
      toast('📜 시간이 30초 멈춥니다', true);
      updateHud();
      return;
    }
    game.itemMode = game.itemMode === id ? null : id;
    if (game.itemMode) toast(ITEMS.find((i) => i.id === id).desc, true);
    updateHud();
  }

  function applyItemAt(x, y) {
    const mode = game.itemMode;
    const k = x + ',' + y;
    if (mode === 'eraser') {
      if (!state.tiles[k] && !state.stones[k]) return toast('자음이나 돌을 고르세요', true);
      const was = state.tiles[k] || state.stones[k];
      const evs = Engine.erase(state, x, y);
      anims.push(burst(x, y, was.color ? Jamo.GROUPS[was.color].fill : '#8a8580'));
      game.items.eraser--;
      finishItem(evs);
    } else if (mode === 'stamp') {
      const b = Engine.blockAt(state, x, y);
      if (!b) return toast('블록을 고르세요', true);
      game.items.stamp--;
      sfx.stamp();
      anims.push(stampMark(b));
      finishItem(Engine.stamp(state, b));
    } else if (mode === 'brush') {
      if (!state.tiles[k]) return toast('자음을 고르세요', true);
      game.brushTarget = [x, y];
      openPalette();
    }
  }
  function finishItem(evs) {
    game.itemMode = null;
    playEvents(evs || []);
    afterChange();
  }
  function openPalette() {
    const p = $('palette');
    p.innerHTML = Jamo.COLOR_ORDER.map((c) => {
      const g = Jamo.GROUPS[c];
      return `<button data-c="${c}" style="background:${g.fill}" title="${g.name}">${g.name}</button>`;
    }).join('');
    p.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const [x, y] = game.brushTarget;
        game.items.brush--;
        closePalette();
        finishItem(Engine.recolor(state, x, y, b.dataset.c));
      };
    });
    p.classList.remove('hidden');
  }
  function closePalette() { $('palette').classList.add('hidden'); }

  // ── 진행 판정 ──
  function afterChange() {
    updateHud();
    if (Engine.isWon(state)) return setTimeout(win, 650);
    if (!Engine.hasMoves(state)) {
      const anyItem = Object.values(game.items).some((n) => n > 0);
      if (anyItem) toast('막혔어요! 아이템을 써 보세요', true);
      else setTimeout(() => lose('더 이상 움직일 수 없어요'), 500);
    }
  }

  function win() {
    if (!game || game.over) return;
    game.over = true;
    const secs = Math.ceil(game.timeLeft / 1000);
    const base = state.letters.length * Jamo.SCORE.letter;
    const bonus = score() - base;
    const timeBonus = secs * Jamo.SCORE.perSecond;
    const total = base + bonus + timeBonus;
    const third = level.hiddenWord ? Engine.hiddenFound(state) : state.moves <= level.par + 1;
    const goals = [
      ['클리어', true],
      ['시간 절반 이상 남기기', secs * 2 >= level.time],
      [level.hiddenWord ? `숨은 단어 「${level.hiddenWord}」 완성` : `${level.par + 1}수 이내로 클리어`, third],
    ];
    const stars = goals.filter((g) => g[1]).length;
    progress.stars[level.id] = Math.max(progress.stars[level.id] || 0, stars);
    progress.best[level.id] = Math.max(progress.best[level.id] || 0, total);
    save();
    sfx.word();
    const words = [...new Set(state.words)];
    showResult('완성!', stars, `
      <table>
        <tr><td>글자 ${state.letters.length}개</td><td>${base}</td></tr>
        <tr><td>단어 보너스${words.length ? ' (' + words.join(', ') + ')' : ''}</td><td>${bonus}</td></tr>
        <tr><td>남은 시간 ${secs}초</td><td>${timeBonus}</td></tr>
        <tr class="total"><td>합계</td><td>${total}</td></tr>
      </table>
      <ul class="goals">${goals.map(([t, ok]) => `<li class="${ok ? 'ok' : ''}">${ok ? '★' : '☆'} ${t}</li>`).join('')}</ul>`, true);
  }

  function lose(reason) {
    if (!game || game.over) return;
    game.over = true;
    sfx.fail();
    updateHud();
    showResult('아쉬워요', 0, `<p>${reason}</p>`, false);
  }

  function showResult(title, stars, body, cleared) {
    $('resultTitle').textContent = title;
    $('resultStars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('');
    $('resultStars').style.display = cleared ? '' : 'none';
    $('resultBody').innerHTML = body;
    const idx = LEVELS.indexOf(level);
    const next = LEVELS[idx + 1];
    const nb = $('resultNext');
    nb.textContent = next ? '다음 레벨' : '레벨 선택';
    nb.disabled = !cleared && !(next && isUnlocked(next));
    nb.onclick = () => (next ? startLevel(next.id) : showMenu());
    $('resultRetry').onclick = () => startLevel(level.id);
    $('overlay').classList.remove('hidden');
  }

  // ── 입력 ──
  function cellFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    return { px, py, x: Math.floor((px - ox) / cs), y: Math.floor((py - oy) / cs) };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!game || game.over) return;
    const p = cellFromEvent(e);
    if (game.itemMode) return applyItemAt(p.x, p.y);
    closePalette();
    const b = Engine.blockAt(state, p.x, p.y);
    if (!b) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { b, sx: p.px, sy: p.py, range: Engine.moveRange(state, b), off: 0, moved: false, lastCell: 0 };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = cellFromEvent(e);
    const d = Engine.axis(drag.b) === 'h' ? (p.px - drag.sx) / cs : (p.py - drag.sy) / cs;
    if (Math.abs(d) > 0.15) drag.moved = true;
    drag.off = Math.max(drag.range.min, Math.min(drag.range.max, d));
    const c = Math.round(drag.off);
    if (c !== drag.lastCell) { drag.lastCell = c; sfx.slide(); }
  });

  function endDrag() {
    if (!drag) return;
    const { b, moved } = drag;
    const delta = Math.round(drag.off);
    drag = null;
    if (!moved) {
      if (b.flippable) {
        const evs = Engine.flip(state, b);
        if (evs) { sfx.slide(); playEvents(evs); afterChange(); }
        else toast('공간이 없어 뒤집을 수 없어요', true);
      }
      return;
    }
    if (!delta) return;
    playEvents(Engine.move(state, b, delta));
    afterChange();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  $('backBtn').onclick = showMenu;
  $('restartBtn').onclick = () => level && startLevel(level.id);
  $('soundBtn').onclick = () => { muted = !muted; $('soundBtn').textContent = muted ? '🔇' : '🔊'; };

  // ── 애니메이션 ──
  const now = () => performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const cellCenter = (x, y) => [ox + (x + 0.5) * cs, oy + (y + 0.5) * cs];
  function blockCenter(b) {
    const [bx, by] = Jamo.VOWELS[b.v].bar;
    return cellCenter(b.x + bx, b.y + by);
  }

  function playEvents(events) {
    let delay = 0;
    const t = now();
    for (const ev of events) {
      if (ev.type === 'absorb') {
        const blk = state.blocks.find((b) => b.id === ev.blockId) ||
          events.find((e) => e.type === 'clear' && e.block.id === ev.blockId).block;
        const from = cellCenter(ev.x, ev.y), to = blockCenter(blk);
        const t0 = t + delay;
        anims.push({ t0, dur: 260, draw: (p) => {
          const e = ease(p);
          const s = 1 - 0.5 * e;
          drawTile(from[0] + (to[0] - from[0]) * e - cs / 2 * s, from[1] + (to[1] - from[1]) * e - cs / 2 * s, cs * s, { c: ev.c, color: ev.color, ice: 0 });
        } });
        anims.push(floatText(ev.letter, to[0], to[1] - cs * 0.3, t0 + 240, Jamo.GROUPS[ev.color].dark));
        setTimeout(sfx.pop, delay + 200);
        delay += 140;
      } else if (ev.type === 'clear') {
        const blk = ev.block;
        const t0 = t + delay + 150;
        anims.push({ t0: t, dur: delay + 450, draw: (p, el) => {
          const fade = el < delay + 150 ? 1 : Math.max(0, 1 - (el - delay - 150) / 300);
          ctx.globalAlpha = fade;
          drawBlock(blk, 0, 0, 1 + (1 - fade) * 0.15);
          ctx.globalAlpha = 1;
        } });
        const [cx, cy] = blockCenter(blk);
        if (blk.letters.length) anims.push(floatText(blk.letters.join(''), cx, cy - cs * 0.5, t0, '#fff', 1.1, true));
        setTimeout(sfx.stamp, delay + 150);
        delay += 200;
      } else if (ev.type === 'refill') {
        const k = ev.x + ',' + ev.y;
        const t0 = t + delay;
        hiddenTiles.set(k, t0 + 280);
        const tile = { c: ev.c, color: Jamo.colorOf(ev.c), ice: 0 };
        const dir = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[ev.side];
        anims.push({ t0, dur: 280, draw: (p) => {
          const e = ease(p);
          drawTile(ox + (ev.x + dir[0] * (1 - e) * 0.8) * cs, oy + (ev.y + dir[1] * (1 - e) * 0.8) * cs, cs, tile, 0.4 + 0.6 * e);
        } });
        delay += 120;
      } else if (ev.type === 'crack') {
        anims.push(burst(ev.x, ev.y, '#cfe9ff', t + delay));
        setTimeout(sfx.crack, delay);
      } else if (ev.type === 'stoneHit' || ev.type === 'stoneBreak') {
        anims.push(burst(ev.x, ev.y, '#8a8580', t + delay));
        if (ev.type === 'stoneBreak') {
          const [cx, cy] = cellCenter(ev.x, ev.y);
          anims.push(floatText(ev.glyph, cx, cy, t + delay, '#8a8580'));
        }
        setTimeout(sfx.crack, delay);
      } else if (ev.type === 'word') {
        const w = ev.word;
        setTimeout(() => { toast(`${w}! ×${w.length}`); sfx.word(); }, delay + 200);
      }
    }
  }

  function floatText(text, x, y, t0, color, size = 0.75, stroke) {
    return { t0, dur: 800, draw: (p) => {
      ctx.globalAlpha = 1 - p * p;
      ctx.font = `${Math.round(cs * size)}px ${getComputedStyle(document.body).getPropertyValue('--font-brush')}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const yy = y - p * cs * 0.9;
      if (stroke) { ctx.lineWidth = 5; ctx.strokeStyle = '#2a1d13'; ctx.strokeText(text, x, yy); }
      ctx.fillStyle = color;
      ctx.fillText(text, x, yy);
      ctx.globalAlpha = 1;
    } };
  }
  function burst(x, y, color, t0 = now()) {
    const [cx, cy] = cellCenter(x, y);
    return { t0, dur: 380, draw: (p) => {
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r1 = cs * (0.2 + 0.4 * p), r2 = cs * (0.3 + 0.55 * p);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } };
  }
  function stampMark(b) {
    const [cx, cy] = blockCenter(b);
    return { t0: now(), dur: 600, draw: (p) => {
      const s = p < 0.25 ? 2 - 4 * p : 1;
      ctx.globalAlpha = p > 0.7 ? (1 - p) / 0.3 : 1;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.15);
      ctx.scale(s, s);
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 3;
      ctx.strokeRect(-cs * 0.45, -cs * 0.45, cs * 0.9, cs * 0.9);
      ctx.fillStyle = '#c0392b';
      ctx.font = `${Math.round(cs * 0.5)}px ${getComputedStyle(document.body).getPropertyValue('--font-brush')}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('完', 0, 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    } };
  }

  // ── 그리기 ──
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }

  function drawBoard() {
    const W = state.w * cs, H = state.h * cs;
    // 나무 틀
    ctx.fillStyle = '#6b4a2b';
    rr(ox - cs * 0.18, oy - cs * 0.18, W + cs * 0.36, H + cs * 0.36, cs * 0.25);
    ctx.fill();
    ctx.fillStyle = '#f4ead3';
    ctx.fillRect(ox, oy, W, H);
    ctx.strokeStyle = '#e1d2b0';
    ctx.lineWidth = 1;
    for (let x = 1; x < state.w; x++) { ctx.beginPath(); ctx.moveTo(ox + x * cs + 0.5, oy); ctx.lineTo(ox + x * cs + 0.5, oy + H); ctx.stroke(); }
    for (let y = 1; y < state.h; y++) { ctx.beginPath(); ctx.moveTo(ox, oy + y * cs + 0.5); ctx.lineTo(ox + W, oy + y * cs + 0.5); ctx.stroke(); }
  }

  function textColor(color) { return color === 'white' || color === 'yellow' ? '#2a1d13' : '#fff'; }

  // 자음 캐릭터: 고양이 귀가 달린 몸통 + 자음 글꼴
  function drawTile(x, y, size, t, alpha = 1) {
    const g = Jamo.GROUPS[t.color];
    const pad = size * 0.1;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1.5, size * 0.04);
    ctx.strokeStyle = g.dark;
    ctx.fillStyle = g.fill;
    for (const side of [-1, 1]) {
      const ex = x + size / 2 + side * size * 0.22;
      ctx.beginPath();
      ctx.moveTo(ex - size * 0.13, y + pad + size * 0.12);
      ctx.lineTo(ex + side * size * 0.05, y + pad - size * 0.06);
      ctx.lineTo(ex + size * 0.13, y + pad + size * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    rr(x + pad, y + pad + size * 0.04, size - pad * 2, size - pad * 2 - size * 0.04, size * 0.28);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = textColor(t.color);
    ctx.font = `${Math.round(size * 0.48)}px ${getComputedStyle(document.body).getPropertyValue('--font-ui')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.c, x + size / 2, y + size * 0.55);
    if (Jamo.isDouble(t.c)) {
      ctx.font = `${Math.round(size * 0.2)}px sans-serif`;
      ctx.fillText('×2', x + size * 0.76, y + size * 0.8);
    }
    if (Jamo.colorOf(t.c) !== t.color) { // 붓으로 칠한 자음
      ctx.fillText('🖌', x + size * 0.22, y + size * 0.8);
    }
    if (t.ice > 0) {
      ctx.fillStyle = 'rgba(200,230,255,.6)';
      rr(x + pad * 0.5, y + pad * 0.5, size - pad, size - pad, size * 0.2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + size * 0.25, y + size * 0.3);
      ctx.lineTo(x + size * 0.4, y + size * 0.2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawStone(x, y, st) {
    const px = ox + x * cs, py = oy + y * cs, pad = cs * 0.08;
    ctx.fillStyle = '#8a8580';
    ctx.strokeStyle = '#4e4a46';
    ctx.lineWidth = 2;
    rr(px + pad, py + pad, cs - pad * 2, cs - pad * 2, cs * 0.18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#2f2c29';
    ctx.font = `${Math.round(cs * 0.5)}px ${getComputedStyle(document.body).getPropertyValue('--font-brush')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.glyph, px + cs / 2, py + cs / 2 + 2);
    ctx.strokeStyle = '#2f2c29';
    ctx.lineWidth = 1.5;
    const cracks = 3 - st.hp;
    for (let i = 0; i < cracks; i++) {
      ctx.beginPath();
      const sx = px + cs * (0.2 + i * 0.3);
      ctx.moveTo(sx, py + pad);
      ctx.lineTo(sx + cs * 0.1, py + cs * 0.35);
      ctx.lineTo(sx - cs * 0.05, py + cs * 0.55);
      ctx.stroke();
    }
    // 남은 횟수
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(cs * 0.2)}px sans-serif`;
    ctx.fillText(st.hp, px + cs * 0.8, py + cs * 0.8);
  }

  // 모음 블록: 칸들을 이어 붙여 모음 글꼴 모양으로 그린다
  function drawBlock(b, offX = 0, offY = 0, scale = 1) {
    const g = Jamo.GROUPS[b.color];
    const cells = Jamo.VOWELS[b.v].cells.map(([dx, dy]) => [b.x + dx + offX, b.y + dy + offY]);
    const [bcx, bcy] = blockCenter({ ...b, x: b.x + offX, y: b.y + offY });
    ctx.save();
    if (scale !== 1) { ctx.translate(bcx, bcy); ctx.scale(scale, scale); ctx.translate(-bcx, -bcy); }
    const shape = (inset) => {
      ctx.beginPath();
      const set = new Set(cells.map(([x, y]) => x + ',' + y));
      for (const [x, y] of cells) {
        const px = ox + x * cs, py = oy + y * cs;
        if (ctx.roundRect) ctx.roundRect(px + inset, py + inset, cs - inset * 2, cs - inset * 2, cs * 0.16);
        else ctx.rect(px + inset, py + inset, cs - inset * 2, cs - inset * 2);
        if (set.has(x + 1 + ',' + y)) ctx.rect(px + cs / 2, py + inset, cs, cs - inset * 2);
        if (set.has(x + ',' + (y + 1))) ctx.rect(px + inset, py + cs / 2, cs - inset * 2, cs);
      }
    };
    const inset = cs * 0.1;
    ctx.fillStyle = g.dark;
    shape(inset - 2.5);
    ctx.fill('nonzero');
    const grad = ctx.createLinearGradient(0, oy + b.y * cs, 0, oy + (b.y + 3) * cs);
    grad.addColorStop(0, shade(g.fill, 0.18));
    grad.addColorStop(1, g.fill);
    ctx.fillStyle = grad;
    shape(inset);
    ctx.fill('nonzero');
    // 나뭇결
    ctx.save();
    shape(inset);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,.07)';
    ctx.lineWidth = 1;
    for (const [x, y] of cells) {
      const px = ox + x * cs, py = oy + y * cs;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        if (Engine.axis(b) === 'v') { ctx.moveTo(px + cs * i / 4, py); ctx.lineTo(px + cs * i / 4 + 2, py + cs); }
        else { ctx.moveTo(px, py + cs * i / 4); ctx.lineTo(px + cs, py + cs * i / 4 + 2); }
        ctx.stroke();
      }
    }
    ctx.restore();
    if (b.flippable) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      shape(inset + 3);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 위치 규칙: 자음을 받는 쪽 표시
    if (state.dirRule) {
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      const set = new Set(cells.map(([x, y]) => x + ',' + y));
      for (const [x, y] of cells) {
        const px = ox + x * cs, py = oy + y * cs;
        if (Engine.axis(b) === 'v' && !set.has(x - 1 + ',' + y)) {
          ctx.beginPath();
          ctx.moveTo(px + inset + 2, py + cs / 2);
          ctx.lineTo(px + inset + cs * 0.14, py + cs / 2 - cs * 0.1);
          ctx.lineTo(px + inset + cs * 0.14, py + cs / 2 + cs * 0.1);
          ctx.fill();
        }
        if (Engine.axis(b) === 'h' && !set.has(x + ',' + (y - 1))) {
          ctx.beginPath();
          ctx.moveTo(px + cs / 2, py + inset + 2);
          ctx.lineTo(px + cs / 2 - cs * 0.1, py + inset + cs * 0.14);
          ctx.lineTo(px + cs / 2 + cs * 0.1, py + inset + cs * 0.14);
          ctx.fill();
        }
      }
    }
    // 남은 글자 수
    if (b.count > 0) {
      ctx.fillStyle = b.color === 'white' ? '#5b4f3c' : 'rgba(255,255,255,.92)';
      ctx.beginPath();
      ctx.arc(bcx, bcy, cs * 0.27, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = b.color === 'white' ? '#fff' : g.dark;
      ctx.font = `${Math.round(cs * 0.36)}px ${getComputedStyle(document.body).getPropertyValue('--font-ui')}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.count, bcx, bcy + 1);
    }
    ctx.restore();
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.min(255, Math.round(v + (255 - v) * amt));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  function drawPouch(p) {
    const left = p.queue.length - p.idx;
    let cx, cy;
    if (p.side === 'top') [cx, cy] = [ox + (p.at + 0.5) * cs, oy - cs * 0.55];
    if (p.side === 'bottom') [cx, cy] = [ox + (p.at + 0.5) * cs, oy + state.h * cs + cs * 0.55];
    if (p.side === 'left') [cx, cy] = [ox - cs * 0.55, oy + (p.at + 0.5) * cs];
    if (p.side === 'right') [cx, cy] = [ox + state.w * cs + cs * 0.55, oy + (p.at + 0.5) * cs];
    const r = cs * 0.32;
    ctx.fillStyle = left ? '#b5523b' : '#7a6a58';
    ctx.strokeStyle = '#4a321c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(cs * 0.3)}px ${getComputedStyle(document.body).getPropertyValue('--font-ui')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(left ? p.queue[p.idx] : '·', cx, cy + 1);
    if (left) {
      ctx.fillStyle = '#e8b323';
      ctx.beginPath();
      ctx.arc(cx + r * 0.8, cy - r * 0.8, cs * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a1d13';
      ctx.font = `${Math.round(cs * 0.18)}px sans-serif`;
      ctx.fillText(left, cx + r * 0.8, cy - r * 0.8 + 1);
    }
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state) return;
    drawBoard();
    const t = now();
    for (const [k, st] of Object.entries(state.stones)) {
      const [x, y] = k.split(',').map(Number);
      drawStone(x, y, st);
    }
    for (const [k, tile] of Object.entries(state.tiles)) {
      if (hiddenTiles.has(k) && hiddenTiles.get(k) > t) continue;
      const [x, y] = k.split(',').map(Number);
      drawTile(ox + x * cs, oy + y * cs, cs, tile);
    }
    for (const p of state.pouches) drawPouch(p);
    for (const b of state.blocks) {
      if (drag && drag.b === b) continue;
      drawBlock(b);
    }
    if (drag) {
      const h = Engine.axis(drag.b) === 'h';
      ctx.shadowColor = 'rgba(0,0,0,.35)';
      ctx.shadowBlur = 10;
      drawBlock(drag.b, h ? drag.off : 0, h ? 0 : drag.off);
      ctx.shadowBlur = 0;
    }
    // 아이템 사용 중 안내 테두리
    if (game && game.itemMode) {
      ctx.strokeStyle = '#e8b323';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(ox - 3, oy - 3, state.w * cs + 6, state.h * cs + 6);
      ctx.setLineDash([]);
    }
    anims = anims.filter((a) => {
      const el = t - a.t0;
      if (el < 0) return true;
      const p = Math.min(1, el / a.dur);
      a.draw(p, el);
      return p < 1;
    });
  }

  // ── 메인 루프 (타이머) ──
  let lastSec = -1;
  function loop() {
    const t = now();
    if (game && !game.over) {
      const dt = t - game.last;
      const frozen = game.frozenUntil > t;
      const paused = document.hidden || !$('overlay').classList.contains('hidden');
      if (!frozen && !paused) game.timeLeft = Math.max(0, game.timeLeft - dt);
      const ratio = game.timeLeft / (level.time * 1000);
      const fill = $('timerFill');
      fill.style.width = (ratio * 100).toFixed(1) + '%';
      fill.classList.toggle('low', ratio < 0.25 && !frozen);
      fill.classList.toggle('frozen', frozen);
      const sec = Math.ceil(game.timeLeft / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        $('timerText').textContent = frozen ? `📜 ${sec}초 (멈춤 ${Math.ceil((game.frozenUntil - t) / 1000)})` : `${sec}초`;
      }
      if (frozen) $('timerText').textContent = `📜 ${sec}초 (멈춤 ${Math.ceil((game.frozenUntil - t) / 1000)})`;
      if (game.timeLeft <= 0) lose('시간이 다 됐어요');
    }
    if (game) game.last = t;
    render();
    requestAnimationFrame(loop);
  }

  // 시작
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {});
  showMenu();
  requestAnimationFrame(loop);

  // 디버그/테스트용
  window.__jamo = { get state() { return state; }, startLevel, get game() { return game; } };
})();
