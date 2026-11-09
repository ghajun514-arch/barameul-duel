'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

// 폴더(game/, public/)로 올려도, 파일을 한 곳에 모아 올려도 둘 다 동작
const nested = fs.existsSync(path.join(__dirname, 'game', 'sim.js'));
const { Game } = require(nested ? './game/sim' : './sim');

const PORT = process.env.PORT || 3000;
const PUB = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;
const PUBLIC_FILES = new Set(['/index.html', '/style.css', '/art.js', '/client.js', '/sound.js']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { res.writeHead(400); res.end(); return; }
  if (p === '/') p = '/index.html';
  if (p === '/health') { res.writeHead(200); res.end('ok'); return; }
  if (!PUBLIC_FILES.has(p)) { res.writeHead(404); res.end('not found'); return; }
  fs.readFile(path.join(PUB, p), (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const io = new Server(server, { pingInterval: 3000, pingTimeout: 6000 });
const rooms = new Map();      // code → room
const sessions = new Map();   // token → { code }
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CHAMP_KEYS = ['wind', 'soul', 'frost'];
const TICK = 1 / 60;
const SNAP = 1 / 30;
const GRACE_GAME = 25;        // 게임 중 끊겼을 때 기다리는 시간(초)
const GRACE_LOBBY = 8;
// 테스트용: FAKE_LAG_MS=100 으로 켜면 왕복 지연을 흉내 낸다
const LAG = Number(process.env.FAKE_LAG_MS || 0);
const later = fn => (LAG ? setTimeout(fn, LAG / 2) : fn());

function makeCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const cleanName = n => String(n || '').replace(/[<>&"']/g, '').trim().slice(0, 12) || '소환사';
const newToken = () => crypto.randomBytes(12).toString('hex');
const humans = room => room.players.filter(p => !p.bot);

function roomView(room, forToken) {
  return {
    code: room.code,
    mode: room.mode,
    state: room.state,
    players: room.players.map(p => ({ name: p.name, champ: p.champ, ready: p.ready, bot: !!p.bot, offline: !!p.offline, you: p.token === forToken })),
  };
}
function sendRoom(room) {
  for (const p of room.players) if (p.socket) p.socket.emit('room', roomView(room, p.token));
}
function notify(room, msg, exceptToken) {
  for (const p of room.players) if (p.socket && p.token !== exceptToken) p.socket.emit('notice', msg);
}
function attach(socket, room, p) {
  p.socket = socket;
  p.offline = false;
  if (p.dropTimer) { clearTimeout(p.dropTimer); p.dropTimer = null; }
  socket.data.token = p.token;
  socket.data.room = room.code;
  socket.emit('session', { token: p.token, code: room.code });
}

function startPayload(room, slot) {
  return { slot, players: room.players.map(q => ({ name: q.name, champ: q.champ, bot: !!q.bot })), mode: room.mode };
}

function startGame(room) {
  room.state = 'game';
  const opts = { practice: room.mode === 'dummy', rounds: 3 };
  room.game = new Game(room.players.map(p => ({ name: p.name, champ: p.champ, bot: p.bot })), opts);
  room.players.forEach((p, i) => { if (p.socket) p.socket.emit('start', startPayload(room, i)); });
  room.fxBuf = [];
  let last = process.hrtime.bigint();
  let acc = 0, snapAcc = 0;
  room.loop = setInterval(() => {
    const g = room.game;
    if (!g) return;
    const now = process.hrtime.bigint();
    let el = Number(now - last) / 1e9;
    last = now;
    if (el > 0.25) el = 0.25;            // 서버가 잠깐 멈춰도 한꺼번에 따라잡지 않는다
    const paused = room.players.some(p => !p.bot && p.offline);
    if (!paused) {
      acc += el;
      while (acc >= TICK) { g.tick(TICK); acc -= TICK; }
    }
    if (g.fx.length) { room.fxBuf.push(...g.fx); g.fx = []; }
    snapAcc += el;
    if (snapAcc >= SNAP) {
      snapAcc = Math.min(snapAcc - SNAP, SNAP);
      const fx = room.fxBuf; room.fxBuf = [];
      room.players.forEach((p, i) => {
        if (!p.socket) return;
        const s = g.snapshot(i, fx);
        s.pz = paused ? 1 : 0;
        const sock = p.socket;
        later(() => sock.emit('snap', s));
      });
      if (g.phase === 'over') endGame(room, true);
    }
  }, 1000 / 60);
}

function endGame(room, finished) {
  if (room.loop) clearInterval(room.loop);
  room.loop = null;
  const g = room.game;
  room.game = null;
  room.state = 'lobby';
  for (const p of room.players) p.ready = !!p.bot;
  if (finished && g) {
    room.players.forEach((p, i) => { if (p.socket) p.socket.emit('end', { winner: g.winner, you: i, score: g.score, names: room.players.map(q => q.name) }); });
  }
  sendRoom(room);
}

function removePlayer(room, token, reason) {
  const idx = room.players.findIndex(p => p.token === token);
  if (idx < 0) return;
  const p = room.players[idx];
  if (p.dropTimer) clearTimeout(p.dropTimer);
  sessions.delete(token);
  if (p.socket) { p.socket.data.room = null; p.socket.data.token = null; }
  if (room.state === 'game') endGame(room, false);
  room.players.splice(idx, 1);
  if (!humans(room).length) {
    if (room.loop) clearInterval(room.loop);
    rooms.delete(room.code);
    return;
  }
  if (reason) notify(room, reason);
  sendRoom(room);
}

function leave(socket) {
  const room = rooms.get(socket.data.room);
  if (!room) return;
  removePlayer(room, socket.data.token, '상대가 방을 나갔어요.');
}

io.on('connection', socket => {
  socket.data.room = null;
  socket.data.token = null;
  let winStart = 0, winCount = 0;

  socket.on('png', (_, ack) => { if (typeof ack === 'function') later(() => later(ack)); });

  socket.on('rejoin', ({ token } = {}) => {
    const s = sessions.get(String(token || ''));
    const room = s && rooms.get(s.code);
    const p = room && room.players.find(q => q.token === token);
    if (!p) { socket.emit('rejoinFail'); return; }
    if (p.socket && p.socket !== socket) p.socket.disconnect(true);
    attach(socket, room, p);
    sendRoom(room);
    if (room.state === 'game' && room.game) {
      socket.emit('start', startPayload(room, room.players.indexOf(p)));
      notify(room, `${p.name} 님이 다시 접속했어요.`, p.token);
    }
  });

  function createRoom(name, mode) {
    leave(socket);
    const code = makeCode();
    const p = { token: newToken(), socket: null, name: cleanName(name), champ: 'wind', ready: false };
    const room = { code, mode, state: 'lobby', players: [p], game: null, loop: null };
    if (mode !== 'duel') room.players.push({ token: 'bot-' + code, socket: null, name: mode === 'ai' ? '컴퓨터' : '허수아비', champ: 'frost', ready: true, bot: mode === 'ai' ? 'ai' : 'dummy' });
    rooms.set(code, room);
    sessions.set(p.token, { code });
    attach(socket, room, p);
    if (mode === 'duel') socket.join(code);
    sendRoom(room);
  }

  socket.on('create', ({ name } = {}) => createRoom(name, 'duel'));
  socket.on('practice', ({ name, mode } = {}) => createRoom(name, mode === 'ai' ? 'ai' : 'dummy'));

  socket.on('setBot', ({ mode } = {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.state !== 'lobby' || room.mode === 'duel') return;
    room.mode = mode === 'ai' ? 'ai' : 'dummy';
    const b = room.players[1];
    b.bot = room.mode === 'ai' ? 'ai' : 'dummy';
    b.name = room.mode === 'ai' ? '컴퓨터' : '허수아비';
    sendRoom(room);
  });

  socket.on('join', ({ code, name } = {}) => {
    code = String(code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.mode !== 'duel') { socket.emit('err', '그 코드의 방이 없어요. 코드를 다시 확인해 주세요.'); return; }
    if (room.players.length >= 2) { socket.emit('err', '방이 꽉 찼어요.'); return; }
    if (room.state !== 'lobby') { socket.emit('err', '이미 게임이 진행 중인 방이에요.'); return; }
    leave(socket);
    const p = { token: newToken(), socket: null, name: cleanName(name), champ: room.players[0].champ === 'frost' ? 'wind' : 'frost', ready: false };
    room.players.push(p);
    sessions.set(p.token, { code });
    attach(socket, room, p);
    socket.join(code);
    sendRoom(room);
  });

  socket.on('pick', ({ champ, bot } = {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.state !== 'lobby' || !CHAMP_KEYS.includes(champ)) return;
    if (bot && room.mode !== 'duel') { room.players[1].champ = champ; sendRoom(room); return; }
    const p = room.players.find(q => q.token === socket.data.token);
    if (!p) return;
    p.champ = champ;
    p.ready = false;
    sendRoom(room);
  });

  socket.on('ready', ({ ready } = {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.state !== 'lobby') return;
    const p = room.players.find(q => q.token === socket.data.token);
    if (!p) return;
    p.ready = !!ready;
    sendRoom(room);
    if (room.players.length === 2 && room.players.every(q => q.ready && !q.offline)) startGame(room);
  });

  socket.on('input', m => {
    const now = Date.now();
    if (now - winStart > 1000) { winStart = now; winCount = 0; }
    if (++winCount > 80) return;   // 초당 80개 넘는 입력은 버린다
    const room = rooms.get(socket.data.room);
    if (!room || !room.game) return;
    const slot = room.players.findIndex(p => p.token === socket.data.token);
    if (slot >= 0) later(() => { if (room.game) room.game.input(slot, m); });
  });

  socket.on('quit', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.state !== 'game') return;
    const p = room.players.find(q => q.token === socket.data.token);
    notify(room, `${p ? p.name : '상대'} 님이 결투를 그만뒀어요.`, socket.data.token);
    endGame(room, false);
  });

  socket.on('leave', () => leave(socket));

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    const p = room.players.find(q => q.token === socket.data.token);
    if (!p || p.socket !== socket) return;
    p.socket = null;
    p.offline = true;
    const grace = room.state === 'game' ? GRACE_GAME : GRACE_LOBBY;
    if (room.state === 'game') notify(room, `${p.name} 님 연결이 끊겼어요. 다시 들어올 때까지 게임을 멈춥니다.`);
    sendRoom(room);
    p.dropTimer = setTimeout(() => {
      if (!p.offline) return;
      removePlayer(room, p.token, `${p.name} 님이 돌아오지 않아 방에서 나갔어요.`);
    }, grace * 1000);
  });
});

server.listen(PORT, () => console.log(`결투장 서버 실행 중: http://localhost:${PORT}`));
