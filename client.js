'use strict';
(() => {
  const { CH, icon, drawChamp, portrait } = window.ART;
  const ARENA = { w: 2800, h: 1800 };
  const VISION = 1150, HAWK_V = 950;
  const INTERP = 0.085;        // 보간 지연(초)
  const COL = { ally: '#5bd394', enemy: '#ee5d5d', brass: '#d6b25e' };
  const $ = s => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 */ } },
  };

  const socket = io({ transports: ['websocket', 'polling'] });
  let room = null, mySlot = 0, inGame = false, endedNormally = false;

  // ───────────────────────── 공용 UI
  function show(id) { for (const s of ['title', 'lobby', 'game']) $('#' + s).hidden = s !== id; }
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }
  const myName = () => {
    const n = $('#nameInput').value.trim();
    store.set('duel.name', n);
    return n;
  };

  // ───────────────────────── 첫 화면
  $('#nameInput').value = store.get('duel.name') || '';
  const urlCode = new URLSearchParams(location.search).get('room');
  if (urlCode) $('#codeInput').value = urlCode.toUpperCase().slice(0, 4);

  for (const k of ['wind', 'soul', 'frost']) {
    const f = document.createElement('figure');
    const c = document.createElement('canvas');
    c.width = c.height = 192;
    portrait(c, k);
    const cap = document.createElement('figcaption');
    cap.textContent = CH[k].name;
    f.append(c, cap);
    $('#titleRoster').append(f);
  }

  $('#btnCreate').onclick = () => { $('#menuErr').textContent = ''; socket.emit('create', { name: myName() }); };
  $('#btnPractice').onclick = () => { $('#menuErr').textContent = ''; socket.emit('practice', { name: myName() }); };
  const doJoin = () => {
    const code = $('#codeInput').value.trim().toUpperCase();
    if (code.length !== 4) { $('#menuErr').textContent = '방 코드는 4글자예요.'; return; }
    $('#menuErr').textContent = '';
    socket.emit('join', { code, name: myName() });
  };
  $('#btnJoin').onclick = doJoin;
  $('#codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doJoin(); } });
  $('#menuForm').addEventListener('submit', e => e.preventDefault());

  socket.on('err', m => { $('#menuErr').textContent = m; });
  socket.on('notice', m => toast(m));
  socket.on('disconnect', () => {
    if (room) toast('서버와 연결이 끊겼어요. 다시 접속하는 중…');
    room = null; inGame = false;
    $('#result').hidden = true;
    show('title');
  });

  // ───────────────────────── 대기실
  const champCards = {};
  function buildChampGrid() {
    const grid = $('#champGrid');
    for (const k of ['wind', 'soul', 'frost']) {
      const d = CH[k];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'champ';
      b.style.setProperty('--c', d.color);
      const statHtml = Object.entries(d.stats).map(([n, v]) => `<div class="stat">${n}<i style="--v:${Math.round(v * 100)}%;--c:${d.color}"></i></div>`).join('');
      const kit = ['P', 'Q', 'W', 'E', 'R'].map(s => `<li><b>${s === 'P' ? '◆' : s}</b><span><em>${d.skills[s].n}</em> ${d.skills[s].d}</span></li>`).join('');
      b.innerHTML = `<div class="top"><canvas width="144" height="144"></canvas><div><h3>${d.name}</h3><div class="role">${d.role}</div></div></div><div class="stats">${statHtml}</div><ul class="kit">${kit}</ul>`;
      portrait(b.querySelector('canvas'), k);
      b.onclick = () => socket.emit('pick', { champ: k });
      grid.append(b);
      champCards[k] = b;

      const bb = document.createElement('button');
      bb.type = 'button';
      bb.className = 'btn small';
      bb.dataset.k = k;
      bb.textContent = d.name;
      bb.onclick = () => socket.emit('pick', { champ: k, bot: true });
      $('#botRow').append(bb);
    }
  }
  buildChampGrid();

  function seatHtml(p, label) {
    if (!p) return `<div class="seat empty">상대를 기다리는 중…</div>`;
    return `<div class="seat"><canvas width="112" height="112" data-k="${p.champ}"></canvas>
      <div class="who"><strong></strong><span>${label} · ${CH[p.champ].name}</span></div>
      <span class="state ${p.ready ? 'ready' : ''}">${p.ready ? '준비 완료' : '고르는 중'}</span></div>`;
  }

  function renderLobby() {
    const r = room;
    $('#roomCode').textContent = r.practice ? '연습' : r.code;
    $('#btnCopy').hidden = r.practice;
    $('#copyNote').textContent = r.practice ? '연습 상대를 정하고 준비를 누르면 바로 시작합니다.' : '친구에게 코드를 알려주거나 초대 링크를 보내세요.';
    $('#lobbyKind').textContent = r.practice ? '연습장' : '대기실';
    const me = r.players.find(p => p && p.you);
    const other = r.players.find(p => p && !p.you);
    const seats = $('#seats');
    seats.innerHTML = seatHtml(me, '나') + seatHtml(other, other && other.bot ? '연습 상대' : '상대');
    seats.querySelectorAll('.seat').forEach((el, i) => {
      const p = i === 0 ? me : other;
      if (!p) return;
      el.querySelector('strong').textContent = p.name;
      portrait(el.querySelector('canvas'), p.champ, i === 0 ? COL.ally : COL.enemy);
    });
    for (const k in champCards) champCards[k].classList.toggle('sel', me && me.champ === k);
    $('#botPick').hidden = !r.practice;
    if (r.practice && other) $('#botRow').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === other.champ));
    const rb = $('#btnReady');
    rb.textContent = me && me.ready ? '준비 취소' : '준비 완료';
    rb.classList.toggle('primary', !(me && me.ready));
    $('#readyNote').textContent = r.practice ? '준비를 누르면 바로 연습이 시작됩니다.'
      : !other ? '상대가 들어오면 둘 다 준비해야 시작합니다.'
      : other.ready ? '상대는 준비됐어요.' : '두 사람 모두 준비하면 바로 시작합니다.';
  }

  socket.on('room', r => {
    room = r;
    if (inGame && r.state === 'lobby') {
      inGame = false;
      if (!endedNormally) toast('결투가 중단됐어요.');
    }
    if (!inGame) {
      show('lobby');
      const u = new URL(location.href);
      if (!r.practice) { u.searchParams.set('room', r.code); history.replaceState(null, '', u); }
      else { u.searchParams.delete('room'); history.replaceState(null, '', u); }
    }
    renderLobby();
  });

  $('#btnReady').onclick = () => {
    const me = room && room.players.find(p => p && p.you);
    socket.emit('ready', { ready: !(me && me.ready) });
  };
  $('#btnLeave').onclick = () => {
    socket.emit('leave');
    room = null;
    const u = new URL(location.href); u.searchParams.delete('room'); history.replaceState(null, '', u);
    show('title');
  };
  $('#btnCopy').onclick = () => {
    const link = `${location.origin}/?room=${room.code}`;
    const done = () => { $('#copyNote').textContent = '초대 링크를 복사했어요.'; };
    const fail = () => { $('#copyNote').textContent = `이 주소를 보내세요: ${link}`; };
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, fail); else fail();
  };

  // ───────────────────────── 게임 상태
  let snaps = [], offset = null, fxQueue = [], fxs = [], lastSnap = null;
  let names = ['', ''];
  const swingAt = [-9, -9];
  const marker = { x: 0, y: 0, t: -9, atk: false };
  let paused = false;

  socket.on('start', s => {
    mySlot = s.slot;
    names = s.players.map(p => p.name);
    inGame = true;
    endedNormally = false;
    paused = false;
    snaps = []; offset = null; fxQueue = []; fxs = []; lastSnap = null;
    $('#pause').hidden = true;
    $('#result').hidden = true;
    show('game');
    buildSlots(s.players[mySlot].champ);
    portrait($('#portrait'), s.players[mySlot].champ, COL.ally);
    $('#sbNameA').textContent = names[mySlot];
    $('#sbNameB').textContent = names[1 - mySlot];
    resize();
    cam.x = mySlot === 0 ? ARENA.w / 2 - 700 : ARENA.w / 2 + 700;
    cam.y = ARENA.h / 2;
  });

  socket.on('snap', s => {
    const now = performance.now() / 1000;
    const off = s.t - now;
    if (offset === null || Math.abs(off - offset) > 0.4) offset = off;
    else offset += (off - offset) * 0.06;
    snaps.push(s);
    if (snaps.length > 40) snaps.shift();
    for (const f of s.fx) { f._t = s.t; fxQueue.push(f); }
    lastSnap = s;
  });

  socket.on('end', e => {
    endedNormally = true;
    const win = e.winner === e.you;
    const h = $('#resTitle');
    h.textContent = win ? '승리' : '패배';
    h.className = win ? 'win' : 'lose';
    $('#resScore').textContent = `${e.score[e.you]} : ${e.score[1 - e.you]}`;
    $('#result').hidden = false;
  });
  $('#btnAgain').onclick = () => { $('#result').hidden = true; };

  // ───────────────────────── 캔버스
  const cv = $('#view');
  const ctx = cv.getContext('2d');
  const fogC = document.createElement('canvas');
  const fctx = fogC.getContext('2d');
  let W = 0, H = 0, DPR = 1, scale = 1;
  const cam = { x: ARENA.w / 2, y: ARENA.h / 2 };
  const mouse = { x: 0, y: 0 };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    fogC.width = Math.round(W / 2); fogC.height = Math.round(H / 2);
    scale = Math.min(W / 1750, H / 1000);
  }
  window.addEventListener('resize', () => { if (inGame) resize(); });

  // 바닥 미리 그리기
  const ground = (() => {
    const k = 0.5;
    const c = document.createElement('canvas');
    c.width = ARENA.w * k; c.height = ARENA.h * k;
    const g = c.getContext('2d');
    g.scale(k, k);
    const bg = g.createRadialGradient(ARENA.w / 2, ARENA.h / 2, 100, ARENA.w / 2, ARENA.h / 2, ARENA.w * 0.65);
    bg.addColorStop(0, '#1d2a2c');
    bg.addColorStop(1, '#0f1619');
    g.fillStyle = bg;
    g.fillRect(0, 0, ARENA.w, ARENA.h);
    // 육각 바닥돌
    const s = 64, hh = s * Math.sqrt(3) / 2;
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let row = -1; row * hh < ARENA.h + hh; row++) {
      for (let col = -1; col * s * 1.5 < ARENA.w + s; col++) {
        const cx = col * s * 1.5, cy = row * hh * 2 + (col % 2 ? hh : 0);
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 3 * i;
          g.lineTo(cx + Math.cos(a) * (s - 3), cy + Math.sin(a) * (s - 3));
        }
        g.closePath();
        const v = rnd();
        g.fillStyle = v < 0.15 ? 'rgba(0,0,0,0.16)' : v > 0.92 ? 'rgba(120,170,160,0.05)' : 'rgba(255,255,255,0.012)';
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.lineWidth = 3;
        g.stroke();
      }
    }
    // 중앙 결투 원
    const cx = ARENA.w / 2, cy = ARENA.h / 2;
    g.strokeStyle = 'rgba(214,178,94,0.22)';
    g.lineWidth = 6;
    g.beginPath(); g.arc(cx, cy, 430, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, 400, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, 140, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * Math.PI * 2, l = i % 3 === 0 ? 30 : 14;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 400, cy + Math.sin(a) * 400);
      g.lineTo(cx + Math.cos(a) * (400 - l), cy + Math.sin(a) * (400 - l));
      g.stroke();
    }
    // 출발 발판
    for (const [x, col] of [[cx - 700, 'rgba(91,211,148,0.10)'], [cx + 700, 'rgba(238,93,93,0.10)']]) {
      g.fillStyle = col;
      g.beginPath(); g.arc(x, cy, 120, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(214,178,94,0.18)';
      g.lineWidth = 3;
      g.beginPath(); g.arc(x, cy, 120, 0, Math.PI * 2); g.stroke();
    }
    // 테두리
    g.strokeStyle = 'rgba(214,178,94,0.45)';
    g.lineWidth = 10;
    g.strokeRect(5, 5, ARENA.w - 10, ARENA.h - 10);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 4;
    g.strokeRect(22, 22, ARENA.w - 44, ARENA.h - 44);
    return c;
  })();

  // ───────────────────────── 보간
  const lerp = (a, b, k) => a + (b - a) * k;
  const lerpAng = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; };

  function buildView(rt) {
    let a = null, b = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].t <= rt) { a = snaps[i]; b = snaps[i + 1] || snaps[i]; break; }
    }
    if (!a) { a = snaps[0]; b = snaps[0]; }
    const k = b.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t))) : 1;
    const champs = b.ch.map(cb => {
      const ca = a.ch.find(c => c.s === cb.s);
      if (cb.hid || !ca || ca.hid) return cb;
      const jump = Math.hypot(cb.x - ca.x, cb.y - ca.y) > 260;
      return Object.assign({}, cb, jump ? {} : { x: lerp(ca.x, cb.x, k), y: lerp(ca.y, cb.y, k), f: lerpAng(ca.f, cb.f, k) });
    });
    const amap = new Map(a.pj.map(p => [p.i, p]));
    const projs = b.pj.map(pb => {
      const pa = amap.get(pb.i);
      return pa ? Object.assign({}, pb, { x: lerp(pa.x, pb.x, k), y: lerp(pa.y, pb.y, k) }) : pb;
    });
    return { s: b, champs, projs, walls: b.wl, hawks: b.hk };
  }

  // ───────────────────────── 입력
  const toWorld = (sx, sy) => ({ x: cam.x + (sx - W / 2) / scale, y: cam.y + (sy - H / 2) / scale });
  const send = m => socket.emit('input', m);
  let view = null, rightDown = false, holdAttack = false;

  cv.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  cv.addEventListener('mousedown', e => {
    if (!inGame || paused) return;
    if (e.button !== 2) return;
    e.preventDefault();
    rightDown = true;
    const w = toWorld(e.clientX, e.clientY);
    const en = view && view.champs.find(c => c.s !== mySlot);
    const now = performance.now() / 1000;
    if (en && !en.hid && !en.dead && Math.hypot(w.x - en.x, w.y - (en.y - (en.air > 0 ? 40 : 0))) < 80) {
      holdAttack = true;
      send({ type: 'attack' });
      Object.assign(marker, { x: en.x, y: en.y, t: now, atk: true });
    } else {
      holdAttack = false;
      send({ type: 'move', x: Math.round(w.x), y: Math.round(w.y) });
      Object.assign(marker, { x: w.x, y: w.y, t: now, atk: false });
    }
  });
  window.addEventListener('mouseup', e => { if (e.button === 2) rightDown = false; });
  window.addEventListener('blur', () => { rightDown = false; });
  setInterval(() => {
    if (!inGame || !rightDown || holdAttack || paused) return;
    const w = toWorld(mouse.x, mouse.y);
    send({ type: 'move', x: Math.round(w.x), y: Math.round(w.y) });
  }, 120);

  window.addEventListener('keydown', e => {
    if (!inGame) return;
    if (e.key === 'Escape') { paused = !paused; $('#pause').hidden = !paused; return; }
    if (paused || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    const map = { KeyQ: 'Q', KeyW: 'W', KeyE: 'E', KeyR: 'R', KeyF: 'F', KeyD: 'F' };
    const w = toWorld(mouse.x, mouse.y);
    if (map[code]) {
      e.preventDefault();
      send({ type: 'cast', key: map[code], x: Math.round(w.x), y: Math.round(w.y) });
    } else if (code === 'KeyS') {
      send({ type: 'stop' });
    } else if (code === 'Tab') {
      e.preventDefault();
      $('#keys').hidden = !$('#keys').hidden;
    }
  });
  $('#btnResume').onclick = () => { paused = false; $('#pause').hidden = true; };
  $('#btnQuit').onclick = () => { paused = false; $('#pause').hidden = true; socket.emit('quit'); };

  // ───────────────────────── 스킬 칸
  let slotEls = {};
  function buildSlots(key) {
    const box = $('#slots');
    box.innerHTML = '';
    slotEls = {};
    for (const k of ['Q', 'W', 'E', 'R', 'F']) {
      const el = document.createElement('div');
      el.className = 'slot' + (k === 'F' ? ' f' : '');
      el.style.setProperty('--c', k === 'F' ? '#f3d98b' : CH[key].color);
      el.title = k === 'F' ? '점멸: 400 거리 순간이동' : `${CH[key].skills[k].n}: ${CH[key].skills[k].d}`;
      el.innerHTML = `${icon(k === 'F' ? 'F' : key + '.' + k)}<span class="key">${k}</span><span class="cdv"></span><span class="cdt"></span><span class="pips2"></span>`;
      box.append(el);
      slotEls[k] = { el, cdv: el.querySelector('.cdv'), cdt: el.querySelector('.cdt'), pips: el.querySelector('.pips2'), lastPips: '' };
    }
  }
  function setSlot(k, { rem = 0, max = 1, text = null, glow = false, dim = false, pips = null }) {
    const s = slotEls[k];
    if (!s) return;
    const p = rem > 0 ? Math.min(1, rem / max) : 0;
    s.cdv.style.setProperty('--p', p.toFixed(3));
    s.cdt.textContent = text != null ? text : rem > 0 ? (rem >= 1 ? Math.ceil(rem) : rem.toFixed(1)) : '';
    s.el.classList.toggle('ready-glow', glow);
    s.el.classList.toggle('dim', dim);
    const ph = pips ? pips.map(on => `<i class="${on ? 'on' : ''}"></i>`).join('') : '';
    if (ph !== s.lastPips) { s.pips.innerHTML = ph; s.lastPips = ph; }
  }

  function updateHud(me, s) {
    if (!me || me.hid) return;
    const cd = me.cd || { Q: 0, W: 0, E: 0, R: 0, F: 0 };
    const cm = me.cdm || { Q: 1, W: 1, E: 1, R: 1, F: 60 };
    const k = me.k;
    if (k === 'wind') {
      setSlot('Q', { rem: cd.Q, max: cm.Q, pips: [me.qs >= 1, me.qs >= 2], glow: me.qs >= 2 && cd.Q <= 0 });
      setSlot('W', { rem: cd.W, max: cm.W });
      setSlot('E', { rem: me.el, max: 6, dim: me.el > 0 });
      setSlot('R', { rem: cd.R, max: cm.R, dim: !me.ur, glow: !!me.ur });
    } else if (k === 'soul') {
      setSlot('Q', { rem: cd.Q, max: cm.Q, pips: [me.qs >= 1, me.qs >= 2], glow: me.qs >= 2 && cd.Q <= 0 });
      setSlot('W', { rem: cd.W, max: cm.W });
      if (me.sp) setSlot('E', { text: me.sp.r.toFixed(1), glow: true });
      else setSlot('E', { rem: cd.E, max: cm.E });
      setSlot('R', { rem: cd.R, max: cm.R });
    } else {
      const qReady = me.fo >= 4 && me.mn >= 30;
      setSlot('Q', { text: me.buf > 0 ? me.buf.toFixed(1) : null, pips: [0, 1, 2, 3].map(i => me.fo > i), glow: qReady || me.buf > 0, dim: !qReady && !me.buf });
      setSlot('W', { rem: cd.W, max: cm.W, dim: me.mn < 60 });
      setSlot('E', { rem: me.hc > 0 ? cd.E : me.hr, max: me.hc > 0 ? cm.E : 35, pips: [me.hc >= 1, me.hc >= 2] });
      setSlot('R', { rem: cd.R, max: cm.R, dim: me.mn < 100 });
    }
    setSlot('F', { rem: cd.F, max: cm.F });

    const hpPct = me.hp / me.mh;
    $('#hpFill').style.width = (hpPct * 100).toFixed(1) + '%';
    const shPct = Math.min(1 - hpPct, me.sh / me.mh);
    const sh = $('#shFill');
    sh.style.left = (hpPct * 100).toFixed(1) + '%';
    sh.style.width = (shPct * 100).toFixed(1) + '%';
    $('#hpText').textContent = `${me.hp} / ${me.mh}` + (me.sh ? `  (+${me.sh})` : '');
    const rb = $('#resBar'), rf = $('#resFill'), rtx = $('#resText');
    if (k === 'frost') {
      rb.hidden = false; rf.style.width = (me.mn / me.mm * 100).toFixed(1) + '%';
      rf.style.background = 'linear-gradient(#7fb8ff,#3a6fd0)'; rtx.textContent = `${me.mn} / ${me.mm}`;
    } else if (k === 'wind') {
      rb.hidden = false; rf.style.width = (me.fl * 100).toFixed(0) + '%';
      rf.style.background = me.fl >= 1 ? 'linear-gradient(#ffffff,#b9c7d4)' : 'linear-gradient(#b9c7d4,#6f7f8f)';
      rtx.textContent = me.fl >= 1 ? '기류 가득' : '기류';
    } else {
      rb.hidden = !me.sp;
      if (me.sp) { rf.style.width = (me.sp.r / 5 * 100).toFixed(1) + '%'; rf.style.background = 'linear-gradient(#cfa8ff,#7d4fc9)'; rtx.textContent = `혼 이탈 · 복귀 피해 ${me.sp.st}`; }
    }

    // 점수판
    const tg = s.tg;
    const pip = n => Array.from({ length: tg }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    if (s.pr) {
      $('#sbPipsA').textContent = `처치 ${s.sc[mySlot]}`;
      $('#sbPipsB').textContent = `처치 ${s.sc[1 - mySlot]}`;
      $('#sbRound').textContent = '연습';
    } else {
      $('#sbPipsA').innerHTML = pip(s.sc[mySlot]);
      $('#sbPipsB').innerHTML = pip(s.sc[1 - mySlot]);
      $('#sbRound').textContent = `${s.rd} 라운드`;
    }
  }

  // ───────────────────────── 배너
  let bannerUntil = 0, bannerKey = '';
  function banner(html, dur, key) {
    const el = $('#banner');
    if (key !== bannerKey || el.hidden) {
      el.innerHTML = html;
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    }
    el.hidden = false;
    bannerKey = key;
    bannerUntil = performance.now() / 1000 + dur;
  }

  // ───────────────────────── 이펙트
  const FX_DUR = {
    dmg: 0.9, thrust: 0.22, circle: 0.35, cone: 0.32, gust: 0.4, swing: 0.2, block: 0.4, flash: 0.45,
    flowshield: 0.5, soulShield: 0.5, windUlt: 0.85, slam: 0.5, seal: 0.55, sealAim: 0.65, soulOut: 0.4, soulback: 0.4,
    soulmark: 0.8, shatter: 0.7, focus: 0.5, death: 1.0, hawk: 0.3, tornadoCast: 0.3, wallCast: 0.3, crystalCast: 0.3, dashE: 0.3, shoot: 0.15, respawn: 0.8,
  };
  function takeFx(rt) {
    const nowL = performance.now() / 1000;
    while (fxQueue.length && fxQueue[0]._t <= rt) {
      const f = fxQueue.shift();
      if (f.k === 'round') { if (!lastSnap || !lastSnap.pr) banner(`${f.n} 라운드<small>준비</small>`, 1.4, 'r' + f.n); continue; }
      if (f.k === 'fight') { banner('결투!', 0.9, 'fight' + Math.random()); continue; }
      if (f.k === 'roundEnd') {
        const title = f.w === -1 ? '무승부' : f.w === mySlot ? (f.over ? '결투 승리' : '라운드 승리') : (f.over ? '결투 패배' : '라운드 패배');
        banner(title, 2.4, 'end' + Math.random());
        continue;
      }
      if (f.k === 'swing') swingAt[f.s] = nowL;
      if (f.k === 'death' && lastSnap && lastSnap.pr && f.s === mySlot) banner('쓰러짐<small>곧 다시 일어납니다</small>', 2, 'dead' + Math.random());
      f.t0 = nowL;
      f.dur = FX_DUR[f.k] || 0.4;
      if (f.k === 'dmg') { f.ox = (Math.random() - 0.5) * 40; }
      fxs.push(f);
    }
    fxs = fxs.filter(f => nowL - f.t0 < f.dur);
    if (fxQueue.length > 300) fxQueue.splice(0, fxQueue.length - 300);
  }

  function champBySlot(s) { return view && view.champs.find(c => c.s === s && !c.hid); }

  function drawFxUnder(nowL) {
    for (const f of fxs) {
      const p = (nowL - f.t0) / f.dur;
      const fade = 1 - p;
      if (f.k === 'sealAim') {
        const ex = f.x + Math.cos(f.a) * f.l, ey = f.y + Math.sin(f.a) * f.l;
        ctx.save();
        ctx.strokeStyle = `rgba(224,69,123,${0.18 + 0.3 * p})`;
        ctx.lineWidth = 225;
        ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = `rgba(255,140,180,${0.6 * p + 0.2})`;
        ctx.lineWidth = 4;
        ctx.setLineDash([24, 18]);
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.restore();
      } else if (f.k === 'cone') {
        ctx.save();
        const g = ctx.createRadialGradient(f.x, f.y, 40, f.x, f.y, f.r);
        g.addColorStop(0, `rgba(179,131,242,${0.05 * fade})`);
        g.addColorStop(0.85, `rgba(200,150,255,${0.5 * fade})`);
        g.addColorStop(1, `rgba(240,220,255,${0.75 * fade})`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.arc(f.x, f.y, f.r * (0.6 + 0.4 * Math.min(1, p * 3)), f.a - f.arc / 2, f.a + f.arc / 2); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else if (f.k === 'circle') {
        ctx.save();
        ctx.strokeStyle = `rgba(190,250,240,${0.8 * fade})`;
        ctx.lineWidth = 18 * fade + 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.5 + 0.5 * p), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = `rgba(79,209,197,${0.12 * fade})`;
        ctx.fill();
        ctx.restore();
      } else if (f.k === 'slam' || f.k === 'shatter') {
        ctx.save();
        ctx.strokeStyle = f.k === 'slam' ? `rgba(220,250,255,${fade})` : `rgba(160,220,255,${fade})`;
        ctx.lineWidth = 8 * fade + 1;
        ctx.beginPath(); ctx.arc(f.x, f.y, 40 + 220 * p, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawFxOver(nowL) {
    for (const f of fxs) {
      const p = (nowL - f.t0) / f.dur;
      const fade = 1 - p;
      ctx.save();
      switch (f.k) {
        case 'thrust': {
          const c = champBySlot(f.s);
          const col = c && c.k === 'soul' ? '210,190,255' : '200,255,248';
          const ex = f.x + Math.cos(f.a) * f.l, ey = f.y + Math.sin(f.a) * f.l;
          ctx.strokeStyle = `rgba(${col},${0.85 * fade})`;
          ctx.lineCap = 'round';
          ctx.lineWidth = 60 * fade + 4;
          ctx.globalAlpha = 0.35;
          ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(f.x + Math.cos(f.a) * f.l * p * 0.5, f.y + Math.sin(f.a) * f.l * p * 0.5); ctx.lineTo(ex, ey); ctx.stroke();
          break;
        }
        case 'gust': {
          ctx.strokeStyle = `rgba(150,200,255,${0.6 * fade})`;
          ctx.lineWidth = 120 * fade;
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + Math.cos(f.a) * 450 * Math.min(1, p * 2), f.y + Math.sin(f.a) * 450 * Math.min(1, p * 2)); ctx.stroke();
          break;
        }
        case 'swing': {
          const c = champBySlot(f.s);
          if (!c) break;
          ctx.strokeStyle = f.alt ? `rgba(240,90,150,${fade})` : `rgba(255,255,255,${0.85 * fade})`;
          ctx.lineWidth = 7;
          ctx.lineCap = 'round';
          const lift = c.air > 0 ? 40 : 0;
          ctx.beginPath(); ctx.arc(c.x, c.y - lift, 95, f.a - 0.9 + p * 0.6, f.a + 0.5 + p * 0.6); ctx.stroke();
          break;
        }
        case 'block': {
          for (let i = 0; i < 8; i++) {
            const a = i / 8 * Math.PI * 2 + f.t0;
            const d = 10 + 60 * p;
            ctx.fillStyle = `rgba(230,250,255,${fade})`;
            ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 5 * fade + 1, 0, Math.PI * 2); ctx.fill();
          }
          break;
        }
        case 'flash': {
          for (const [x, y] of [[f.x1, f.y1], [f.x2, f.y2]]) {
            const g = ctx.createRadialGradient(x, y, 0, x, y, 90);
            g.addColorStop(0, `rgba(255,236,170,${0.9 * fade})`);
            g.addColorStop(1, 'rgba(255,236,170,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(x, y, 90, 0, Math.PI * 2); ctx.fill();
          }
          break;
        }
        case 'flowshield': case 'soulShield': case 'focus': case 'soulOut': case 'soulback': case 'respawn': {
          const c = champBySlot(f.s);
          const x = f.x != null ? f.x : c && c.x, y = f.y != null ? f.y : c && c.y;
          if (x == null) break;
          const col = f.k === 'flowshield' ? '235,245,255' : f.k === 'focus' ? '143,211,255' : f.k === 'respawn' ? '214,178,94' : '190,140,255';
          ctx.strokeStyle = `rgba(${col},${fade})`;
          ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(x, y, 40 + 40 * p, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'windUlt': {
          for (let i = 0; i < 5; i++) {
            const a = i * 1.26 + p * 2;
            const show = p * 5 > i;
            if (!show) continue;
            ctx.strokeStyle = `rgba(230,255,252,${0.9 * fade})`;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(f.x - Math.cos(a) * 110, f.y - 50 - Math.sin(a) * 110);
            ctx.lineTo(f.x + Math.cos(a) * 110, f.y - 50 + Math.sin(a) * 110);
            ctx.stroke();
          }
          break;
        }
        case 'seal': {
          ctx.strokeStyle = `rgba(224,69,123,${fade})`;
          ctx.lineWidth = 14 * fade + 2;
          ctx.shadowColor = '#ff4f8f'; ctx.shadowBlur = 20;
          ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
          ctx.strokeStyle = `rgba(255,255,255,${fade})`;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
          break;
        }
        case 'soulmark': {
          ctx.strokeStyle = `rgba(200,150,255,${fade})`;
          ctx.lineWidth = 10;
          ctx.lineCap = 'round';
          const s = 70 + 30 * p;
          ctx.beginPath(); ctx.moveTo(f.x - s, f.y - s); ctx.lineTo(f.x + s, f.y + s); ctx.moveTo(f.x + s, f.y - s); ctx.lineTo(f.x - s, f.y + s); ctx.stroke();
          break;
        }
        case 'shatter': {
          for (let i = 0; i < 12; i++) {
            const a = i / 12 * Math.PI * 2;
            const d = 30 + 160 * p;
            ctx.fillStyle = `rgba(200,240,255,${fade})`;
            ctx.save();
            ctx.translate(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d);
            ctx.rotate(a + p * 4);
            ctx.fillRect(-7, -3, 14, 6);
            ctx.restore();
          }
          break;
        }
        case 'death': {
          ctx.fillStyle = `rgba(10,10,14,${0.6 * fade})`;
          ctx.beginPath(); ctx.arc(f.x, f.y, 60 + 60 * p, 0, Math.PI * 2); ctx.fill();
          break;
        }
      }
      ctx.restore();
    }
  }

  function drawDmgNumbers(nowL) {
    for (const f of fxs) {
      if (f.k !== 'dmg' || f.v < 1) continue;
      const p = (nowL - f.t0) / f.dur;
      const big = f.cr;
      const sz = (big ? 34 : 24) * (p < 0.12 ? 1 + (0.12 - p) * 4 : 1);
      const col = f.ty === 'true' ? '#ffffff' : f.ty === 'magic' ? '#b98cff' : big ? '#ff9d3b' : '#f6d27a';
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - p) * 2);
      ctx.font = `700 ${sz}px "Chakra Petch", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      const x = f.x + f.ox, y = f.y - 140 - p * 60;
      const txt = f.v + (big ? '!' : '');
      ctx.strokeText(txt, x, y);
      ctx.fillStyle = col;
      ctx.fillText(txt, x, y);
      ctx.restore();
    }
  }

  // ───────────────────────── 월드 그리기
  function liftOf(c) {
    if (c.ult) return 70;
    if (c.air > 0) return 44 * Math.min(1, c.air * 3);
    return 0;
  }

  function drawChampFull(c, nowL, isMe) {
    if (c.hid) return;
    const lift = liftOf(c);
    if (c.dead) {
      drawChamp(ctx, c.k, c.x, c.y, c.f, { alpha: 0.28, time: nowL });
      return;
    }
    // 망령검객 몸
    if (c.sp) {
      ctx.save();
      ctx.strokeStyle = 'rgba(190,140,255,0.55)';
      ctx.setLineDash([10, 10]);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(c.sp.bx, c.sp.by); ctx.lineTo(c.x, c.y); ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.filter = 'grayscale(0.8) brightness(0.7)';
      drawChamp(ctx, c.k, c.sp.bx, c.sp.by, c.f, { alpha: 0.75, time: 0 });
      ctx.restore();
      // 복귀 타이머 원
      ctx.save();
      ctx.strokeStyle = 'rgba(200,160,255,0.9)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(c.sp.bx, c.sp.by, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (c.sp.r / 5)); ctx.stroke();
      ctx.restore();
    }
    // 발밑 상태 표시
    ctx.save();
    if (c.slow) {
      ctx.strokeStyle = 'rgba(143,211,255,0.7)';
      ctx.lineWidth = 4;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.ellipse(c.x, c.y + 4, 52, 32, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (c.qs >= 2 && (c.k === 'wind' || c.k === 'soul')) {
      const col = c.k === 'wind' ? '170,250,240' : '170,180,255';
      for (let i = 0; i < 3; i++) {
        const a = nowL * 5 + i * 2.1;
        ctx.strokeStyle = `rgba(${col},0.75)`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.ellipse(c.x, c.y, 58, 36, 0, a, a + 1.4); ctx.stroke();
      }
    }
    ctx.restore();

    const sw = nowL - swingAt[c.s];
    const swing = sw < 0.2 ? Math.sin(sw / 0.2 * Math.PI) * 0.9 : 0;
    const drawBow = c.k === 'frost' && (c.aw || (c.cast && (c.cast.k === 'W' || c.cast.k === 'R'))) ? 1 : 0;
    const spiritGlow = !!c.sp;
    if (spiritGlow) {
      ctx.save();
      const g = ctx.createRadialGradient(c.x, c.y - lift, 10, c.x, c.y - lift, 80);
      g.addColorStop(0, 'rgba(190,140,255,0.45)');
      g.addColorStop(1, 'rgba(190,140,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c.x, c.y - lift, 80, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (c.uns) {
      ctx.save();
      ctx.strokeStyle = 'rgba(214,178,94,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(c.x, c.y - lift, 46, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    drawChamp(ctx, c.k, c.x, c.y, c.f, {
      lift, time: nowL, ring: isMe ? COL.ally : COL.enemy, swing, draw: drawBow, alpha: spiritGlow ? 0.85 : 1,
    });
    // 보호막
    if (c.sh > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(235,245,255,0.12)';
      ctx.strokeStyle = 'rgba(235,245,255,0.7)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(c.x, c.y - lift, 48, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // 시전 진행 표시 (봉인참 등)
    if (c.cast && c.cast.k === 'R' && c.k === 'soul') {
      ctx.save();
      ctx.strokeStyle = 'rgba(224,69,123,0.95)';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(c.x, c.y - lift, 58, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.cast.p); ctx.stroke();
      ctx.restore();
    }
    // 기절 별
    if (c.stun > 0) {
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const a = nowL * 4 + i * 2.09;
        const x = c.x + Math.cos(a) * 34, y = c.y - lift - 58 + Math.sin(a) * 10;
        ctx.fillStyle = '#ffe08a';
        ctx.beginPath();
        for (let j = 0; j < 10; j++) {
          const rr = j % 2 ? 4 : 9;
          ctx.lineTo(x + Math.cos(j * Math.PI / 5) * rr, y + Math.sin(j * Math.PI / 5) * rr);
        }
        ctx.closePath(); ctx.fill();
      }
      // 얼음 덮개
      ctx.fillStyle = 'rgba(170,225,255,0.28)';
      ctx.strokeStyle = 'rgba(210,240,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let j = 0; j < 6; j++) ctx.lineTo(c.x + Math.cos(j * Math.PI / 3 + 0.3) * 50, c.y - lift + Math.sin(j * Math.PI / 3 + 0.3) * 50);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  function drawBars(c, isMe) {
    if (c.hid || c.dead) return;
    const lift = liftOf(c);
    const w = 128, h = 13;
    const x = c.x - w / 2, y = c.y - lift - 98;
    ctx.save();
    ctx.fillStyle = 'rgba(5,8,12,0.85)';
    ctx.fillRect(x - 3, y - 3, w + 6, h + (c.k === 'soul' && !c.sp ? 6 : 13));
    const hpw = w * Math.max(0, c.hp / c.mh);
    ctx.fillStyle = isMe ? '#4cc485' : '#d94a4a';
    ctx.fillRect(x, y, hpw, h);
    if (c.sh > 0) {
      ctx.fillStyle = 'rgba(240,244,248,0.9)';
      ctx.fillRect(x + hpw, y, Math.min(w - hpw, w * c.sh / c.mh), h);
    }
    // 100 단위 눈금
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let v = 100; v < c.mh; v += 100) {
      const tx = x + w * v / c.mh;
      ctx.fillRect(tx, y, v % 1000 === 0 ? 2 : 1, v % 1000 === 0 ? h : h * 0.55);
    }
    // 자원 줄
    const ry = y + h + 2;
    if (c.k === 'frost') { ctx.fillStyle = '#4f86e0'; ctx.fillRect(x, ry, w * c.mn / Math.max(1, c.mm), 5); }
    else if (c.k === 'wind') { ctx.fillStyle = c.fl >= 1 ? '#f2f6fa' : '#8796a8'; ctx.fillRect(x, ry, w * c.fl, 5); }
    else if (c.sp) { ctx.fillStyle = '#b383f2'; ctx.fillRect(x, ry, w * c.sp.r / 5, 5); }
    // 이름
    ctx.font = '600 17px "IBM Plex Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(c.n, c.x, y - 9);
    ctx.fillStyle = isMe ? '#d8f5e5' : '#ffd6d6';
    ctx.fillText(c.n, c.x, y - 9);
    ctx.restore();
  }

  function drawProj(p, nowL) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.k === 'arrow' || p.k === 'volley') {
      ctx.rotate(p.a);
      ctx.strokeStyle = p.k === 'volley' ? '#d6f1ff' : '#bfe8ff';
      ctx.lineWidth = p.k === 'volley' ? 3.5 : 4;
      ctx.beginPath(); ctx.moveTo(-34, 0); ctx.lineTo(8, 0); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(2, -6); ctx.lineTo(2, 6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(143,211,255,0.35)';
      ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(-60, 0); ctx.lineTo(-30, 0); ctx.stroke();
    } else if (p.k === 'tornado') {
      for (let i = 0; i < 4; i++) {
        const a = nowL * 12 + i * 1.57;
        ctx.strokeStyle = `rgba(${i % 2 ? '220,255,250' : '120,220,210'},0.85)`;
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.ellipse(0, -i * 14, 90 - i * 14, 50 - i * 8, 0, a, a + 3.2); ctx.stroke();
      }
    } else if (p.k === 'crystal') {
      ctx.rotate(p.a);
      ctx.strokeStyle = 'rgba(143,211,255,0.35)';
      ctx.lineWidth = 50;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-220, 0); ctx.lineTo(-40, 0); ctx.stroke();
      ctx.rotate(nowL * 6);
      const g = ctx.createLinearGradient(-40, -40, 40, 40);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#5aa8e0');
      ctx.fillStyle = g;
      ctx.shadowColor = '#9fdcff'; ctx.shadowBlur = 30;
      ctx.beginPath(); ctx.moveTo(0, -56); ctx.lineTo(30, 0); ctx.lineTo(0, 56); ctx.lineTo(-30, 0); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function drawWall(w, nowL) {
    const ux = -w.dy, uy = w.dx;
    const a = Math.min(1, w.r / 0.5);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w.x, w.y);
    ctx.rotate(Math.atan2(uy, ux));
    const g = ctx.createLinearGradient(0, -26, 0, 26);
    g.addColorStop(0, 'rgba(180,255,245,0)');
    g.addColorStop(0.5, 'rgba(180,255,245,0.45)');
    g.addColorStop(1, 'rgba(180,255,245,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-w.h, -26, w.h * 2, 52);
    ctx.strokeStyle = 'rgba(230,255,252,0.8)';
    ctx.lineWidth = 2.5;
    for (let i = -w.h; i < w.h; i += 22) {
      const o = ((nowL * 90 + i) % 44) - 22;
      ctx.beginPath(); ctx.moveTo(i, -22 + o * 0.3); ctx.quadraticCurveTo(i + 8, 0, i, 22 - o * 0.3); ctx.stroke();
    }
    ctx.restore();
  }

  function drawHawk(h, nowL) {
    ctx.save();
    ctx.translate(h.x, h.y);
    const flap = Math.sin(nowL * 14) * 8;
    ctx.strokeStyle = '#cfefff';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-26, -6 - flap); ctx.quadraticCurveTo(-10, -4, 0, 4); ctx.quadraticCurveTo(10, -4, 26, -6 - flap); ctx.stroke();
    if (h.a) {
      ctx.strokeStyle = 'rgba(143,211,255,0.35)';
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 12]);
      ctx.beginPath(); ctx.arc(0, 0, HAWK_V, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawFog(me, hawks) {
    const fs = 0.5;
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, fogC.width, fogC.height);
    fctx.fillStyle = 'rgba(3,6,10,0.74)';
    fctx.fillRect(0, 0, fogC.width, fogC.height);
    fctx.globalCompositeOperation = 'destination-out';
    const hole = (wx, wy, r) => {
      const sx = (W / 2 + (wx - cam.x) * scale) * fs, sy = (H / 2 + (wy - cam.y) * scale) * fs, sr = r * scale * fs;
      const g = fctx.createRadialGradient(sx, sy, sr * 0.82, sx, sy, sr);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      fctx.fillStyle = g;
      fctx.beginPath(); fctx.arc(sx, sy, sr, 0, Math.PI * 2); fctx.fill();
    };
    if (me && !me.hid) {
      hole(me.x, me.y, VISION);
      if (me.sp) hole(me.sp.bx, me.sp.by, VISION * 0.6);
    }
    for (const h of hawks) hole(h.x, h.y, HAWK_V);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fogC, 0, 0, cv.width, cv.height);
  }

  function drawMini(v, me) {
    const m = $('#mini');
    const g = m.getContext('2d');
    const k = m.width / ARENA.w;
    g.clearRect(0, 0, m.width, m.height);
    g.drawImage(ground, 0, 0, m.width, m.height);
    g.fillStyle = 'rgba(3,6,10,0.35)';
    g.fillRect(0, 0, m.width, m.height);
    for (const h of v.hawks) { g.fillStyle = '#cfefff'; g.fillRect(h.x * k - 2, h.y * k - 2, 4, 4); }
    for (const c of v.champs) {
      if (c.hid || c.dead) continue;
      g.fillStyle = c.s === mySlot ? COL.ally : COL.enemy;
      g.beginPath(); g.arc(c.x * k, c.y * k, 6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 1;
    g.strokeRect((cam.x - W / 2 / scale) * k, (cam.y - H / 2 / scale) * k, W / scale * k, H / scale * k);
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!inGame || !snaps.length) return;
    const nowL = performance.now() / 1000;
    const rt = nowL + offset - INTERP;
    view = buildView(rt);
    takeFx(rt);
    const s = view.s;
    const me = view.champs.find(c => c.s === mySlot);
    const meFull = (lastSnap && lastSnap.ch.find(c => c.s === mySlot)) || me;
    const en = view.champs.find(c => c.s !== mySlot);

    if (me && !me.hid) {
      cam.x += (me.x - cam.x) * 0.2;
      cam.y += (me.y - cam.y) * 0.2;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * (W / 2 - cam.x * scale), DPR * (H / 2 - cam.y * scale));
    ctx.drawImage(ground, 0, 0, ARENA.w, ARENA.h);

    // 내 사거리
    if (me && !me.hid && !me.dead) {
      ctx.save();
      ctx.strokeStyle = 'rgba(214,178,94,0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(me.x, me.y, CH[me.k] && me.k === 'frost' ? 600 + 32 : 175 + 34, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // 클릭 표시
    const mk = nowL - marker.t;
    if (mk < 0.4) {
      ctx.save();
      ctx.strokeStyle = marker.atk ? `rgba(238,93,93,${1 - mk / 0.4})` : `rgba(91,211,148,${1 - mk / 0.4})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(marker.x, marker.y, 30 * (1 - mk / 0.4) + 8, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    drawFxUnder(nowL);
    for (const w of view.walls) drawWall(w, nowL);
    const order = view.champs.slice().sort((a, b) => (a.y || 0) - (b.y || 0));
    for (const c of order) drawChampFull(c, nowL, c.s === mySlot);
    for (const p of view.projs) drawProj(p, nowL);
    for (const h of view.hawks) drawHawk(h, nowL);
    drawFxOver(nowL);

    // 질풍검객 궁 가능 화살표
    if (meFull && meFull.ur && en && !en.hid && me) {
      ctx.save();
      const a = Math.atan2(en.y - me.y, en.x - me.x);
      ctx.translate(me.x + Math.cos(a) * 90, me.y + Math.sin(a) * 90);
      ctx.rotate(a);
      ctx.fillStyle = 'rgba(214,178,94,0.95)';
      ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(-8, -16); ctx.lineTo(-2, 0); ctx.lineTo(-8, 16); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    drawFog(me, view.hawks);
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * (W / 2 - cam.x * scale), DPR * (H / 2 - cam.y * scale));
    for (const c of order) drawBars(c, c.s === mySlot);
    drawDmgNumbers(nowL);

    drawMini(view, me);
    updateHud(meFull, lastSnap || s);

    // 카운트다운
    if (lastSnap && lastSnap.ph === 'countdown' && lastSnap.pu < 3.05) {
      const n = Math.max(1, Math.ceil(lastSnap.pu));
      banner(`${n}<small>${lastSnap.pr ? '연습' : lastSnap.rd + ' 라운드'}</small>`, 0.3, 'cd' + n);
    }
    if (nowL > bannerUntil) $('#banner').hidden = true;
  }
  requestAnimationFrame(frame);

  // 테스트·디버그용: 화면 좌표 변환
  window.__duel = {
    enemyScreen() {
      const en = view && view.champs.find(c => c.s !== mySlot && !c.hid);
      if (!en) return null;
      return { x: W / 2 + (en.x - cam.x) * scale, y: H / 2 + (en.y - cam.y) * scale };
    },
  };
})();
