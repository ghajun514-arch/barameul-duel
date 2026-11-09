'use strict';
(() => {
  const { CH, icon, drawChamp, portrait } = window.ART;
  const SFX = window.SFX;
  const ARENA = { w: 2800, h: 1800 };
  const VISION = 1150, HAWK_V = 950;
  const INTERP = 0.1;          // 상대 챔피언 보간 지연(초)
  const COL = { ally: '#5bd394', enemy: '#ee5d5d', brass: '#d6b25e' };
  const $ = s => document.querySelector(s);
  const hyp = Math.hypot;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 */ } },
  };
  const sess = {
    get() { try { return JSON.parse(sessionStorage.getItem('duel.session') || 'null'); } catch (e) { return null; } },
    set(v) { try { if (v) sessionStorage.setItem('duel.session', JSON.stringify(v)); else sessionStorage.removeItem('duel.session'); } catch (e) { /* 저장 불가 */ } },
  };

  // ───────────────────────── 연결
  const socket = io({ transports: ['websocket', 'polling'] });
  let session = sess.get();
  let room = null, mySlot = 0, inGame = false, endedNormally = false, gameMode = 'duel';
  let rtt = null;

  function setConn(text) { $('#connState').textContent = text; }
  const slowWake = setTimeout(() => { if (!socket.connected) setConn('서버를 깨우는 중이에요. Render 무료 서버는 처음 접속할 때 1분쯤 걸릴 수 있어요.'); }, 3000);
  socket.on('connect', () => {
    clearTimeout(slowWake);
    setConn('서버에 연결됐어요.');
    if (session && session.token) socket.emit('rejoin', { token: session.token });
  });
  socket.on('connect_error', () => setConn('서버에 연결하지 못했어요. 다시 시도하는 중…'));
  socket.on('session', s => { session = s; sess.set(s); });
  socket.on('rejoinFail', () => {
    session = null; sess.set(null);
    if (room || inGame) { room = null; inGame = false; show('title'); toast('방이 사라졌어요. 새로 만들어 주세요.'); }
  });
  socket.on('disconnect', () => {
    setConn('연결이 끊겼어요. 다시 연결하는 중…');
    if (room || inGame) toast('연결이 끊겼어요. 다시 연결하는 중…');
  });
  setInterval(() => {
    if (!socket.connected) return;
    const t0 = performance.now();
    socket.timeout(3000).emit('png', 0, err => {
      if (err) return;
      const r = (performance.now() - t0) / 1000;
      rtt = rtt == null ? r : rtt * 0.75 + r * 0.25;
    });
  }, 1500);

  // ───────────────────────── 공용 UI
  function show(id) { for (const s of ['title', 'lobby', 'game']) $('#' + s).hidden = s !== id; }
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
  }
  socket.on('err', m => { $('#menuErr').textContent = m; });
  socket.on('notice', m => toast(m));
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

  const needConn = () => { if (!socket.connected) { $('#menuErr').textContent = '아직 서버에 연결되지 않았어요. 잠시 뒤 다시 눌러 주세요.'; return false; } $('#menuErr').textContent = ''; return true; };
  $('#btnCreate').onclick = () => { if (needConn()) socket.emit('create', { name: myName() }); };
  $('#btnPractice').onclick = () => { if (needConn()) socket.emit('practice', { name: myName(), mode: store.get('duel.botMode') || 'ai' }); };
  const doJoin = () => {
    const code = $('#codeInput').value.trim().toUpperCase();
    if (code.length !== 4) { $('#menuErr').textContent = '방 코드는 4글자예요.'; return; }
    if (needConn()) socket.emit('join', { code, name: myName() });
  };
  $('#btnJoin').onclick = doJoin;
  $('#codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doJoin(); } });
  $('#menuForm').addEventListener('submit', e => e.preventDefault());

  // ───────────────────────── 대기실
  const champCards = {};
  (function buildChampGrid() {
    for (const k of ['wind', 'soul', 'frost']) {
      const d = CH[k];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'champ';
      const statHtml = Object.entries(d.stats).map(([n, v]) => `<div class="stat">${n}<i style="--v:${Math.round(v * 100)}%;--c:${d.color}"></i></div>`).join('');
      const kit = ['P', 'Q', 'W', 'E', 'R'].map(s => `<li><b>${s === 'P' ? '◆' : s}</b><span><em>${d.skills[s].n}</em> ${d.skills[s].d}</span></li>`).join('');
      b.innerHTML = `<div class="top"><canvas width="144" height="144"></canvas><div><h3>${d.name}</h3><div class="role">${d.role}</div></div></div><div class="stats">${statHtml}</div><ul class="kit">${kit}</ul>`;
      portrait(b.querySelector('canvas'), k);
      b.onclick = () => socket.emit('pick', { champ: k });
      $('#champGrid').append(b);
      champCards[k] = b;

      const bb = document.createElement('button');
      bb.type = 'button';
      bb.className = 'btn small';
      bb.dataset.k = k;
      bb.textContent = d.name;
      bb.onclick = () => socket.emit('pick', { champ: k, bot: true });
      $('#botRow').append(bb);
    }
    $('#botMode').querySelectorAll('button').forEach(b => {
      b.onclick = () => { store.set('duel.botMode', b.dataset.mode); socket.emit('setBot', { mode: b.dataset.mode }); };
    });
  })();

  function seatHtml(p, label) {
    if (!p) return `<div class="seat empty">상대를 기다리는 중…</div>`;
    const st = p.offline ? '연결 끊김' : p.ready ? '준비 완료' : '고르는 중';
    return `<div class="seat"><canvas width="112" height="112"></canvas>
      <div class="who"><strong></strong><span>${label} · ${CH[p.champ].name}</span></div>
      <span class="state ${p.ready && !p.offline ? 'ready' : ''}">${st}</span></div>`;
  }

  function renderLobby() {
    const r = room;
    const practice = r.mode !== 'duel';
    $('#roomCode').textContent = practice ? (r.mode === 'ai' ? '대전' : '연습') : r.code;
    $('#codeLabel').textContent = practice ? '혼자 하기' : '방 코드';
    $('#btnCopy').hidden = practice;
    $('#copyNote').textContent = practice ? '상대와 방식을 고르고 준비를 누르면 바로 시작합니다.' : '친구에게 코드를 알려주거나 초대 링크를 보내세요.';
    $('#lobbyKind').textContent = practice ? '연습장' : '대기실';
    const me = r.players.find(p => p.you);
    const other = r.players.find(p => !p.you);
    const seats = $('#seats');
    seats.innerHTML = seatHtml(me, '나') + seatHtml(other, other && other.bot ? (r.mode === 'ai' ? '컴퓨터' : '허수아비') : '상대');
    seats.querySelectorAll('.seat').forEach((el, i) => {
      const p = i === 0 ? me : other;
      if (!p || !el.querySelector('canvas')) return;
      el.querySelector('strong').textContent = p.name;
      portrait(el.querySelector('canvas'), p.champ, i === 0 ? COL.ally : COL.enemy);
    });
    for (const k in champCards) champCards[k].classList.toggle('sel', !!me && me.champ === k);
    $('#botPick').hidden = !practice;
    if (practice && other) {
      $('#botRow').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === other.champ));
      $('#botMode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === r.mode));
      $('#botNote').textContent = r.mode === 'ai'
        ? '컴퓨터가 스킬을 쓰며 실제로 싸웁니다. 3라운드를 먼저 따내면 승리.'
        : '허수아비는 반격하지 않고 걸어 다닙니다. 4초 동안 맞지 않으면 체력이 다시 찹니다. 끝없이 연습할 수 있어요.';
    }
    const rb = $('#btnReady');
    rb.textContent = me && me.ready ? '준비 취소' : (practice ? '시작' : '준비 완료');
    rb.classList.toggle('primary', !(me && me.ready));
    $('#readyNote').textContent = practice ? '' :
      !other ? '상대가 들어오면 둘 다 준비해야 시작합니다.' :
      other.offline ? '상대 연결이 끊겼어요. 다시 들어오길 기다리는 중.' :
      other.ready ? '상대는 준비됐어요.' : '두 사람 모두 준비하면 바로 시작합니다.';
  }

  socket.on('room', r => {
    room = r;
    gameMode = r.mode;
    if (inGame && r.state === 'lobby') {
      inGame = false;
      if (!endedNormally) toast('결투가 중단됐어요.');
    }
    if (!inGame && r.state === 'lobby') {
      show('lobby');
      const u = new URL(location.href);
      if (r.mode === 'duel') u.searchParams.set('room', r.code); else u.searchParams.delete('room');
      history.replaceState(null, '', u);
    }
    renderLobby();
  });

  $('#btnReady').onclick = () => {
    const me = room && room.players.find(p => p.you);
    socket.emit('ready', { ready: !(me && me.ready) });
  };
  $('#btnLeave').onclick = () => {
    socket.emit('leave');
    room = null; session = null; sess.set(null);
    const u = new URL(location.href); u.searchParams.delete('room'); history.replaceState(null, '', u);
    show('title');
  };
  $('#btnCopy').onclick = () => {
    const link = `${location.origin}/?room=${room.code}`;
    const done = () => { $('#copyNote').textContent = '초대 링크를 복사했어요. 친구에게 붙여넣어 보내세요.'; };
    const fail = () => { $('#copyNote').textContent = `이 주소를 보내세요: ${link}`; };
    try { navigator.clipboard.writeText(link).then(done, fail); } catch (e) { fail(); }
  };

  // ───────────────────────── 게임 상태
  let snaps = [], offset = null, fxQueue = [], fxs = [], lastSnap = null, lastRecv = 0, meS = null;
  let names = ['', ''], myKey = 'wind';
  const swingAt = [-9, -9], flashAt = [-9, -9];
  const markers = [];
  let paused = false;
  const P = { x: 0, y: 0, init: false, tgt: null, tgtAt: -9, walk: 0, f: 0, moving: false };
  const walkPh = [0, 0], lastPos = [null, null];

  socket.on('start', s => {
    mySlot = s.slot;
    gameMode = s.mode;
    names = s.players.map(p => p.name);
    myKey = s.players[mySlot].champ;
    const wasIn = inGame;
    inGame = true;
    endedNormally = false;
    paused = false;
    snaps = []; offset = null; fxQueue = []; fxs = []; lastSnap = null; meS = null;
    P.init = false; P.tgt = null;
    $('#pause').hidden = true;
    $('#result').hidden = true;
    show('game');
    buildSlots(myKey);
    portrait($('#portrait'), myKey, COL.ally);
    $('#sbNameA').textContent = names[mySlot];
    $('#sbNameB').textContent = names[1 - mySlot];
    resize();
    if (!wasIn) { cam.x = ARENA.w / 2 + (mySlot === 0 ? -700 : 700); cam.y = ARENA.h / 2; }
  });

  socket.on('snap', s => {
    if (!inGame) return;
    const now = performance.now() / 1000;
    const off = s.t - now;
    if (offset === null || Math.abs(off - offset) > 0.35) offset = off;
    else offset += (off - offset) * 0.05;
    snaps.push(s);
    if (snaps.length > 40) snaps.shift();
    for (const f of s.fx) {
      f._t = s.t;
      // 내가 쓴 스킬 이펙트는 바로 보여준다(반응이 빠르게 느껴지도록)
      if (f.s === mySlot && f.k !== 'dmg' && f.k !== 'death') startFx(f, now);
      else fxQueue.push(f);
    }
    lastSnap = s;
    lastRecv = now;
    meS = s.ch.find(c => c.s === mySlot) || null;
  });

  socket.on('end', e => {
    endedNormally = true;
    const win = e.winner === e.you;
    const h = $('#resTitle');
    h.textContent = win ? '승리' : '패배';
    h.className = win ? 'win' : 'lose';
    $('#resScore').textContent = `${e.score[e.you]} : ${e.score[1 - e.you]}`;
    $('#result').hidden = false;
    SFX.play(win ? 'win' : 'lose');
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
    if (!W || !H) return;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    fogC.width = Math.max(1, Math.round(W / 2)); fogC.height = Math.max(1, Math.round(H / 2));
    scale = Math.min(W / 1550, H / 900);
  }
  window.addEventListener('resize', () => { if (inGame) resize(); });

  // 바닥 미리 그리기
  const BRAZIERS = [[160, 160], [ARENA.w - 160, 160], [160, ARENA.h - 160], [ARENA.w - 160, ARENA.h - 160], [ARENA.w / 2, 110], [ARENA.w / 2, ARENA.h - 110]];
  const ground = (() => {
    const k = 0.5;
    const c = document.createElement('canvas');
    c.width = ARENA.w * k; c.height = ARENA.h * k;
    const g = c.getContext('2d');
    g.scale(k, k);
    const bg = g.createRadialGradient(ARENA.w / 2, ARENA.h / 2, 100, ARENA.w / 2, ARENA.h / 2, ARENA.w * 0.65);
    bg.addColorStop(0, '#22302f');
    bg.addColorStop(1, '#0e1517');
    g.fillStyle = bg;
    g.fillRect(0, 0, ARENA.w, ARENA.h);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // 이끼 얼룩
    for (let i = 0; i < 70; i++) {
      const x = rnd() * ARENA.w, y = rnd() * ARENA.h, r = 60 + rnd() * 160;
      const gg = g.createRadialGradient(x, y, 0, x, y, r);
      gg.addColorStop(0, `rgba(${60 + rnd() * 30},${90 + rnd() * 30},${60 + rnd() * 20},0.10)`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gg;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // 육각 바닥돌
    const s = 64, hh = s * Math.sqrt(3) / 2;
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
        g.fillStyle = v < 0.15 ? 'rgba(0,0,0,0.18)' : v > 0.92 ? 'rgba(120,170,160,0.06)' : 'rgba(255,255,255,0.014)';
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.38)';
        g.lineWidth = 3;
        g.stroke();
        if (v > 0.965) {
          // 금 간 돌
          g.strokeStyle = 'rgba(0,0,0,0.5)';
          g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(cx - 20, cy - 10); g.lineTo(cx + 2, cy + 4); g.lineTo(cx + 18, cy - 2); g.stroke();
        }
      }
    }
    // 중앙 결투 원과 문양
    const cx = ARENA.w / 2, cy = ARENA.h / 2;
    g.strokeStyle = 'rgba(214,178,94,0.24)';
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
    g.save();
    g.translate(cx, cy);
    g.strokeStyle = 'rgba(214,178,94,0.16)';
    g.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      g.rotate(Math.PI / 3);
      g.beginPath(); g.moveTo(-140, 0); g.lineTo(140, 0); g.stroke();
    }
    g.restore();
    // 출발 발판
    for (const [x, col] of [[cx - 700, 'rgba(91,211,148,0.10)'], [cx + 700, 'rgba(238,93,93,0.10)']]) {
      g.fillStyle = col;
      g.beginPath(); g.arc(x, cy, 120, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(214,178,94,0.2)';
      g.lineWidth = 3;
      g.beginPath(); g.arc(x, cy, 120, 0, Math.PI * 2); g.stroke();
    }
    // 화로 받침
    for (const [x, y] of BRAZIERS) {
      g.fillStyle = '#1a1d20';
      g.beginPath(); g.arc(x, y, 34, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(214,178,94,0.5)';
      g.lineWidth = 4;
      g.stroke();
    }
    // 테두리
    g.strokeStyle = 'rgba(214,178,94,0.5)';
    g.lineWidth = 10;
    g.strokeRect(5, 5, ARENA.w - 10, ARENA.h - 10);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 4;
    g.strokeRect(22, 22, ARENA.w - 44, ARENA.h - 44);
    return c;
  })();
  const motes = Array.from({ length: 70 }, () => ({ x: Math.random() * ARENA.w, y: Math.random() * ARENA.h, s: 1.5 + Math.random() * 2.5, v: 8 + Math.random() * 18, p: Math.random() * 6 }));

  // ───────────────────────── 보간
  const lerp = (a, b, k) => a + (b - a) * k;
  const lerpAng = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; };

  function buildView(rt) {
    let a = null, b = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].t <= rt) { a = snaps[i]; b = snaps[i + 1] || snaps[i]; break; }
    }
    if (!a) { a = snaps[0]; b = snaps[0]; }
    const k = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 1;
    const champs = b.ch.map(cb => {
      const ca = a.ch.find(c => c.s === cb.s);
      if (cb.hid || !ca || ca.hid) return cb;
      const jump = hyp(cb.x - ca.x, cb.y - ca.y) > 260;
      return Object.assign({}, cb, jump ? {} : { x: lerp(ca.x, cb.x, k), y: lerp(ca.y, cb.y, k), f: lerpAng(ca.f, cb.f, k) });
    });
    const amap = new Map(a.pj.map(p => [p.i, p]));
    const projs = b.pj.map(pb => {
      const pa = amap.get(pb.i);
      return pa ? Object.assign({}, pb, { x: lerp(pa.x, pb.x, k), y: lerp(pa.y, pb.y, k) }) : pb;
    });
    return { s: b, champs, projs, walls: b.wl, hawks: b.hk };
  }

  // 내 챔피언: 최신 서버 위치에서 클릭한 곳을 향해 미리 움직여 지연을 없앤다
  function predictMe(nowL, dt) {
    const me = meS;
    if (!me || me.hid) return null;
    const el = Math.min(0.12, nowL - lastRecv);
    const lag = Math.min(0.3, rtt == null ? 0.08 : rtt);
    let x = me.x, y = me.y, f = me.f, moving = false;
    const live = lastSnap && lastSnap.ph === 'fight' && !lastSnap.pz;
    const free = live && !me.dead && !me.cast && !me.dash && !(me.air > 0) && !(me.stun > 0) && !me.ult && !me.at;
    if (free) {
      let tgt = null;
      if (P.tgt && nowL - P.tgtAt < lag + 0.35) tgt = P.tgt;
      else if (me.mt) tgt = { x: me.mt[0], y: me.mt[1] };
      if (tgt) {
        const dx = tgt.x - x, dy = tgt.y - y, l = hyp(dx, dy);
        if (l > 1) {
          const step = Math.min(l, (me.ms || 340) * (el + lag));
          x += dx / l * step; y += dy / l * step;
          f = Math.atan2(dy, dx);
          moving = l > 4;
        }
      }
    } else if (live && !me.dead) {
      x += (me.vx || 0) * el; y += (me.vy || 0) * el;
      moving = hyp(me.vx || 0, me.vy || 0) > 30;
    }
    x = clamp(x, 34, ARENA.w - 34); y = clamp(y, 34, ARENA.h - 34);
    if (!P.init || hyp(x - P.x, y - P.y) > 260 || me.dead) { P.x = x; P.y = y; P.init = true; }
    else {
      const k = 1 - Math.exp(-dt * 22);
      P.x += (x - P.x) * k; P.y += (y - P.y) * k;
    }
    P.f = lerpAng(P.f, f, 1 - Math.exp(-dt * 25));
    P.moving = moving;
    if (moving) P.walk += dt;
    return Object.assign({}, me, { x: P.x, y: P.y, f: P.f });
  }

  // ───────────────────────── 입력
  const toWorld = (sx, sy) => ({ x: cam.x + (sx - W / 2) / scale, y: cam.y + (sy - H / 2) / scale });
  const send = m => socket.emit('input', m);
  let view = null, holdBtn = -1, holdAttack = false, aMove = 0;

  function enemyUnder(w) {
    const en = view && view.champs.find(c => c.s !== mySlot);
    if (!en || en.hid || en.dead) return null;
    const lift = liftOf(en);
    return hyp(w.x - en.x, w.y - (en.y - lift)) < 85 ? en : null;
  }
  function addMarker(x, y, atk, small) { markers.push({ x, y, t: performance.now() / 1000, atk, small }); if (markers.length > 12) markers.shift(); }

  function issueAt(sx, sy, fresh) {
    const w = toWorld(sx, sy);
    const nowL = performance.now() / 1000;
    const en = enemyUnder(w);
    const atkMove = aMove > nowL;
    if (en || (atkMove && view && view.champs.some(c => c.s !== mySlot && !c.hid && !c.dead))) {
      holdAttack = true;
      send({ type: 'attack' });
      P.tgt = null;
      const tgt = en || view.champs.find(c => c.s !== mySlot);
      if (fresh) { addMarker(tgt.x, tgt.y, true); SFX.play('click'); }
      aMove = 0;
      return;
    }
    holdAttack = false;
    aMove = 0;
    const x = clamp(Math.round(w.x), 0, ARENA.w), y = clamp(Math.round(w.y), 0, ARENA.h);
    send({ type: 'move', x, y });
    P.tgt = { x, y }; P.tgtAt = nowL;
    if (fresh) { addMarker(x, y, false); SFX.play('click'); }
  }

  cv.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('mousemove', e => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (inGame) cv.classList.toggle('atk', !!enemyUnder(toWorld(mouse.x, mouse.y)) || aMove > performance.now() / 1000);
  });
  cv.addEventListener('mousedown', e => {
    if (!inGame || paused) return;
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    holdBtn = e.button;
    issueAt(e.clientX, e.clientY, true);
  });
  window.addEventListener('mouseup', e => { if (e.button === holdBtn) holdBtn = -1; });
  window.addEventListener('blur', () => { holdBtn = -1; });
  let lastHoldMarker = 0;
  setInterval(() => {
    if (!inGame || holdBtn < 0 || holdAttack || paused) return;
    issueAt(mouse.x, mouse.y, false);
    const nowL = performance.now() / 1000;
    if (nowL - lastHoldMarker > 0.3) { lastHoldMarker = nowL; const w = toWorld(mouse.x, mouse.y); addMarker(w.x, w.y, false, true); }
  }, 90);

  const KEYMAP = { KeyQ: 'Q', KeyW: 'W', KeyE: 'E', KeyR: 'R', KeyF: 'F', KeyD: 'F' };
  window.addEventListener('keydown', e => {
    if (!inGame) return;
    if (e.key === 'Escape') { paused = !paused; $('#pause').hidden = !paused; return; }
    if (paused || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    if (KEYMAP[code]) {
      e.preventDefault();
      const w = toWorld(mouse.x, mouse.y);
      send({ type: 'cast', key: KEYMAP[code], x: Math.round(w.x), y: Math.round(w.y) });
      if (KEYMAP[code] === 'F') P.init = false;
    } else if (code === 'KeyS') {
      send({ type: 'stop' });
      P.tgt = null;
      if (meS) meS.mt = null;
    } else if (code === 'KeyA') {
      aMove = performance.now() / 1000 + 3;
      cv.classList.add('atk');
    } else if (code === 'KeyM') {
      toggleMute();
    } else if (code === 'Tab') {
      e.preventDefault();
      $('#keys').hidden = !$('#keys').hidden;
    }
  });
  function toggleMute() {
    const m = SFX.toggle();
    $('#btnMute').classList.toggle('off', m);
  }
  $('#btnMute').classList.toggle('off', SFX.isMuted());
  $('#btnMute').onclick = toggleMute;
  $('#btnResume').onclick = () => { paused = false; $('#pause').hidden = true; };
  $('#btnQuit').onclick = () => { paused = false; $('#pause').hidden = true; socket.emit('quit'); };

  // ───────────────────────── 스킬 칸
  let slotEls = {}, hoverSlot = null;
  function buildSlots(key) {
    const box = $('#slots');
    box.innerHTML = '';
    slotEls = {};
    for (const k of ['Q', 'W', 'E', 'R', 'F']) {
      const el = document.createElement('div');
      el.className = 'slot' + (k === 'F' ? ' f' : '');
      el.style.setProperty('--c', k === 'F' ? '#f3d98b' : CH[key].color);
      el.innerHTML = `${icon(k === 'F' ? 'F' : key + '.' + k)}<span class="key">${k === 'F' ? 'D' : k}</span><span class="cdv"></span><span class="cdt"></span><span class="pips2"></span>`;
      el.addEventListener('mouseenter', () => {
        hoverSlot = k;
        const sk = k === 'F' ? { n: '점멸', d: '마우스 방향으로 최대 400 거리를 순간이동합니다. D 또는 F.', cd: '60초' } : CH[key].skills[k];
        const tip = $('#tip');
        tip.innerHTML = `<strong></strong><em></em><span></span>`;
        tip.querySelector('strong').textContent = `${k === 'F' ? 'D' : k} · ${sk.n}`;
        tip.querySelector('em').textContent = sk.cd ? `재사용 ${sk.cd}` : '';
        tip.querySelector('span').textContent = sk.d;
        tip.hidden = false;
      });
      el.addEventListener('mouseleave', () => { hoverSlot = null; $('#tip').hidden = true; });
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

  let lastBuffs = '';
  function updateHud(me, s, en) {
    if (!me || me.hid) return;
    const cd = me.cd || { Q: 0, W: 0, E: 0, R: 0, F: 0 };
    const cm = me.cdm || { Q: 1, W: 1, E: 1, R: 1, F: 60 };
    const k = me.k;
    if (k === 'wind') {
      setSlot('Q', { rem: cd.Q, max: cm.Q, pips: [me.qs >= 1, me.qs >= 2], glow: me.qs >= 2 && cd.Q <= 0 });
      setSlot('W', { rem: cd.W, max: cm.W });
      setSlot('E', { rem: me.el > 0 ? me.el : cd.E, max: me.el > 0 ? 6 : cm.E, dim: me.el > 0, pips: [1, 2, 3, 4].map(i => me.es >= i) });
      setSlot('R', { rem: cd.R, max: cm.R, dim: !me.ur && cd.R <= 0, glow: !!me.ur });
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
      rtx.textContent = me.fl >= 1 ? '기류 가득 · 맞으면 보호막' : '기류 (움직이면 참)';
    } else {
      rb.hidden = !me.sp;
      if (me.sp) { rf.style.width = (me.sp.r / 5 * 100).toFixed(1) + '%'; rf.style.background = 'linear-gradient(#cfa8ff,#7d4fc9)'; rtx.textContent = `영혼해방 · 복귀 피해 ${me.sp.st}`; }
    }

    // 상태 표시
    const b = [];
    if (me.stun > 0) b.push(['bad', `기절 ${me.stun.toFixed(1)}`]);
    if (me.air > 0) b.push(['bad', '공중에 뜸']);
    if (me.slow > 0) b.push(['bad', `둔화 ${Math.round(me.slow * 100)}%`]);
    if (me.pen) b.push(['good', '방어구 관통']);
    if (me.buf > 0) b.push(['good', `공속 증가 ${me.buf.toFixed(0)}초`]);
    if (me.uns) b.push(['good', '저지 불가']);
    const bh = b.map(([c, t]) => `<span class="${c}">${t}</span>`).join('');
    if (bh !== lastBuffs) { $('#buffs').innerHTML = bh; lastBuffs = bh; }

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
    if (en && !en.hid) $('#foeHpFill').style.width = (Math.max(0, en.hp) / en.mh * 100).toFixed(1) + '%';
    $('#pingText').textContent = rtt == null ? '핑 -' : `핑 ${Math.round(rtt * 1000)}ms`;
    $('#waiting').hidden = !s.pz;
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
    dmg: 0.9, thrust: 0.24, circle: 0.38, cone: 0.34, gust: 0.4, swing: 0.2, block: 0.4, flash: 0.45,
    flowshield: 0.5, soulShield: 0.5, windUlt: 0.85, slam: 0.55, seal: 0.6, sealAim: 0.65, soulOut: 0.45, soulback: 0.45,
    soulmark: 0.9, shatter: 0.8, focus: 0.5, death: 1.2, hawk: 0.3, tornadoCast: 0.3, wallCast: 0.3, crystalCast: 0.3, dashE: 0.36, shoot: 0.15, volley: 0.3, respawn: 0.8,
  };
  const FX_SND = {
    thrust: 'thrust', tornadoCast: 'tornado', wallCast: 'wall', dashE: 'dash', windUlt: 'ult', slam: 'crit', circle: 'swing', swing: 'swing',
    shoot: 'arrow', volley: 'volley', crystalCast: 'crystal', shatter: 'shatter', hawk: 'hawk', focus: 'focus', cone: 'swing', gust: 'dash',
    sealAim: 'seal', seal: 'ult', soulOut: 'soul', soulback: 'soul', soulmark: 'crit', flowshield: 'shield', soulShield: 'shield', block: 'block', flash: 'flash', death: 'death',
  };
  function startFx(f, nowL) {
    f.t0 = nowL;
    f.dur = FX_DUR[f.k] || 0.4;
    if (f.k === 'dmg') {
      f.ox = (Math.random() - 0.5) * 70;
      f.oy = (Math.random() - 0.5) * 36;
      flashAt[f.s] = nowL;
      SFX.play(f.cr ? 'crit' : f.ty === 'magic' || f.ty === 'true' ? 'magic' : 'hit', 0.05);
    } else if (FX_SND[f.k]) SFX.play(FX_SND[f.k]);
    if (f.k === 'swing') swingAt[f.s] = nowL;
    if (f.k === 'death' && lastSnap && lastSnap.pr && f.s === mySlot) banner('쓰러짐<small>곧 다시 일어납니다</small>', 2, 'dead' + Math.random());
    if (f.k === 'death' && f.s === mySlot) P.tgt = null;
    if (f.k === 'respawn' && f.s === mySlot) P.init = false;
    fxs.push(f);
  }
  function takeFx(rt) {
    const nowL = performance.now() / 1000;
    while (fxQueue.length && fxQueue[0]._t <= rt) {
      const f = fxQueue.shift();
      if (f.k === 'round') { if (!lastSnap || !lastSnap.pr) banner(`${f.n} 라운드<small>준비</small>`, 1.4, 'r' + f.n); SFX.play('round'); P.init = false; P.tgt = null; continue; }
      if (f.k === 'fight') { banner('결투!', 0.9, 'fight' + Math.random()); continue; }
      if (f.k === 'roundEnd') {
        const title = f.w === -1 ? '무승부' : f.w === mySlot ? (f.over ? '결투 승리' : '라운드 승리') : (f.over ? '결투 패배' : '라운드 패배');
        banner(title, 2.4, 'end' + Math.random());
        continue;
      }
      startFx(f, nowL);
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
        ctx.strokeStyle = `rgba(150,90,230,${0.16 + 0.3 * p})`;
        ctx.lineWidth = 225;
        ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = `rgba(220,190,255,${0.6 * p + 0.2})`;
        ctx.lineWidth = 4;
        ctx.setLineDash([24, 18]);
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.restore();
      } else if (f.k === 'cone') {
        ctx.save();
        const g = ctx.createRadialGradient(f.x, f.y, 40, f.x, f.y, f.r);
        g.addColorStop(0, `rgba(179,131,242,${0.05 * fade})`);
        g.addColorStop(0.85, `rgba(200,150,255,${0.5 * fade})`);
        g.addColorStop(1, `rgba(240,220,255,${0.8 * fade})`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.arc(f.x, f.y, f.r * (0.6 + 0.4 * Math.min(1, p * 3)), f.a - f.arc / 2, f.a + f.arc / 2); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else if (f.k === 'circle') {
        ctx.save();
        ctx.strokeStyle = `rgba(190,250,240,${0.85 * fade})`;
        ctx.lineWidth = 20 * fade + 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.5 + 0.5 * p), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = `rgba(79,209,197,${0.14 * fade})`;
        ctx.fill();
        ctx.restore();
      } else if (f.k === 'slam' || f.k === 'shatter') {
        ctx.save();
        ctx.strokeStyle = f.k === 'slam' ? `rgba(220,250,255,${fade})` : `rgba(160,220,255,${fade})`;
        ctx.lineWidth = 9 * fade + 1;
        ctx.beginPath(); ctx.arc(f.x, f.y, 40 + 240 * p, 0, Math.PI * 2); ctx.stroke();
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
          const col = c && c.k === 'soul' ? '215,195,255' : '200,255,248';
          const ex = f.x + Math.cos(f.a) * f.l, ey = f.y + Math.sin(f.a) * f.l;
          ctx.strokeStyle = `rgba(${col},${0.85 * fade})`;
          ctx.lineCap = 'round';
          ctx.lineWidth = 64 * fade + 4;
          ctx.globalAlpha = 0.32;
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
          const k = Math.min(1, p * 2);
          ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + Math.cos(f.a) * 450 * k, f.y + Math.sin(f.a) * 450 * k); ctx.stroke();
          break;
        }
        case 'swing': {
          const c = f.s === mySlot ? meDraw : champBySlot(f.s);
          if (!c) break;
          ctx.strokeStyle = f.alt ? `rgba(200,150,255,${fade})` : `rgba(255,255,255,${0.85 * fade})`;
          ctx.lineWidth = 7;
          ctx.lineCap = 'round';
          const lift = liftOf(c);
          ctx.beginPath(); ctx.arc(c.x, c.y - lift, 98, f.a - 0.9 + p * 0.6, f.a + 0.5 + p * 0.6); ctx.stroke();
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
        case 'dashE': {
          const c = f.s === mySlot ? meDraw : champBySlot(f.s);
          if (!c) break;
          ctx.strokeStyle = `rgba(190,255,245,${0.7 * fade})`;
          ctx.lineWidth = 3;
          for (let i = -1; i <= 1; i++) {
            const a = c.f + Math.PI;
            ctx.beginPath();
            ctx.moveTo(c.x - Math.sin(c.f) * i * 16, c.y + Math.cos(c.f) * i * 16);
            ctx.lineTo(c.x + Math.cos(a) * 120 - Math.sin(c.f) * i * 16, c.y + Math.sin(a) * 120 + Math.cos(c.f) * i * 16);
            ctx.stroke();
          }
          break;
        }
        case 'flowshield': case 'soulShield': case 'focus': case 'soulOut': case 'soulback': case 'respawn': {
          const c = f.s === mySlot ? meDraw : champBySlot(f.s);
          const x = f.x != null ? f.x : c && c.x, y = f.y != null ? f.y : c && c.y;
          if (x == null) break;
          const col = f.k === 'flowshield' ? '235,245,255' : f.k === 'focus' ? '143,211,255' : f.k === 'respawn' ? '214,178,94' : '190,140,255';
          ctx.strokeStyle = `rgba(${col},${fade})`;
          ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(x, y, 40 + 45 * p, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'windUlt': {
          for (let i = 0; i < 6; i++) {
            if (p * 6 <= i) continue;
            const a = i * 1.05 + 0.4;
            ctx.strokeStyle = `rgba(230,255,252,${0.9 * fade})`;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(f.x - Math.cos(a) * 115, f.y - 60 - Math.sin(a) * 115);
            ctx.lineTo(f.x + Math.cos(a) * 115, f.y - 60 + Math.sin(a) * 115);
            ctx.stroke();
          }
          break;
        }
        case 'seal': {
          ctx.strokeStyle = `rgba(170,110,255,${fade})`;
          ctx.lineWidth = 16 * fade + 2;
          ctx.shadowColor = '#b98cff'; ctx.shadowBlur = 22;
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
          for (let i = 0; i < 14; i++) {
            const a = i / 14 * Math.PI * 2;
            const d = 30 + 170 * p;
            ctx.fillStyle = `rgba(200,240,255,${fade})`;
            ctx.save();
            ctx.translate(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d);
            ctx.rotate(a + p * 4);
            ctx.fillRect(-8, -3, 16, 6);
            ctx.restore();
          }
          break;
        }
        case 'death': {
          ctx.fillStyle = `rgba(10,10,14,${0.6 * fade})`;
          ctx.beginPath(); ctx.arc(f.x, f.y, 60 + 70 * p, 0, Math.PI * 2); ctx.fill();
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
      const sz = (big ? 36 : 25) * (p < 0.12 ? 1 + (0.12 - p) * 4 : 1);
      const col = f.ty === 'true' ? '#ffffff' : f.ty === 'magic' ? '#c39cff' : big ? '#ff9d3b' : '#f6d27a';
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - p) * 2);
      ctx.font = `700 ${sz}px "Chakra Petch", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      const x = f.x + f.ox, y = f.y - 140 + (f.oy || 0) - p * 60;
      const txt = f.v + (big ? '!' : '');
      ctx.strokeText(txt, x, y);
      ctx.fillStyle = col;
      ctx.fillText(txt, x, y);
      ctx.restore();
    }
  }

  // 롤처럼 클릭한 자리에 초록(이동) / 빨강(공격) 화살표가 모였다가 사라진다
  function drawMarkers(nowL) {
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i];
      const age = nowL - m.t, dur = m.small ? 0.3 : 0.45;
      if (age > dur) { markers.splice(i, 1); continue; }
      const p = age / dur;
      const col = m.atk ? '255,90,80' : '70,255,120';
      const size = m.small ? 0.75 : 1.35;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.scale(1, 0.62);
      ctx.globalAlpha = 1 - p * p;
      ctx.shadowColor = `rgb(${col})`; ctx.shadowBlur = 12;
      ctx.strokeStyle = `rgb(${col})`;
      ctx.fillStyle = `rgba(${col},0.95)`;
      ctx.lineWidth = 4;
      const R = (12 + 38 * (1 - p)) * size;
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + k * Math.PI / 2;
        const cx = Math.cos(a) * R, cy = Math.sin(a) * R;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a + Math.PI);
        ctx.beginPath(); ctx.moveTo(10 * size, 0); ctx.lineTo(-6 * size, -9 * size); ctx.lineTo(-2 * size, 0); ctx.lineTo(-6 * size, 9 * size); ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      if (!m.small) {
        ctx.lineWidth = 3;
        ctx.globalAlpha *= 0.8;
        ctx.beginPath(); ctx.arc(0, 0, 10 + 30 * p, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ───────────────────────── 월드 그리기
  function liftOf(c) {
    if (!c) return 0;
    if (c.ult) return 70;
    if (c.air > 0) return 46 * Math.min(1, c.air * 3);
    return 0;
  }

  function drawChampFull(c, nowL, isMe) {
    if (c.hid) return;
    const lift = liftOf(c);
    if (c.dead) {
      drawChamp(ctx, c.k, c.x, c.y, c.f, { alpha: 0.25, time: nowL });
      return;
    }
    if (c.sp) {
      ctx.save();
      ctx.strokeStyle = 'rgba(190,140,255,0.55)';
      ctx.setLineDash([10, 10]);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(c.sp.bx, c.sp.by); ctx.lineTo(c.x, c.y); ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.filter = 'grayscale(0.85) brightness(0.65)';
      drawChamp(ctx, c.k, c.sp.bx, c.sp.by, c.f, { alpha: 0.8, time: 0 });
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = 'rgba(200,160,255,0.95)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(c.sp.bx, c.sp.by, 54, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (c.sp.r / 5)); ctx.stroke();
      // 몸 위에 표시(영상의 노란 삼각 표시처럼)
      ctx.fillStyle = 'rgba(240,220,140,0.9)';
      ctx.beginPath(); ctx.moveTo(c.sp.bx - 12, c.sp.by - 92); ctx.lineTo(c.sp.bx + 12, c.sp.by - 92); ctx.lineTo(c.sp.bx, c.sp.by - 70); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.save();
    if (c.slow) {
      ctx.strokeStyle = 'rgba(143,211,255,0.75)';
      ctx.lineWidth = 4;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.ellipse(c.x, c.y + 4, 54, 34, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (c.qs >= 2 && (c.k === 'wind' || c.k === 'soul')) {
      // Q 2중첩: 발밑에서 바람이 솟는다
      const col = c.k === 'wind' ? '170,250,240' : '200,180,255';
      for (let i = 0; i < 3; i++) {
        const a = nowL * 5 + i * 2.1;
        ctx.strokeStyle = `rgba(${col},0.8)`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.ellipse(c.x, c.y - i * 6, 60, 37, 0, a, a + 1.4); ctx.stroke();
      }
    }
    ctx.restore();

    const sw = nowL - swingAt[c.s];
    const swing = sw < 0.2 ? Math.sin(sw / 0.2 * Math.PI) * 0.9 : 0;
    const drawBow = c.k === 'frost' && (c.aw || (c.cast && (c.cast.k === 'W' || c.cast.k === 'R'))) ? 1 : 0;
    if (c.sp) {
      ctx.save();
      const g = ctx.createRadialGradient(c.x, c.y - lift, 10, c.x, c.y - lift, 85);
      g.addColorStop(0, 'rgba(190,140,255,0.45)');
      g.addColorStop(1, 'rgba(190,140,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c.x, c.y - lift, 85, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (c.uns) {
      ctx.save();
      ctx.strokeStyle = 'rgba(214,178,94,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(c.x, c.y - lift, 48, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // 걷는 모션
    let walk = 0, moving = false;
    if (isMe) { walk = P.walk; moving = P.moving; }
    else {
      const lp = lastPos[c.s];
      const d = lp ? hyp(c.x - lp.x, c.y - lp.y) : 0;
      moving = d > 0.6;
      if (moving) walkPh[c.s] += 1 / 60;
      walk = walkPh[c.s];
      lastPos[c.s] = { x: c.x, y: c.y };
    }
    const fl = Math.max(0, 1 - (nowL - flashAt[c.s]) / 0.15);
    drawChamp(ctx, c.k, c.x, c.y, c.f, {
      lift, time: nowL, ring: isMe ? COL.ally : COL.enemy, swing, draw: drawBow, alpha: c.sp ? 0.85 : 1, walk, moving, flash: fl,
    });
    if (c.sh > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(235,245,255,0.12)';
      ctx.strokeStyle = 'rgba(235,245,255,0.75)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(c.x, c.y - lift, 50, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    if (c.cast && c.cast.k === 'R' && c.k === 'soul') {
      ctx.save();
      ctx.strokeStyle = 'rgba(200,150,255,0.95)';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(c.x, c.y - lift, 60, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.cast.p); ctx.stroke();
      ctx.restore();
    }
    if (c.stun > 0) {
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const a = nowL * 4 + i * 2.09;
        const x = c.x + Math.cos(a) * 34, y = c.y - lift - 60 + Math.sin(a) * 10;
        ctx.fillStyle = '#ffe08a';
        ctx.beginPath();
        for (let j = 0; j < 10; j++) {
          const rr = j % 2 ? 4 : 9;
          ctx.lineTo(x + Math.cos(j * Math.PI / 5) * rr, y + Math.sin(j * Math.PI / 5) * rr);
        }
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = 'rgba(170,225,255,0.3)';
      ctx.strokeStyle = 'rgba(210,240,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let j = 0; j < 6; j++) ctx.lineTo(c.x + Math.cos(j * Math.PI / 3 + 0.3) * 52, c.y - lift + Math.sin(j * Math.PI / 3 + 0.3) * 52);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  function drawBars(c, isMe) {
    if (c.hid || c.dead) return;
    const lift = liftOf(c);
    const w = 132, h = 14;
    const x = c.x - w / 2, y = c.y - lift - 104;
    ctx.save();
    ctx.fillStyle = 'rgba(5,8,12,0.88)';
    const hasRes = c.k !== 'soul' || c.sp;
    ctx.fillRect(x - 3, y - 3, w + 6, h + (hasRes ? 13 : 6));
    const hpw = w * Math.max(0, c.hp / c.mh);
    const hg = ctx.createLinearGradient(0, y, 0, y + h);
    if (isMe) { hg.addColorStop(0, '#7be6a6'); hg.addColorStop(1, '#2f9e62'); } else { hg.addColorStop(0, '#ff7b6e'); hg.addColorStop(1, '#b8322f'); }
    ctx.fillStyle = hg;
    ctx.fillRect(x, y, hpw, h);
    if (c.sh > 0) {
      ctx.fillStyle = 'rgba(240,244,248,0.92)';
      ctx.fillRect(x + hpw, y, Math.min(w - hpw, w * c.sh / c.mh), h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let v = 100; v < c.mh; v += 100) {
      const tx = x + w * v / c.mh;
      ctx.fillRect(tx, y, v % 1000 === 0 ? 2 : 1, v % 1000 === 0 ? h : h * 0.55);
    }
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
    // Q 중첩 점
    if ((c.k === 'wind' || c.k === 'soul') && c.qs > 0) {
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = i < c.qs ? (c.k === 'wind' ? '#7ff0e2' : '#cfb2ff') : 'rgba(255,255,255,0.15)';
        ctx.beginPath(); ctx.arc(x - 12, y + 4 + i * 8 - 4, 3.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawProj(p, nowL) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.k === 'arrow' || p.k === 'volley') {
      ctx.rotate(p.a);
      ctx.strokeStyle = 'rgba(143,211,255,0.35)';
      ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(-64, 0); ctx.lineTo(-30, 0); ctx.stroke();
      ctx.strokeStyle = p.k === 'volley' ? '#d6f1ff' : '#bfe8ff';
      ctx.lineWidth = p.k === 'volley' ? 3.5 : 4;
      ctx.beginPath(); ctx.moveTo(-34, 0); ctx.lineTo(8, 0); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(2, -6); ctx.lineTo(2, 6); ctx.closePath(); ctx.fill();
    } else if (p.k === 'tornado') {
      for (let i = 0; i < 5; i++) {
        const a = nowL * 12 + i * 1.3;
        ctx.strokeStyle = `rgba(${i % 2 ? '225,255,250' : '120,220,210'},0.85)`;
        ctx.lineWidth = 7 - i;
        ctx.beginPath(); ctx.ellipse(0, -i * 16, 92 - i * 13, 50 - i * 7, 0, a, a + 3.4); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(160,240,230,0.12)';
      ctx.beginPath(); ctx.ellipse(0, 0, 95, 52, 0, 0, Math.PI * 2); ctx.fill();
    } else if (p.k === 'crystal') {
      ctx.rotate(p.a);
      const tg = ctx.createLinearGradient(-260, 0, -30, 0);
      tg.addColorStop(0, 'rgba(143,211,255,0)');
      tg.addColorStop(1, 'rgba(143,211,255,0.5)');
      ctx.strokeStyle = tg;
      ctx.lineWidth = 56;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-260, 0); ctx.lineTo(-40, 0); ctx.stroke();
      ctx.rotate(nowL * 6);
      const g = ctx.createLinearGradient(-40, -40, 40, 40);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#5aa8e0');
      ctx.fillStyle = g;
      ctx.shadowColor = '#9fdcff'; ctx.shadowBlur = 30;
      ctx.beginPath(); ctx.moveTo(0, -58); ctx.lineTo(32, 0); ctx.lineTo(0, 58); ctx.lineTo(-32, 0); ctx.closePath(); ctx.fill();
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
    const g = ctx.createLinearGradient(0, -28, 0, 28);
    g.addColorStop(0, 'rgba(180,255,245,0)');
    g.addColorStop(0.5, 'rgba(180,255,245,0.5)');
    g.addColorStop(1, 'rgba(180,255,245,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-w.h, -28, w.h * 2, 56);
    ctx.strokeStyle = 'rgba(230,255,252,0.85)';
    ctx.lineWidth = 2.5;
    for (let i = -w.h; i < w.h; i += 22) {
      const o = ((nowL * 90 + i) % 44) - 22;
      ctx.beginPath(); ctx.moveTo(i, -24 + o * 0.3); ctx.quadraticCurveTo(i + 8, 0, i, 24 - o * 0.3); ctx.stroke();
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

  function drawAmbient(nowL, dt) {
    // 화로 불빛
    for (let i = 0; i < BRAZIERS.length; i++) {
      const [x, y] = BRAZIERS[i];
      const fl = 0.85 + Math.sin(nowL * 9 + i * 2) * 0.08 + Math.sin(nowL * 23 + i) * 0.05;
      const g = ctx.createRadialGradient(x, y, 4, x, y, 230 * fl);
      g.addColorStop(0, 'rgba(255,190,90,0.35)');
      g.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 230 * fl, 0, Math.PI * 2); ctx.fill();
      for (let j = 0; j < 3; j++) {
        const h = 26 + Math.sin(nowL * 12 + j * 2 + i) * 6;
        ctx.fillStyle = j === 0 ? '#ffcf6a' : j === 1 ? '#ff8a3c' : '#fff1b8';
        ctx.beginPath();
        ctx.moveTo(x - 14 + j * 9, y);
        ctx.quadraticCurveTo(x - 10 + j * 9, y - h * 0.6, x - 5 + j * 6 + Math.sin(nowL * 7 + j) * 3, y - h);
        ctx.quadraticCurveTo(x + j * 4, y - h * 0.5, x + 4 + j * 4, y);
        ctx.closePath(); ctx.fill();
      }
    }
    // 떠다니는 먼지
    ctx.fillStyle = 'rgba(220,235,225,0.35)';
    for (const m of motes) {
      m.x += m.v * dt; m.y += Math.sin(nowL + m.p) * 6 * dt;
      if (m.x > ARENA.w) m.x = 0;
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(nowL * 1.3 + m.p);
      ctx.beginPath(); ctx.arc(m.x, m.y, m.s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFog(me, hawks) {
    const fs = 0.5;
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, fogC.width, fogC.height);
    fctx.fillStyle = 'rgba(3,6,10,0.72)';
    fctx.fillRect(0, 0, fogC.width, fogC.height);
    fctx.globalCompositeOperation = 'destination-out';
    const hole = (wx, wy, r) => {
      const sx = (W / 2 + (wx - cam.x) * scale) * fs, sy = (H / 2 + (wy - cam.y) * scale) * fs, sr = r * scale * fs;
      const g = fctx.createRadialGradient(sx, sy, sr * 0.8, sx, sy, sr);
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
      const cc = c.s === mySlot && me ? me : c;
      if (cc.hid || cc.dead) continue;
      g.fillStyle = c.s === mySlot ? COL.ally : COL.enemy;
      g.beginPath(); g.arc(cc.x * k, cc.y * k, 6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 1;
    g.strokeRect((cam.x - W / 2 / scale) * k, (cam.y - H / 2 / scale) * k, W / scale * k, H / scale * k);
  }

  // 스킬 칸에 마우스를 올리면 사거리를 보여준다
  const RANGES = {
    wind: { Q: 475, W: 400, E: 475, R: 1400, F: 400 },
    soul: { Q: 450, W: 600, E: 300, R: 1000, F: 400 },
    frost: { Q: 600, W: 1200, E: 0, R: 0, F: 400 },
  };

  let meDraw = null, vignette = null;
  let lastFrame = performance.now() / 1000;
  function frame() {
    requestAnimationFrame(frame);
    const nowL = performance.now() / 1000;
    const dt = Math.min(0.05, nowL - lastFrame);
    lastFrame = nowL;
    if (!inGame || !snaps.length || !W) { if (inGame && !W) resize(); return; }
    const rt = nowL + offset - INTERP;
    view = buildView(rt);
    takeFx(rt);
    const s = lastSnap;
    meDraw = predictMe(nowL, dt);
    const en = view.champs.find(c => c.s !== mySlot);
    // 화면용 목록: 나는 예측 위치, 상대는 보간 위치
    const champs = view.champs.map(c => (c.s === mySlot && meDraw ? meDraw : c));

    if (meDraw) {
      const k = 1 - Math.exp(-dt * 10);
      cam.x += (meDraw.x - cam.x) * k;
      cam.y += (meDraw.y - cam.y) * k;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * (W / 2 - cam.x * scale), DPR * (H / 2 - cam.y * scale));
    ctx.drawImage(ground, 0, 0, ARENA.w, ARENA.h);
    drawAmbient(nowL, dt);

    // 내 사거리(평타)와 스킬 사거리 미리보기
    if (meDraw && !meDraw.dead) {
      ctx.save();
      ctx.strokeStyle = 'rgba(214,178,94,0.13)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(meDraw.x, meDraw.y, meDraw.k === 'frost' ? 600 + 32 : 175 + 34, 0, Math.PI * 2); ctx.stroke();
      if (hoverSlot) {
        let r = RANGES[meDraw.k][hoverSlot];
        if (meDraw.k === 'wind' && hoverSlot === 'Q' && meDraw.qs >= 2) r = 1150;
        if (r) {
          ctx.strokeStyle = 'rgba(120,200,255,0.75)';
          ctx.fillStyle = 'rgba(120,200,255,0.06)';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(meDraw.x, meDraw.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
    }

    drawMarkers(nowL);
    drawFxUnder(nowL);
    for (const w of view.walls) drawWall(w, nowL);
    // 야스오 E 사거리 안의 적에게 표시
    if (meDraw && meDraw.k === 'wind' && en && !en.hid && !en.dead && !(meDraw.el > 0) && hyp(en.x - meDraw.x, en.y - meDraw.y) <= 475 + 68) {
      ctx.save();
      ctx.strokeStyle = 'rgba(127,240,226,0.6)';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 8]);
      ctx.lineDashOffset = -nowL * 30;
      ctx.beginPath(); ctx.ellipse(en.x, en.y + 6, 60, 38, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    const order = champs.slice().sort((a, b) => (a.y || 0) - (b.y || 0));
    for (const c of order) drawChampFull(c, nowL, c.s === mySlot);
    for (const p of view.projs) drawProj(p, nowL);
    for (const h of view.hawks) drawHawk(h, nowL);
    drawFxOver(nowL);

    // 야스오 궁 가능 화살표
    if (meS && meS.ur && en && !en.hid && meDraw) {
      ctx.save();
      const a = Math.atan2(en.y - meDraw.y, en.x - meDraw.x);
      ctx.translate(meDraw.x + Math.cos(a) * 95, meDraw.y + Math.sin(a) * 95);
      ctx.rotate(a);
      ctx.fillStyle = 'rgba(214,178,94,0.95)';
      ctx.shadowColor = '#ffd77a'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(28, 0); ctx.lineTo(-8, -17); ctx.lineTo(-2, 0); ctx.lineTo(-8, 17); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    drawFog(meDraw, view.hawks);
    // 화면 가장자리 어둡게
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!vignette || vignette.w !== cv.width || vignette.h !== cv.height) {
      const vg = ctx.createRadialGradient(cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.35, cv.width / 2, cv.height / 2, Math.max(cv.width, cv.height) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      vignette = { g: vg, w: cv.width, h: cv.height };
    }
    ctx.fillStyle = vignette.g;
    ctx.fillRect(0, 0, cv.width, cv.height);
    // 맞으면 화면 테두리가 붉게
    const hurt = Math.max(0, 1 - (nowL - flashAt[mySlot]) / 0.35);
    if (hurt > 0) {
      ctx.strokeStyle = `rgba(220,40,40,${0.35 * hurt})`;
      ctx.lineWidth = 40 * DPR;
      ctx.strokeRect(0, 0, cv.width, cv.height);
    }
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * (W / 2 - cam.x * scale), DPR * (H / 2 - cam.y * scale));
    for (const c of order) drawBars(c, c.s === mySlot);
    drawDmgNumbers(nowL);

    drawMini(view, meDraw);
    updateHud(meS, s, s.ch.find(c => c.s !== mySlot));

    if (s.ph === 'countdown' && s.pu < 3.05) {
      const n = Math.max(1, Math.ceil(s.pu));
      banner(`${n}<small>${s.pr ? '연습' : s.rd + ' 라운드'}</small>`, 0.3, 'cd' + n);
    }
    if (nowL > bannerUntil) $('#banner').hidden = true;
  }
  requestAnimationFrame(frame);

  // 테스트용: 화면 좌표
  window.__duel = {
    enemyScreen() {
      const en = view && view.champs.find(c => c.s !== mySlot && !c.hid);
      if (!en) return null;
      return { x: W / 2 + (en.x - cam.x) * scale, y: H / 2 + (en.y - cam.y) * scale };
    },
    meScreen() { return meDraw ? { x: W / 2 + (meDraw.x - cam.x) * scale, y: H / 2 + (meDraw.y - cam.y) * scale } : null; },
    state() { return { me: meS, rtt, pred: meDraw && { x: meDraw.x, y: meDraw.y } }; },
  };
})();
