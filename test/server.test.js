import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

process.env.DOKO_BOT_DELAY = '5';
process.env.DOKO_TRICK_PAUSE = '5';
const { startServer } = await import('../server/server.js');

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, msgs: [], waiters: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    c.msgs.push(m);
    c.last = m;
    for (const w of c.waiters.splice(0)) w(m);
    if (c.onMsg) c.onMsg(m);
  });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 8000) => new Promise((resolve, reject) => {
    const found = c.msgs.find(pred);
    if (found) return resolve(found);
    const t = setTimeout(() => reject(new Error('Timeout')), ms);
    const check = (m) => { if (pred(m)) { clearTimeout(t); resolve(m); } else c.waiters.push(check); };
    c.waiters.push(check);
  });
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}

test('Online: Raum erstellen, beitreten, Spiel mit Bots zu Ende spielen', async () => {
  const server = await startServer(0);
  const port = server.address().port;
  try {
    const a = client(port);
    const b = client(port);
    await Promise.all([a.open, b.open]);
    a.send({ t: 'create', name: 'Robert' });
    const joinedA = await a.wait((m) => m.t === 'joined');
    b.send({ t: 'join', room: joinedA.room, name: 'Freund' });
    const joinedB = await b.wait((m) => m.t === 'joined');
    assert.equal(joinedB.seat, 1);
    // Nicht-Host darf nicht starten
    b.send({ t: 'start' });
    await b.wait((m) => m.t === 'error');
    a.send({ t: 'start' });
    const v = await a.wait((m) => m.t === 'view');
    assert.equal(v.view.game.hand.length, 10);
    assert.equal(v.view.table.players[2].kind, 'bot');
    // Keine fremden Karten in der Sicht
    const raw = JSON.stringify(v.view);
    assert.ok(!raw.includes('"hands"'));

    // Beide Menschen spielen automatisch die erste legale Karte
    const auto = (c, seat) => {
      c.onMsg = (m) => {
        if (m.t !== 'view') return;
        const g = m.view.game;
        if (g.phase === 'vorbehalt' && g.vorbehaltTurn === seat) c.send({ t: 'act', action: { type: 'declare', choice: 'gesund' } });
        if (g.phase === 'playing' && g.turn === seat) c.send({ t: 'act', action: { type: 'play', card: g.legal[0] } });
        if (g.phase === 'finished' && !m.view.table.ready[seat]) c.send({ t: 'act', action: { type: 'next' } });
      };
      const last = [...c.msgs].reverse().find((m) => m.t === 'view');
      if (last) c.onMsg(last);
    };
    auto(a, 0);
    auto(b, 1);
    const done = await a.wait((m) => m.t === 'view' && m.view.table.history.length >= 2, 20000);
    assert.equal(done.view.table.totals.reduce((x, y) => x + y, 0), 0);

    // Rückkehr mit Token
    const c2 = client(port);
    await c2.open;
    c2.send({ t: 'rejoin', room: joinedA.room, token: joinedB.token });
    const rj = await c2.wait((m) => m.t === 'joined');
    assert.equal(rj.seat, 1);
    a.ws.close(); b.ws.close(); c2.ws.close();
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
});
