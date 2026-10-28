'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
// 폴더(game/, public/)로 올려도, 파일을 한 곳에 모아 올려도 둘 다 동작
const nested = fs.existsSync(path.join(__dirname, 'game', 'sim.js'));
const { Game } = require(nested ? './game/sim' : './sim');

const PORT = process.env.PORT || 3000;
const PUB = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;
const PUBLIC_FILES = new Set(['/index.html', '/style.css', '/art.js', '/client.js']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/health') { res.writeHead(200); res.end('ok'); return; }
  if (!PUBLIC_FILES.has(p)) { res.writeHead(404); res.end('not found'); return; }
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const io = new Server(server, { pingInterval: 5000, pingTimeout: 8000 });
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CHAMP_KEYS = ['wind', 'soul', 'frost'];
const TICK = 1 / 60;

function makeCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const cleanName = n => String(n || '').replace(/[<>]/g, '').trim().slice(0, 12) || '이름없음';

function roomView(room, forId) {
  return {
    code: room.code,
    practice: room.practice,
    state: room.state,
    players: room.players.map(p => p && { name: p.name, champ: p.champ, ready: p.ready, bot: !!p.bot, you: p.id === forId }),
  };
}
function sendRoom(room) {
  for (const p of room.players) if (p && p.socket) p.socket.emit('room', roomView(room, p.id));
}

function startGame(room) {
  room.state = 'game';
  room.game = new Game(room.players.map(p => ({ name: p.name, champ: p.champ, bot: p.bot })), { practice: room.practice, rounds: 3 });
  room.players.forEach((p, i) => {
    if (p.socket) p.socket.emit('start', { slot: i, players: room.players.map(q => ({ name: q.name, champ: q.champ, bot: !!q.bot })), practice: room.practice });
  });
  let n = 0;
  room.loop = setInterval(() => {
    const g = room.game;
    if (!g) return;
    g.tick(TICK);
    if (++n % 2 === 0) {
      const fx = g.fx; g.fx = [];
      room.players.forEach((p, i) => { if (p.socket) p.socket.volatile.emit('snap', g.snapshot(i, fx)); });
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
  for (const p of room.players) if (p) p.ready = !!p.bot;
  if (finished && g) {
    room.players.forEach((p, i) => { if (p.socket) p.socket.emit('end', { winner: g.winner, you: i, score: g.score, names: room.players.map(q => q.name) }); });
  }
  sendRoom(room);
}

function leave(socket) {
  const room = rooms.get(socket.data.room);
  socket.data.room = null;
  if (!room) return;
  const idx = room.players.findIndex(p => p && p.id === socket.id);
  if (idx < 0) return;
  socket.leave(room.code);
  if (room.state === 'game') endGame(room, false);
  room.players.splice(idx, 1);
  if (!room.players.some(p => p && !p.bot)) {
    if (room.loop) clearInterval(room.loop);
    rooms.delete(room.code);
    return;
  }
  for (const p of room.players) if (p && p.socket) p.socket.emit('notice', '상대가 방을 나갔어요.');
  sendRoom(room);
}

io.on('connection', socket => {
  socket.data.room = null;
  let lastInput = 0, burst = 0;

  socket.on('create', ({ name } = {}) => {
    leave(socket);
    const code = makeCode();
    const room = { code, practice: false, state: 'lobby', players: [{ id: socket.id, socket, name: cleanName(name), champ: 'wind', ready: false }], game: null, loop: null };
    rooms.set(code, room);
    socket.data.room = code;
    socket.join(code);
    sendRoom(room);
  });

  socket.on('practice', ({ name } = {}) => {
    leave(socket);
    const code = makeCode();
    const room = {
      code, practice: true, state: 'lobby', game: null, loop: null,
      players: [
        { id: socket.id, socket, name: cleanName(name), champ: 'wind', ready: false },
        { id: 'bot', socket: null, name: '연습 상대', champ: 'frost', ready: true, bot: true },
      ],
    };
    rooms.set(code, room);
    socket.data.room = code;
    sendRoom(room);
  });

  socket.on('join', ({ code, name } = {}) => {
    code = String(code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.practice) { socket.emit('err', '그 코드의 방이 없어요. 코드를 다시 확인해 주세요.'); return; }
    if (room.players.length >= 2) { socket.emit('err', '방이 꽉 찼어요.'); return; }
    if (room.state !== 'lobby') { socket.emit('err', '이미 게임이 진행 중인 방이에요.'); return; }
    leave(socket);
    room.players.push({ id: socket.id, socket, name: cleanName(name), champ: 'frost', ready: false });
    socket.data.room = code;
    socket.join(code);
    sendRoom(room);
  });

  socket.on('pick', ({ champ, bot } = {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.state !== 'lobby' || !CHAMP_KEYS.includes(champ)) return;
    if (bot && room.practice) { room.players[1].champ = champ; sendRoom(room); return; }
    const p = room.players.find(q => q.id === socket.id);
    if (!p) return;
    p.champ = champ;
    p.ready = false;
    sendRoom(room);
  });

  socket.on('ready', ({ ready } = {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.state !== 'lobby') return;
    const p = room.players.find(q => q.id === socket.id);
    if (!p) return;
    p.ready = !!ready;
    sendRoom(room);
    if (room.players.length === 2 && room.players.every(q => q.ready)) startGame(room);
  });

  socket.on('input', m => {
    const now = Date.now();
    if (now - lastInput < 1000) { if (++burst > 60) return; } else { burst = 0; lastInput = now; }
    const room = rooms.get(socket.data.room);
    if (!room || !room.game) return;
    const slot = room.players.findIndex(p => p.id === socket.id);
    if (slot >= 0) room.game.input(slot, m);
  });

  socket.on('quit', () => {
    const room = rooms.get(socket.data.room);
    if (room && room.state === 'game') endGame(room, false);
  });

  socket.on('leave', () => leave(socket));
  socket.on('disconnect', () => leave(socket));
});

server.listen(PORT, () => console.log(`결투장 서버 실행 중: http://localhost:${PORT}`));
