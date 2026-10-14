// 백성을 구해라 — 화면, 입력, 음성, 애니메이션, 진행 저장.
// 플레이어는 문종. 자음·모음 모양 지붕을 끌어 같은 모양 자리에 덮으면 비 맞던 백성이 구조된다.
(function () {
  const { Jamo, Engine, LEVELS } = window;
  const $ = (id) => document.getElementById(id);
  const WORLD_NAMES = { 1: '첫 비', 2: '장마', 3: '큰비' };

  // ── 진행 저장 (브라우저 저장소가 막혀 있어도 동작) ──
  const SAVE_KEY = 'baekseong.v1';
  let progress = { stars: {} };
  try { progress = Object.assign(progress, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) { /* 무시 */ }
  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); } catch (e) { /* 무시 */ } };

  let muted = false;

  // ── 음성 (브라우저 내장 한국어 음성) ──
  const tts = window.speechSynthesis;
  let koVoice = null;
  function pickVoice() {
    if (!tts) return;
    const vs = tts.getVoices();
    koVoice = vs.find((v) => /^ko/i.test(v.lang) && /google|yuna|sun-?hi|heami|female/i.test(v.name)) ||
      vs.find((v) => /^ko/i.test(v.lang)) || null;
  }
  if (tts) { pickVoice(); if (tts.addEventListener) tts.addEventListener('voiceschanged', pickVoice); }
  // interrupt: 하던 말을 끊고 바로 말한다 (블록을 잡을 때처럼 즉각 반응이 필요할 때)
  function say(text, { interrupt = false, rate = 0.9 } = {}) {
    if (muted || !tts || !text) return;
    try {
      if (interrupt) tts.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      if (koVoice) u.voice = koVoice;
      u.rate = rate;
      u.pitch = 1.1;
      tts.speak(u);
    } catch (e) { /* 음성 없이 진행 */ }
  }

  // ── 효과음 (WebAudio 합성) ──
  let audio = null;
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
    step: () => tone(200, 0.05, 'sine', 0.04),
    thud: () => { tone(90, 0.3, 'square', 0.08, -40); tone(140, 0.2, 'sine', 0.15, -60); },
    joy: () => { tone(523, 0.15, 'triangle', 0.12); setTimeout(() => tone(659, 0.15, 'triangle', 0.12), 110); setTimeout(() => tone(784, 0.3, 'triangle', 0.12), 220); },
    bump: () => tone(120, 0.1, 'sine', 0.08),
  };

  // ── 상태 ──
  let level = null, state = null, game = null;
  const canvas = $('board'), ctx = canvas.getContext('2d');
  let cs = 48, ox = 0, oy = 0, dpr = 1;
  let anims = [];
  let drag = null;
  let rain = [];
  const now = () => performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const font = (role) => getComputedStyle(document.body).getPropertyValue(role === 'brush' ? '--font-brush' : '--font-ui');

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
        const shapes = [...new Set(l.blocks.map((x) => x.v))].join('');
        b.innerHTML = isUnlocked(l) ? `<span style="font-family:var(--font-brush)">${shapes}</span><span class="st">${'★'.repeat(st)}</span>` : '🔒';
        b.title = `${l.id}. ${l.name}`;
        b.setAttribute('aria-label', `${l.id}단계 ${l.name}`);
        b.disabled = !isUnlocked(l);
        b.onclick = () => startLevel(l.id);
        grid.appendChild(b);
      }
      wrap.appendChild(el);
    }
  }
  function isUnlocked(l) {
    const i = LEVELS.indexOf(l);
    return i === 0 || progress.stars[LEVELS[i - 1].id] > 0;
  }
  function showMenu() {
    game = null;
    if (tts) tts.cancel();
    $('game').classList.add('hidden');
    $('overlay').classList.add('hidden');
    $('menu').classList.remove('hidden');
    buildMenu();
  }

  // ── 단계 시작 ──
  function startLevel(id) {
    level = LEVELS.find((l) => l.id === id);
    state = Engine.load(level);
    anims = [];
    drag = null;
    game = { over: false, history: [], hint: null, hints: 0, stuckSaid: false };
    $('menu').classList.add('hidden');
    $('overlay').classList.add('hidden');
    $('game').classList.remove('hidden');
    $('worldName').textContent = `${level.world}. ${WORLD_NAMES[level.world]} · ${level.id}단계`;
    $('levelName').textContent = level.name;
    $('bubble').textContent = level.say;
    layout();
    makeRain();
    updateHud();
    say(level.say, { interrupt: true });
  }

  // ── 레이아웃 ──
  function layout() {
    if (!state) return;
    const wrap = $('boardWrap');
    const maxW = Math.min(wrap.clientWidth || 360, 460);
    const maxH = Math.max(300, window.innerHeight - 300);
    const m = 0.5;
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
  window.addEventListener('resize', () => { layout(); makeRain(); });

  function makeRain() {
    if (!state) return;
    rain = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random(), v: 0.5 + Math.random() * 0.5 }));
  }

  // ── 위쪽 표시: 구한 백성 수 ──
  function updateHud() {
    const icons = [];
    for (const t of state.targets) for (let i = 0; i < t.people.length; i++) icons.push(t.saved ? '🙂' : '<span class="wet">🙂</span>');
    $('savedIcons').innerHTML = icons.join('');
    $('undoBtn').disabled = !game.history.length || game.over;
    $('hintBtn').disabled = game.over;
  }

  let toastTimer = 0;
  function toast(text, info) {
    const t = $('toast');
    t.textContent = text;
    t.classList.toggle('info', !!info);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), info ? 2400 : 1600);
  }

  function speakLine(text) {
    $('bubble').textContent = text;
    say(text);
  }

  // ── 도우미: 되돌리기, 힌트, 다시 듣기 ──
  function undo() {
    if (!game || game.over || !game.history.length || Engine.isWon(state)) return;
    state = game.history.pop();
    anims = [];
    game.hint = null;
    game.stuckSaid = false;
    sfx.step();
    updateHud();
  }

  function hint() {
    if (!game || game.over || Engine.isWon(state)) return;
    const sol = Engine.solve(Engine.clone(state), { maxStates: 30000 });
    if (!sol.ok || !sol.path.length) {
      speakLine('전하, 길이 막혔사옵니다. 되돌리기를 눌러 주시옵소서.');
      return;
    }
    const m = sol.path[0];
    const b = state.blocks.find((x) => x.id === m.id);
    game.hints++;
    game.hint = { id: m.id, x: m.x, y: m.y, t0: now() };
    const fits = Engine.matchingTarget(state, b, m.x, m.y);
    speakLine(`${Jamo.withObject(Jamo.NAMES[b.v])} ${fits ? '반짝이는 자리에 덮어' : '반짝이는 곳으로 비켜'} 주시옵소서.`);
  }

  $('undoBtn').onclick = undo;
  $('hintBtn').onclick = hint;
  $('tipBtn').onclick = () => level && say($('bubble').textContent, { interrupt: true });
  $('court').onclick = () => level && say($('bubble').textContent, { interrupt: true });

  // ── 판정 ──
  function afterMove(events) {
    for (const ev of events) {
      if (ev.type !== 'save') continue;
      const n = ev.target.people.length;
      sfx.thud();
      setTimeout(sfx.joy, 250);
      anims.push(roofDrop(ev.block));
      for (const [x, y] of ev.target.people) anims.push(cheer(x, y));
      speakLine(`${Jamo.NAMES[ev.block.v]}! 백성 ${Jamo.NUM[n] || n} 명을 구했사옵니다!`);
    }
    updateHud();
    if (Engine.isWon(state)) return setTimeout(win, 1100);
    if (!game.stuckSaid && !Engine.solve(Engine.clone(state), { maxStates: 30000 }).ok) {
      game.stuckSaid = true;
      setTimeout(() => {
        toast('길이 막혔어요! ↩ 되돌리기', true);
        speakLine('전하, 길이 막혔사옵니다. 되돌리기를 눌러 주시옵소서.');
      }, 1200);
    }
  }

  function win() {
    if (!game || game.over) return;
    game.over = true;
    const goals = [
      ['백성을 모두 구했어요', true],
      [`${level.par + 2}번 안에 했어요`, state.moves <= level.par + 2],
      ['힌트 없이 했어요', game.hints === 0],
    ];
    const stars = goals.filter((g) => g[1]).length;
    progress.stars[level.id] = Math.max(progress.stars[level.id] || 0, stars);
    save();
    updateHud();
    sfx.joy();
    say('전하, 모든 백성을 구했사옵니다! 성은이 망극하옵니다!');
    const total = state.people.length;
    $('resultTitle').textContent = '성은이 망극하옵니다!';
    $('resultStars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('');
    $('resultBody').innerHTML = `
      <p class="big-word">${'🙂'.repeat(total)}</p>
      <p>백성 ${total}명을 구했어요</p>
      <ul class="goals">${goals.map(([t, ok]) => `<li class="${ok ? 'ok' : ''}">${ok ? '★' : '☆'} ${t}</li>`).join('')}</ul>`;
    const next = LEVELS[LEVELS.indexOf(level) + 1];
    $('resultNext').textContent = next ? '다음 단계' : '처음 화면';
    $('resultNext').onclick = () => (next ? startLevel(next.id) : showMenu());
    $('resultRetry').onclick = () => startLevel(level.id);
    $('overlay').classList.remove('hidden');
  }

  // ── 입력: 블록을 끌면 바위를 피해 한 칸씩 손가락을 따라온다 ──
  function cellFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    return { px, py, x: Math.floor((px - ox) / cs), y: Math.floor((py - oy) / cs) };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!game || game.over) return;
    const p = cellFromEvent(e);
    const b = Engine.blockAt(state, p.x, p.y);
    if (b && !b.locked) {
      canvas.setPointerCapture(e.pointerId);
      // 블록을 잡는 순간 한 번 이름을 읽는다
      say(Jamo.NAMES[b.v], { interrupt: true });
      drag = { b, sx: p.px, sy: p.py, x0: b.x, y0: b.y, cx: b.x, cy: b.y, vx: b.x, vy: b.y };
      return;
    }
    // 지붕이나 빈 자리를 누르면 무슨 글자 자리인지 알려 준다
    const t = (b && state.targets.find((tt) => tt.saved && tt.x === b.x && tt.y === b.y && tt.v === b.v)) || Engine.targetAt(state, p.x, p.y);
    if (t) {
      say(t.saved ? `${Jamo.NAMES[t.v]} 지붕 아래 백성이 있어요` : `${Jamo.NAMES[t.v]} 자리예요`, { interrupt: true });
      anims.push(pulseTarget(t));
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = cellFromEvent(e);
    const tx = drag.x0 + Math.round((p.px - drag.sx) / cs);
    const ty = drag.y0 + Math.round((p.py - drag.sy) / cs);
    const b = drag.b;
    for (let i = 0; i < 30 && (drag.cx !== tx || drag.cy !== ty); i++) {
      const dx = Math.sign(tx - drag.cx), dy = Math.sign(ty - drag.cy);
      const tryX = () => dx && Engine.canPlace(state, b, drag.cx + dx, drag.cy) && ((drag.cx += dx), true);
      const tryY = () => dy && Engine.canPlace(state, b, drag.cx, drag.cy + dy) && ((drag.cy += dy), true);
      const ok = Math.abs(tx - drag.cx) >= Math.abs(ty - drag.cy) ? tryX() || tryY() : tryY() || tryX();
      if (!ok) break;
      sfx.step();
    }
  });

  function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    let { cx, cy } = d;
    // 자석: 같은 모양 자리 한 칸 근처에 놓으면 쏙 들어간다
    const reach = Engine.reach(state, d.b);
    for (const t of state.targets) {
      if (t.saved || t.v !== d.b.v) continue;
      if (Math.abs(t.x - cx) + Math.abs(t.y - cy) <= 1 && reach.has(t.x + ',' + t.y)) { cx = t.x; cy = t.y; }
    }
    if (cx === d.x0 && cy === d.y0) return;
    game.history.push(Engine.clone(state));
    game.hint = null;
    const evs = Engine.place(state, d.b, cx, cy);
    anims.push(slideFrom(d.b, d.vx, d.vy));
    afterMove(evs);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  $('backBtn').onclick = showMenu;
  $('restartBtn').onclick = () => level && startLevel(level.id);
  $('soundBtn').onclick = () => {
    muted = !muted;
    if (muted && tts) tts.cancel();
    $('soundBtn').textContent = muted ? '🔇' : '🔊';
  };

  // ── 애니메이션 ──
  const slideState = new Map(); // 블록 id → 놓은 뒤 미끄러져 들어가는 보간 시작점
  function slideFrom(b, vx, vy) {
    slideState.set(b.id, { vx, vy, t0: now() });
    return { t0: now(), dur: 160, draw: () => {} };
  }
  function roofDrop(b) {
    return { t0: now(), dur: 500, draw: (p) => {
      // 지붕이 내려앉을 때 퍼지는 빗물
      const cells = Engine.cells(b.v, b.x, b.y);
      ctx.strokeStyle = `rgba(160,200,230,${1 - p})`;
      ctx.lineWidth = 2;
      for (const [x, y] of cells) {
        ctx.beginPath();
        ctx.arc(ox + (x + 0.5) * cs, oy + (y + 0.5) * cs, cs * (0.3 + p * 0.5), 0, Math.PI * 2);
        ctx.stroke();
      }
    } };
  }
  function cheer(x, y) {
    return { t0: now() + 200, dur: 1100, draw: (p) => {
      const cx = ox + (x + 0.5) * cs, cy = oy + (y + 0.5) * cs - ease(p) * cs * 0.9;
      ctx.globalAlpha = 1 - p * p;
      ctx.font = `${Math.round(cs * 0.45)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💛', cx, cy);
      ctx.globalAlpha = 1;
    } };
  }
  function pulseTarget(t) {
    return { t0: now(), dur: 600, draw: (p) => {
      ctx.globalAlpha = 0.5 * (1 - p);
      drawShape(Engine.cells(t.v, t.x, t.y), { fill: '#fff6b0', inset: cs * 0.05 });
      ctx.globalAlpha = 1;
    } };
  }

  // ── 그리기 ──
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }

  // 칸들을 이어 붙여 글자 모양 하나로 그린다
  function shapePath(cells, inset) {
    const set = new Set(cells.map(([x, y]) => x + ',' + y));
    ctx.beginPath();
    for (const [x, y] of cells) {
      const px = ox + x * cs, py = oy + y * cs;
      if (ctx.roundRect) ctx.roundRect(px + inset, py + inset, cs - inset * 2, cs - inset * 2, cs * 0.16);
      else ctx.rect(px + inset, py + inset, cs - inset * 2, cs - inset * 2);
      if (set.has(x + 1 + ',' + y)) ctx.rect(px + cs / 2, py + inset, cs, cs - inset * 2);
      if (set.has(x + ',' + (y + 1))) ctx.rect(px + inset, py + cs / 2, cs - inset * 2, cs);
    }
  }
  function drawShape(cells, { fill, inset = cs * 0.08 }) {
    ctx.fillStyle = fill;
    shapePath(cells, inset);
    ctx.fill('nonzero');
  }

  function drawBoard() {
    const W = state.w * cs, H = state.h * cs;
    ctx.fillStyle = '#6b4a2b';
    rr(ox - cs * 0.15, oy - cs * 0.15, W + cs * 0.3, H + cs * 0.3, cs * 0.2);
    ctx.fill();
    ctx.fillStyle = '#e6d6b0';
    ctx.fillRect(ox, oy, W, H);
    ctx.strokeStyle = 'rgba(120,95,60,.18)';
    ctx.lineWidth = 1;
    for (let x = 1; x < state.w; x++) { ctx.beginPath(); ctx.moveTo(ox + x * cs + 0.5, oy); ctx.lineTo(ox + x * cs + 0.5, oy + H); ctx.stroke(); }
    for (let y = 1; y < state.h; y++) { ctx.beginPath(); ctx.moveTo(ox, oy + y * cs + 0.5); ctx.lineTo(ox + W, oy + y * cs + 0.5); ctx.stroke(); }
    for (const [k, kind] of Object.entries(state.walls)) {
      const [x, y] = k.split(',').map(Number);
      const px = ox + x * cs, py = oy + y * cs;
      if (kind === 'water') {
        ctx.fillStyle = '#5d8fb8';
        ctx.fillRect(px, py, cs, cs);
        ctx.strokeStyle = 'rgba(255,255,255,.5)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          const wy = py + cs * (0.35 + i * 0.3);
          ctx.moveTo(px + cs * 0.15, wy);
          ctx.quadraticCurveTo(px + cs * 0.32, wy - cs * 0.1, px + cs * 0.5, wy);
          ctx.quadraticCurveTo(px + cs * 0.68, wy + cs * 0.1, px + cs * 0.85, wy);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = '#8c857c';
        ctx.strokeStyle = '#57514a';
        ctx.lineWidth = 2;
        rr(px + cs * 0.07, py + cs * 0.12, cs * 0.86, cs * 0.8, cs * 0.3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.25)';
        rr(px + cs * 0.22, py + cs * 0.24, cs * 0.3, cs * 0.14, cs * 0.07);
        ctx.fill();
      }
    }
  }

  // 아직 비어 있는 글자 자리: 같은 색 점선
  function drawTarget(t) {
    const g = Jamo.PALETTE[t.color];
    const cells = Engine.cells(t.v, t.x, t.y);
    ctx.globalAlpha = 0.18;
    drawShape(cells, { fill: g.fill });
    ctx.globalAlpha = 1;
    ctx.setLineDash([cs * 0.14, cs * 0.1]);
    ctx.strokeStyle = g.fill;
    ctx.lineWidth = Math.max(2, cs * 0.05);
    shapePath(cells, cs * 0.08);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 백성: 상투 튼 머리에 흰 옷. 비 맞을 땐 울상, 구하면 웃는 얼굴
  function drawPerson(x, y, happy, scale = 1) {
    const cx = ox + (x + 0.5) * cs, cy = oy + (y + 0.55) * cs, s = cs * scale;
    if (scale === 1) {
      ctx.fillStyle = '#f7f3ea';
      ctx.strokeStyle = '#9c8f74';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.26, cy + s * 0.4);
      ctx.lineTo(cx - s * 0.16, cy + s * 0.08);
      ctx.lineTo(cx + s * 0.16, cy + s * 0.08);
      ctx.lineTo(cx + s * 0.26, cy + s * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    const hy = cy - s * 0.08, hr = s * 0.2;
    ctx.fillStyle = '#2a2420';
    ctx.beginPath();
    ctx.arc(cx, hy - hr * 1.05, hr * 0.38, 0, Math.PI * 2); // 상투
    ctx.fill();
    ctx.fillStyle = '#f4d3b0';
    ctx.beginPath();
    ctx.arc(cx, hy, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a2420';
    ctx.beginPath();
    ctx.arc(cx, hy, hr, Math.PI * 1.08, Math.PI * 1.92);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - hr * 0.4, hy + hr * 0.1, hr * 0.11, 0, Math.PI * 2);
    ctx.arc(cx + hr * 0.4, hy + hr * 0.1, hr * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a1d13';
    ctx.lineWidth = Math.max(1.2, s * 0.025);
    ctx.beginPath();
    if (happy) ctx.arc(cx, hy + hr * 0.3, hr * 0.35, 0.15 * Math.PI, 0.85 * Math.PI);
    else ctx.arc(cx, hy + hr * 0.75, hr * 0.3, 1.2 * Math.PI, 1.8 * Math.PI);
    ctx.stroke();
    if (happy) {
      ctx.fillStyle = 'rgba(230,110,100,.45)';
      ctx.beginPath();
      ctx.arc(cx - hr * 0.62, hy + hr * 0.4, hr * 0.16, 0, Math.PI * 2);
      ctx.arc(cx + hr * 0.62, hy + hr * 0.4, hr * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#7fb3dc'; // 빗물 눈물
      ctx.beginPath();
      ctx.arc(cx + hr * 0.75, hy - hr * 0.2, hr * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 글자 지붕: 단청 색 위에 기와 무늬
  function drawBlock(b, px = b.x, py = b.y, lifted = false) {
    const g = Jamo.PALETTE[b.color];
    const cells = Jamo.SHAPES[b.v].map(([dx, dy]) => [px + dx, py + dy]);
    const inset = cs * 0.06;
    if (lifted) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4; }
    drawShape(cells, { fill: g.dark, inset: inset - 2.5 });
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    drawShape(cells, { fill: g.fill, inset });
    ctx.save();
    shapePath(cells, inset);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,.18)';
    ctx.lineWidth = 1.5;
    for (const [x, y] of cells) {
      const cx0 = ox + x * cs, cy0 = oy + y * cs;
      for (let row = 0; row < 3; row++) {
        const yy = cy0 + cs * (0.3 + row * 0.3);
        for (let col = 0; col < 3; col++) {
          ctx.beginPath();
          ctx.arc(cx0 + cs * (col + 0.5) / 3, yy - cs * 0.08, cs / 6, 0.15 * Math.PI, 0.85 * Math.PI);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    if (b.locked) {
      ctx.strokeStyle = '#f3d27a';
      ctx.lineWidth = 2;
      shapePath(cells, inset + 2);
      ctx.stroke();
    }
  }

  function drawRain(t) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, state.w * cs, state.h * cs);
    ctx.clip();
    ctx.strokeStyle = 'rgba(90,130,170,.45)';
    ctx.lineWidth = 1.5;
    const W = state.w * cs, H = state.h * cs;
    const left = state.targets.some((tt) => !tt.saved);
    for (const d of rain) {
      const y = ((d.y + (t / 1000) * d.v * (left ? 0.9 : 0.25)) % 1) * (H + 40) - 20;
      const x = ((d.x + y / H * 0.08) % 1) * W;
      ctx.beginPath();
      ctx.moveTo(ox + x, oy + y);
      ctx.lineTo(ox + x - 3, oy + y + cs * 0.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 힌트: 움직일 지붕을 반짝이고, 갈 곳에 그림자를 보여 준다
  function drawHint(t) {
    const h = game && game.hint;
    if (!h) return;
    const b = state.blocks.find((x) => x.id === h.id);
    if (!b || b.locked) return;
    const pulse = 0.5 + 0.5 * Math.sin((t - h.t0) / 160);
    ctx.globalAlpha = 0.3 + 0.4 * pulse;
    drawShape(Engine.cells(b.v, b.x, b.y), { fill: '#fff6b0', inset: cs * 0.04 });
    drawShape(Engine.cells(b.v, h.x, h.y), { fill: '#fff6b0', inset: cs * 0.04 });
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state) return;
    const t = now();
    drawBoard();
    for (const tg of state.targets) if (!tg.saved) drawTarget(tg);
    for (const tg of state.targets) if (!tg.saved) for (const [x, y] of tg.people) drawPerson(x, y, false);
    drawHint(t);
    for (const b of state.blocks) {
      if (drag && drag.b === b) continue;
      let px = b.x, py = b.y;
      const sl = slideState.get(b.id);
      if (sl) {
        const p = Math.min(1, (t - sl.t0) / 160);
        px = sl.vx + (b.x - sl.vx) * ease(p);
        py = sl.vy + (b.y - sl.vy) * ease(p);
        if (p >= 1) slideState.delete(b.id);
      }
      drawBlock(b, px, py);
    }
    // 지붕 아래 구한 백성이 웃으며 내다본다
    for (const tg of state.targets) if (tg.saved) for (const [x, y] of tg.people) drawPerson(x, y, true, 0.7);
    drawRain(t);
    if (drag) {
      drag.vx += (drag.cx - drag.vx) * 0.4;
      drag.vy += (drag.cy - drag.vy) * 0.4;
      drawBlock(drag.b, drag.vx, drag.vy, true);
    }
    anims = anims.filter((a) => {
      const el = t - a.t0;
      if (el < 0) return true;
      const p = Math.min(1, el / a.dur);
      a.draw(p, el);
      return p < 1;
    });
  }

  function loop() {
    render();
    requestAnimationFrame(loop);
  }

  showMenu();
  requestAnimationFrame(loop);

  // 테스트용
  window.__game = { get state() { return state; }, startLevel, get game() { return game; } };
})();
