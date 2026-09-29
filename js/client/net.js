// Verbindungen: lokal (Bots im Browser) und online (WebSocket zum Server).
// Beide bieten dieselbe Schnittstelle, damit die Oberfläche nicht unterscheiden muss.

export class LocalConnection {
  constructor(table, seat = 0, onSave = () => {}) {
    this.kind = 'local';
    this.table = table;
    this.seat = seat;
    this.listeners = new Set();
    this.onSave = onSave;
    table.onUpdate = () => {
      this.onSave(table);
      this.emit();
    };
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() {
    const v = this.getView();
    for (const fn of this.listeners) fn({ type: 'view', view: v });
  }
  getView() { return this.table.view(this.seat); }
  send(action) { return this.table.act(this.seat, action); }
  start() { this.emit(); this.table.pump(); }
  close() { this.table.stop(); this.listeners.clear(); }
}

/** Ermittelt eine sinnvolle Server-Adresse. Auf GitHub Pages gibt es keinen Server. */
export function defaultServerUrl() {
  if (typeof location === 'undefined') return '';
  const { protocol, host } = location;
  if (!host || host.endsWith('github.io') || protocol === 'file:') return '';
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws`;
}

export class RemoteConnection {
  constructor(url) {
    this.kind = 'online';
    this.url = url;
    this.seat = null;
    this.room = null;
    this.token = null;
    this.isHost = false;
    this.view = null;
    this.lobby = null;
    this.listeners = new Set();
    this.queue = [];
    this.closed = false;
    this.retries = 0;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(msg) { for (const fn of this.listeners) fn(msg); }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        reject(new Error('Ungültige Server-Adresse'));
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; ws.close(); reject(new Error('Server antwortet nicht')); }
      }, 6000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.retries = 0;
        if (!settled) { settled = true; resolve(); }
        // Nach Verbindungsabbruch automatisch wieder einsteigen
        if (this.room && this.token) this.raw({ t: 'rejoin', room: this.room, token: this.token });
        for (const m of this.queue.splice(0)) this.raw(m);
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        this.handle(msg);
      };
      ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Keine Verbindung zum Server')); }
      };
      ws.onclose = () => {
        this.emit({ type: 'status', online: false });
        if (this.closed || !this.room) return;
        const wait = Math.min(10000, 800 * 2 ** this.retries++);
        setTimeout(() => { if (!this.closed) this.connect().catch(() => {}); }, wait);
      };
    });
  }

  handle(msg) {
    switch (msg.t) {
      case 'joined':
        this.room = msg.room;
        this.seat = msg.seat;
        this.token = msg.token;
        this.isHost = msg.host;
        this.emit({ type: 'joined', ...msg });
        this.emit({ type: 'status', online: true });
        break;
      case 'lobby':
        this.lobby = msg;
        this.emit({ type: 'lobby', lobby: msg });
        break;
      case 'view':
        this.view = msg.view;
        this.emit({ type: 'view', view: msg.view });
        break;
      case 'error':
        this.emit({ type: 'error', error: msg.error, fatal: msg.fatal });
        if (msg.fatal) { this.room = null; this.token = null; }
        break;
      default:
    }
  }

  raw(m) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
    else this.queue.push(m);
  }

  create(name, rules) { this.raw({ t: 'create', name, rules }); }
  join(room, name) { this.raw({ t: 'join', room: room.toUpperCase().trim(), name }); }
  rejoin(room, token) { this.room = room; this.token = token; this.raw({ t: 'rejoin', room, token }); }
  startGame() { this.raw({ t: 'start' }); }
  setRules(rules) { this.raw({ t: 'rules', rules }); }
  botify(seat) { this.raw({ t: 'botify', seat }); }
  getView() { return this.view; }
  send(action) { this.raw({ t: 'act', action }); return { ok: true, pending: true }; }
  start() { if (this.view) this.emit({ type: 'view', view: this.view }); }
  close() {
    this.closed = true;
    try { this.raw({ t: 'leave' }); } catch { /* egal */ }
    try { this.ws && this.ws.close(); } catch { /* egal */ }
    this.listeners.clear();
  }
}
