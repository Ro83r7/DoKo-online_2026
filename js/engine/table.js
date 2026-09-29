// Ein Tisch = eine Doppelkopf-Runde über viele Spiele: Geber, Punktestand, Bock, Bots.
// Wird im Browser (Offline-Modus) UND auf dem Server (Online-Modus) identisch verwendet.
import { createGame, applyAction, getGameView, actorOf } from './game.js';
import { botAction } from './bot.js';
import { mergeRules } from './settings.js';
import { CONTRACTS } from './rules.js';

export const BOT_NAMES = ['Anna', 'Ben', 'Clara', 'Dieter', 'Emil', 'Frieda', 'Greta', 'Hugo'];

export class Table {
  /**
   * @param {object} o
   * @param {Array<{name:string, kind:'human'|'bot'}>} o.players  genau 4 Plätze
   * @param {object} [o.rules]
   * @param {object} [o.state]      gespeicherter Zustand (serialize())
   * @param {Function} [o.rng]
   * @param {number} [o.botDelay]   ms zwischen Bot-Zügen
   * @param {number} [o.trickPause] ms Pause nach einem vollständigen Stich
   * @param {Function|null} [o.schedule] (fn, ms) => handle; null = Bots nur über step()
   * @param {Function} [o.onUpdate]
   */
  constructor(o) {
    this.rng = o.rng || Math.random;
    this.botDelay = o.botDelay ?? 700;
    this.trickPause = o.trickPause ?? 1300;
    this.schedule = o.schedule === undefined ? (fn, ms) => setTimeout(fn, ms) : o.schedule;
    this.cancel = o.cancel || ((h) => clearTimeout(h));
    this.onUpdate = o.onUpdate || (() => {});
    this.timer = null;
    if (o.state) {
      this.state = o.state;
      this.state.rules = mergeRules(this.state.rules);
    } else {
      this.state = {
        version: 1,
        rules: mergeRules(o.rules),
        players: o.players.map((p) => ({ name: p.name, kind: p.kind })),
        dealer: Math.floor(this.rng() * 4),
        gameNo: 0,
        history: [],
        totals: [0, 0, 0, 0],
        bock: [],
        multiplier: 1,
        ready: [false, false, false, false],
        game: null,
      };
      this.newGame();
    }
  }

  get game() { return this.state.game; }

  setRules(rules) {
    // Regeländerungen gelten ab dem nächsten Spiel
    this.state.rules = mergeRules({ ...this.state.rules, ...rules });
  }

  setPlayer(seat, patch) {
    Object.assign(this.state.players[seat], patch);
    this.emit();
    this.pump();
  }

  newGame() {
    const s = this.state;
    s.gameNo += 1;
    s.multiplier = 2 ** (s.bock[0] || 0);
    s.ready = [false, false, false, false];
    s.game = createGame({ rules: s.rules, dealer: s.dealer, rng: this.rng });
  }

  act(seat, action) {
    const s = this.state;
    if (action && action.type === 'next') {
      if (!s.game || s.game.phase !== 'finished') return { ok: false, error: 'Spiel läuft noch' };
      s.ready[seat] = true;
      const allReady = s.players.every((p, i) => p.kind === 'bot' || s.ready[i]);
      if (allReady) this.newGame();
      this.emit();
      this.pump();
      return { ok: true };
    }
    const res = applyAction(s.game, seat, action);
    if (!res.ok) return res;
    if (s.game.phase === 'finished') this.finishGame();
    this.emit();
    this.pump();
    return res;
  }

  finishGame() {
    const s = this.state;
    const g = s.game;
    const r = g.result;
    const counts = r.kind === 'game';
    const mult = counts ? s.multiplier : 1;
    const perSeat = r.perSeat.map((v) => v * mult + 0);
    if (counts) s.bock.shift();
    for (let t = 0; t < r.triggers.length; t++) {
      for (let i = 0; i < s.rules.bockGames; i++) s.bock[i] = (s.bock[i] || 0) + 1;
    }
    s.totals = s.totals.map((v, i) => v + perSeat[i]);
    s.history.push({
      nr: s.gameNo,
      dealer: g.dealer,
      label: gameLabel(g),
      kind: r.kind,
      winner: r.winner ?? null,
      reSeats: r.reSeats || (r.kind === 'hochzeit' ? [r.seat] : []),
      reEyes: r.reEyes ?? null,
      base: r.perSeat,
      multiplier: mult,
      perSeat,
      triggers: r.triggers,
      totals: s.totals.slice(),
    });
    s.dealer = (s.dealer + 1) % 4;
    s.ready = s.players.map((p) => p.kind === 'bot');
  }

  /** Wartet der Tisch gerade auf einen Bot? */
  pendingBot() {
    const g = this.state.game;
    if (!g) return null;
    const a = actorOf(g);
    if (a === null || a === undefined) return null;
    return this.state.players[a].kind === 'bot' ? a : null;
  }

  /** Führt genau einen Bot-Zug aus. true = es wurde etwas getan. */
  step() {
    const seat = this.pendingBot();
    if (seat === null) return false;
    const action = botAction(this.view(seat).game);
    if (!action) return false;
    const res = this.act(seat, action);
    if (!res.ok) {
      // Sollte nie passieren – zur Sicherheit erste legale Karte spielen
      const v = this.view(seat).game;
      if (v.phase === 'playing' && v.legal.length) this.act(seat, { type: 'play', card: v.legal[0] });
      else if (v.phase === 'vorbehalt') this.act(seat, { type: 'declare', choice: 'gesund' });
    }
    return true;
  }

  pump() {
    if (!this.schedule || this.timer) return;
    if (this.pendingBot() === null) return;
    const g = this.state.game;
    const trickJustDone = g.phase === 'playing' && g.trick.cards.length === 0 && g.tricks.length > 0;
    const delay = g.phase === 'vorbehalt' ? this.botDelay * 0.6 : trickJustDone ? this.trickPause : this.botDelay;
    this.timer = this.schedule(() => {
      this.timer = null;
      this.step();
      this.pump();
    }, delay);
  }

  stop() {
    if (this.timer) this.cancel(this.timer);
    this.timer = null;
  }

  emit() { this.onUpdate(this); }

  view(seat) {
    const s = this.state;
    return {
      table: {
        players: s.players.map((p) => ({ name: p.name, kind: p.kind })),
        gameNo: s.gameNo,
        dealer: s.game ? s.game.dealer : s.dealer,
        totals: s.totals.slice(),
        history: s.history,
        bock: s.bock.slice(),
        multiplier: s.multiplier,
        ready: s.ready.slice(),
        rules: s.rules,
      },
      game: s.game ? getGameView(s.game, seat) : null,
    };
  }

  serialize() { return JSON.parse(JSON.stringify(this.state)); }
}

export function gameLabel(g) {
  const c = g.contract;
  if (!c) return '–';
  if (c.hochzeit !== undefined) return c.payout ? 'Hochzeit (ausgezahlt)' : 'Hochzeit';
  if (c.silentSolo !== undefined) return 'Stilles Solo';
  return CONTRACTS[c.type].label;
}
