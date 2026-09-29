// DoKo-Server: liefert die Web-App aus und hostet Online-Räume per WebSocket.
// Der Server ist die einzige Autorität – Clients sehen nur ihre eigenen Karten.
//
//   npm install && npm start      → http://localhost:8080
//   PORT=3000 npm start
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Table, BOT_NAMES, mergeRules } from '../js/engine/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const PUBLIC = ['index.html', 'sw.js', 'manifest.webmanifest', 'css/', 'js/', 'icons/'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

// ---------- Statische Dateien ----------
function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  if (rel === 'health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  const file = path.resolve(ROOT, rel);
  const allowed = file.startsWith(ROOT + path.sep) && PUBLIC.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
  if (!allowed) { res.writeHead(404); res.end('Nicht gefunden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Nicht gefunden'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

// ---------- Räume ----------
/** @type {Map<string, Room>} */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Gast';

class Room {
  constructor(code, rules) {
    this.code = code;
    this.rules = mergeRules(rules);
    this.host = 0;
    // seat: { name, token, sockets:Set, human:boolean }
    this.seats = [0, 1, 2, 3].map(() => ({ name: null, token: null, sockets: new Set() }));
    this.table = null;
    this.touched = Date.now();
  }

  freeSeat() { return this.seats.findIndex((s) => !s.token); }

  addHuman(name) {
    const i = this.freeSeat();
    if (i < 0) return -1;
    this.seats[i].name = cleanName(name);
    this.seats[i].token = crypto.randomBytes(16).toString('hex');
    return i;
  }

  online(i) { return this.seats[i].sockets.size > 0; }

  lobbyMsg() {
    return {
      t: 'lobby',
      room: this.code,
      host: this.host,
      started: !!this.table,
      rules: this.rules,
      seats: this.seats.map((s, i) => ({ name: s.name, online: this.online(i) })),
    };
  }

  broadcastLobby() {
    const msg = JSON.stringify(this.lobbyMsg());
    for (const s of this.seats) for (const ws of s.sockets) safeSend(ws, msg);
  }

  start() {
    if (this.table) return;
    const used = new Set(this.seats.map((s) => s.name));
    const bots = BOT_NAMES.filter((n) => !used.has(n));
    const players = this.seats.map((s) => (s.token ? { name: s.name, kind: 'human' } : { name: bots.shift(), kind: 'bot' }));
    this.table = new Table({
      players,
      rules: this.rules,
      rng: () => crypto.randomInt(1 << 30) / (1 << 30),
      botDelay: Number(process.env.DOKO_BOT_DELAY ?? 800),
      trickPause: Number(process.env.DOKO_TRICK_PAUSE ?? 1500),
      onUpdate: () => this.broadcastViews(),
    });
    this.broadcastLobby();
    this.broadcastViews();
    this.table.pump();
  }

  viewFor(i) {
    const v = this.table.view(i);
    v.table.players = v.table.players.map((p, k) => ({ ...p, online: p.kind === 'bot' ? true : this.online(k) }));
    v.table.room = this.code;
    return v;
  }

  broadcastViews() {
    if (!this.table) return;
    this.touched = Date.now();
    for (let i = 0; i < 4; i++) {
      if (!this.seats[i].sockets.size) continue;
      const msg = JSON.stringify({ t: 'view', view: this.viewFor(i) });
      for (const ws of this.seats[i].sockets) safeSend(ws, msg);
    }
  }
}

function safeSend(ws, data) {
  if (ws.readyState === 1) ws.send(typeof data === 'string' ? data : JSON.stringify(data));
}

// ---------- WebSocket-Protokoll ----------
function bindSeat(ws, room, seat) {
  ws.room = room;
  ws.seat = seat;
  room.seats[seat].sockets.add(ws);
  safeSend(ws, { t: 'joined', room: room.code, seat, token: room.seats[seat].token, host: seat === room.host });
  room.broadcastLobby();
  if (room.table) {
    // Zurückgekehrter Mensch übernimmt wieder seinen Platz vom Bot
    const p = room.table.state.players[seat];
    if (p.kind === 'bot' && room.seats[seat].token) room.table.setPlayer(seat, { kind: 'human', name: room.seats[seat].name });
    room.broadcastViews();
  }
}

function handle(ws, msg) {
  const room = ws.room;
  switch (msg.t) {
    case 'create': {
      if (room) return err(ws, 'Du bist schon in einem Raum');
      const r = new Room(newCode(), msg.rules);
      rooms.set(r.code, r);
      const seat = r.addHuman(msg.name);
      bindSeat(ws, r, seat);
      return;
    }
    case 'join': {
      const r = rooms.get(String(msg.room || '').toUpperCase());
      if (!r) return err(ws, 'Raum nicht gefunden', true);
      if (r.table) return err(ws, 'Das Spiel läuft schon – nur Rückkehrer können beitreten', true);
      const seat = r.addHuman(msg.name);
      if (seat < 0) return err(ws, 'Der Tisch ist voll', true);
      bindSeat(ws, r, seat);
      return;
    }
    case 'rejoin': {
      const r = rooms.get(String(msg.room || '').toUpperCase());
      if (!r) return err(ws, 'Raum existiert nicht mehr', true);
      const seat = r.seats.findIndex((s) => s.token && s.token === msg.token);
      if (seat < 0) return err(ws, 'Platz nicht gefunden', true);
      if (ws.room && ws.room !== r) leave(ws);
      bindSeat(ws, r, seat);
      return;
    }
    case 'start':
      if (!room) return;
      if (ws.seat !== room.host) return err(ws, 'Nur der Host kann starten');
      room.start();
      return;
    case 'rules':
      if (!room || ws.seat !== room.host) return;
      room.rules = mergeRules(msg.rules);
      if (room.table) room.table.setRules(room.rules);
      room.broadcastLobby();
      return;
    case 'botify': {
      if (!room || !room.table || ws.seat !== room.host) return;
      const seat = Number(msg.seat);
      if (!(seat >= 0 && seat < 4) || seat === ws.seat || room.online(seat)) return;
      room.table.setPlayer(seat, { kind: 'bot' });
      return;
    }
    case 'act': {
      if (!room || !room.table) return;
      const res = room.table.act(ws.seat, msg.action);
      if (!res.ok) err(ws, res.error);
      return;
    }
    case 'leave':
      leave(ws);
      return;
    default:
  }
}

function err(ws, error, fatal = false) {
  safeSend(ws, { t: 'error', error, fatal });
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  room.seats[ws.seat].sockets.delete(ws);
  // In der Lobby wird der Platz wieder frei
  if (!room.table && !room.seats[ws.seat].sockets.size) {
    room.seats[ws.seat] = { name: null, token: null, sockets: new Set() };
    if (ws.seat === room.host) {
      const next = room.seats.findIndex((s) => s.token);
      if (next >= 0) room.host = next;
    }
  }
  ws.room = null;
  room.broadcastLobby();
  room.broadcastViews();
}

// ---------- Start ----------
export function startServer(port = PORT) {
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      try { handle(ws, msg); } catch (e) { console.error(e); err(ws, 'Serverfehler'); }
    });
    ws.on('close', () => {
      const room = ws.room;
      if (!room) return;
      room.seats[ws.seat].sockets.delete(ws);
      if (!room.table && !room.seats[ws.seat].sockets.size) leave(ws);
      else { room.broadcastLobby(); room.broadcastViews(); }
    });
  });

  // Tote Verbindungen erkennen, alte Räume aufräumen
  const iv = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
    const now = Date.now();
    for (const [code, r] of rooms) {
      const anyone = r.seats.some((s) => s.sockets.size);
      if (!anyone && now - r.touched > 6 * 3600 * 1000) {
        if (r.table) r.table.stop();
        rooms.delete(code);
      }
    }
  }, 30000);
  server.on('close', () => clearInterval(iv));

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(() => console.log(`DoKo-Server läuft auf http://localhost:${PORT}`));
}
