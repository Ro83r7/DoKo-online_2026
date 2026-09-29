// Oberfläche: Startbildschirm, Spieltisch, Dialoge.
import {
  Table, BOT_NAMES, mergeRules, DEFAULT_RULES, RULE_LABELS, CONTRACTS, DECLARATION_LABELS,
  suitOf, rankOf, SUIT_SYMBOLS, RANK_SHORT, SUIT_NAMES, RANK_NAMES, trumpRank, annLabel, sortHand,
} from '../engine/index.js';
import { LocalConnection, RemoteConnection, defaultServerUrl } from './net.js';
import { load, save } from './store.js';

// ---------- Zustand ----------
const SPEEDS = {
  slow: { botDelay: 1150, trickPause: 2000, label: 'Langsam' },
  normal: { botDelay: 750, trickPause: 1500, label: 'Normal' },
  fast: { botDelay: 380, trickPause: 950, label: 'Schnell' },
};
const hoverDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const prefs = Object.assign({
  name: '',
  speed: 'normal',
  quickPlay: hoverDevice,
  rules: { ...DEFAULT_RULES },
  serverUrl: defaultServerUrl(),
}, load('doko.prefs', {}));
// Regelstand 2: Hochzeit ausspielen, Fuchs + Doppelkopf an, Re/Kontra bis zur 5. Karte
const RULES_VERSION = 2;
if (prefs.rulesVersion !== RULES_VERSION) {
  prefs.rules = { ...DEFAULT_RULES };
  prefs.rulesVersion = RULES_VERSION;
  save('doko.prefs', prefs);
}
prefs.rules = mergeRules(prefs.rules);

const S = {
  conn: null,
  view: null,
  selected: null,
  seenTrickCards: new Set(),
  collectedKey: null,
  collectTimer: null,
  collectingKey: null,
  lastEvent: { game: 0, id: 0 },
  annConfirm: null,
  resultShownFor: null,
  resultTimer: null,
  modal: null, // Name des offenen Dialogs
  online: true,
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const AVATAR_COLORS = ['#f5b841', '#5b9dff', '#3ddc97', '#ff8fa3'];

function savePrefs() { save('doko.prefs', prefs); }

// ---------- Karten-HTML ----------
function cardHTML(id, { cls = '', ctx = null, attrs = '' } = {}) {
  const s = suitOf(id);
  const r = rankOf(id);
  const red = s === 'H' || s === 'D';
  const sym = SUIT_SYMBOLS[s];
  const short = RANK_SHORT[r];
  const trump = ctx && trumpRank(id, ctx) >= 0 ? ' trump' : '';
  const center = ['K', 'Q', 'J'].includes(r)
    ? `<div class="face"><div class="fi"><b>${short}</b><small>${sym}</small></div></div>`
    : `<div class="pip">${sym}</div>`;
  return `<div class="card${red ? ' red' : ''}${trump} ${cls}" data-card="${id}" ${attrs} aria-label="${SUIT_NAMES[s]} ${RANK_NAMES[r]}">
    <div class="corner"><span class="r">${short}</span><span class="s">${sym}</span></div>
    ${center}
    <div class="corner br"><span class="r">${short}</span><span class="s">${sym}</span></div>
  </div>`;
}

// ---------- Screens ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
}

function renderHome() {
  $('#name-input').value = prefs.name;
  $('#btn-continue').hidden = !load('doko.table');
  const r = prefs.rules;
  const chips = ['Ohne Neunen', 'Keine Pflichtsoli'];
  if (r.secondDulleBeats) chips.push('2. Herz-10 sticht 1.');
  if (r.schweine) chips.push('Schweine');
  if (r.karlchen) chips.push('Karlchen');
  if (r.fuchsGefangen) chips.push('Fuchs gefangen');
  if (r.doppelkopf) chips.push('Doppelkopf');
  chips.push('Hochzeit: 1. Fehl-/Trumpfstich');
  chips.push(`Re/Kontra bis zur ${r.announceUntil}. Karte`);
  const bock = [r.bockOnZero && '0-Punkte', r.bockOnHeartTrick && 'Herz durch', r.bockOnReKontra && 'Re+Kontra'].filter(Boolean);
  if (bock.length) chips.push(`Bock (${r.bockGames}): ${bock.join(', ')}`);
  $('#rule-chips').innerHTML = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
}

function playerName() {
  const n = $('#name-input').value.trim();
  prefs.name = n;
  savePrefs();
  return n || 'Du';
}

// ---------- Lokales Spiel ----------
function makeLocalTable(state = null) {
  const sp = SPEEDS[prefs.speed] || SPEEDS.normal;
  const opts = {
    botDelay: sp.botDelay,
    trickPause: sp.trickPause,
  };
  if (state) return new Table({ ...opts, state });
  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  return new Table({
    ...opts,
    rules: prefs.rules,
    players: [{ name: playerName(), kind: 'human' }, ...names.map((n) => ({ name: n, kind: 'bot' }))],
  });
}

let saveTimer = null;
function persistLocal(table) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save('doko.table', table.serialize()), 250);
}

function startLocal(state = null) {
  closeConn();
  let table;
  try {
    table = makeLocalTable(state);
  } catch (e) {
    console.error(e);
    save('doko.table', null);
    table = makeLocalTable();
  }
  if (!state) save('doko.table', table.serialize());
  else {
    table.state.players[0].name = prefs.name || table.state.players[0].name;
    if (table.state.rulesVersion !== RULES_VERSION) {
      table.setRules(prefs.rules); // gilt ab dem nächsten Spiel
      table.state.rulesVersion = RULES_VERSION;
    }
  }
  attach(new LocalConnection(table, 0, persistLocal));
}

function closeConn() {
  if (S.conn) S.conn.close();
  S.conn = null;
  S.view = null;
  clearTimeout(S.collectTimer);
  clearTimeout(S.resultTimer);
  S.seenTrickCards.clear();
  S.collectedKey = null;
  S.collectingKey = null;
  S.resultShownFor = null;
  S.lastEvent = { game: 0, id: 0 };
}

function attach(conn) {
  S.conn = conn;
  let first = true;
  conn.on((msg) => {
    if (msg.type === 'view') {
      if (first) {
        // Alte Ereignisse nicht erneut anzeigen
        const g = msg.view.game;
        S.lastEvent = { game: msg.view.table.gameNo, id: g && g.events.length ? g.events[g.events.length - 1].id : 0 };
        if (g && g.phase === 'finished') S.resultShownFor = null;
        if (g) {
          for (const c of g.trick.cards) S.seenTrickCards.add(`${msg.view.table.gameNo}:${c.card}`);
          S.collectedKey = `${msg.view.table.gameNo}:${g.trickCount}`;
        }
        first = false;
      }
      onView(msg.view);
    } else if (msg.type === 'error') {
      toast(msg.error);
      if (msg.fatal && conn.kind === 'online') {
        save('doko.online', null);
      }
    } else if (msg.type === 'status') {
      S.online = msg.online;
      if (S.view) renderTopbar(S.view);
    } else if (msg.type === 'lobby') {
      if (!S.view || !S.view.game) renderLobby(msg.lobby);
    }
  });
  showScreen('game');
  conn.start();
}

function send(action) {
  if (!S.conn) return;
  const res = S.conn.send(action);
  if (res && !res.ok) toast(res.error);
}

// ---------- Rendering Spieltisch ----------
function onView(view) {
  const prevGameNo = S.view && S.view.table.gameNo;
  S.view = view;
  if (!view.game) return;
  if (S.modal === 'lobby') closeModal();
  if (prevGameNo !== view.table.gameNo) {
    S.selected = null;
    if (S.modal === 'result') closeModal();
  }
  const g = view.game;
  if (S.selected && !g.hand.includes(S.selected)) S.selected = null;
  processEvents(view);
  renderTopbar(view);
  renderSeats(view);
  renderTrick(view);
  renderActionbar(view);
  renderHand(view);
  renderCenter(view);
  maybeShowResult(view);
}

const posOf = (seat) => (seat - (S.view.game.seat ?? 0) + 4) % 4;
const nameOf = (seat) => (S.view.table.players[seat] || {}).name || `Spieler ${seat + 1}`;

function renderTopbar(view) {
  const g = view.game;
  const t = view.table;
  let title = 'Vorbehalt';
  if (g.contract) {
    title = g.contract.label;
    if (g.contract.soloist !== undefined) title += ` · ${nameOf(g.contract.soloist)}`;
    if (g.contract.hochzeit !== undefined) {
      title += ` · ${nameOf(g.contract.hochzeit)}`;
      if (!g.contract.clarified) title += g.contract.hochzeitMode === 'T' ? ' · 1. Trumpfstich' : ' · 1. Fehlstich';
      else if (g.contract.partner === null) title += ' allein';
      else title += ` & ${nameOf(g.contract.partner)}`;
    }
  }
  const bock = t.multiplier > 1 ? `<span class="bock-badge">${t.multiplier === 2 ? 'BOCK' : `BOCK ×${t.multiplier}`}</span>` : '';
  $('#game-title').innerHTML = `${esc(title)} ${bock}`;
  const round = Math.floor((t.gameNo - 1) / 4) + 1;
  const bockLeft = t.bock.length ? ` · noch ${t.bock.length} Bock` : '';
  const off = S.conn && S.conn.kind === 'online' ? (S.online ? ` · Raum ${S.conn.room}` : ' · ⚠︎ offline') : '';
  $('#game-sub').textContent = `Spiel ${t.gameNo} · Runde ${round}${bockLeft}${off}`;
}

function seatBadges(view, seat) {
  const g = view.game;
  const out = [];
  if (g.dealer === seat) out.push('<span class="badge dealer">Geber</span>');
  const p = g.parties[seat];
  const lvl = g.annBySeat[seat];
  if (p) out.push(`<span class="badge ${p}">${lvl ? esc(annLabel(p, 1)) + '!' : p === 're' ? 'Re' : 'Kontra'}</span>`);
  if (lvl >= 2) out.push(`<span class="badge info">${esc(annLabel(p, lvl))}</span>`);
  if (g.schweine === seat && g.schweineAnnounced) out.push('<span class="badge pig">🐷 Schweine</span>');
  if (g.phase === 'vorbehalt' && g.declarations[seat]) {
    out.push(`<span class="badge info">${g.declarations[seat] === 'gesund' ? 'gesund' : 'Vorbehalt'}</span>`);
  }
  const pl = view.table.players[seat];
  if (pl && pl.online === false && pl.kind === 'human') out.push('<span class="badge off">offline</span>');
  return out.join('');
}

function renderSeats(view) {
  const g = view.game;
  for (let seat = 0; seat < 4; seat++) {
    const pos = posOf(seat);
    if (pos === 0) continue;
    const el = $(`#seat-${pos}`);
    const pl = view.table.players[seat];
    const turn = (g.phase === 'playing' && g.turn === seat) || (g.phase === 'vorbehalt' && g.vorbehaltTurn === seat);
    const backs = '<i></i>'.repeat(g.handCounts[seat]);
    const speech = el.querySelector('.speech');
    el.innerHTML = `
      <div class="player-chip${turn ? ' turn' : ''}">
        <div class="avatar" style="background:${AVATAR_COLORS[seat]}">${esc(pl.name.slice(0, 1).toUpperCase())}</div>
        <div class="player-meta">
          <div class="player-name">${esc(pl.name)}${pl.kind === 'bot' ? ' <span class="muted" title="Bot">·🤖</span>' : ''}</div>
          <div class="player-sub"><span>${g.tricksWon[seat]} St.</span><span>${fmt(view.table.totals[seat])} P.</span></div>
        </div>
      </div>
      <div class="badges">${seatBadges(view, seat)}</div>
      <div class="mini-hand">${backs}</div>`;
    if (speech) el.appendChild(speech);
  }
}

const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);

function renderTrick(view) {
  const g = view.game;
  const gk = view.table.gameNo;
  const el = $('#trick');
  let cards = [];
  let winner = null;
  const curKey = `${gk}:${g.trickCount}`;
  if (g.trick.cards.length) {
    cards = g.trick.cards;
    clearTimeout(S.collectTimer);
    S.collectingKey = null;
    S.collectedKey = curKey;
    el.className = 'trick-area';
  } else if (g.lastTrick && S.collectedKey !== curKey) {
    cards = g.lastTrick.cards;
    winner = g.lastTrick.winner;
    if (S.collectingKey !== curKey && g.phase !== 'finished') {
      S.collectingKey = curKey;
      clearTimeout(S.collectTimer);
      const sp = SPEEDS[prefs.speed] || SPEEDS.normal;
      const wait = Math.max(600, sp.trickPause - 500);
      S.collectTimer = setTimeout(() => {
        el.className = `trick-area collect-${posOf(winner)}`;
        S.collectTimer = setTimeout(() => {
          S.collectedKey = curKey;
          S.collectingKey = null;
          el.className = 'trick-area';
          if (S.view) renderTrick(S.view);
        }, 460);
      }, wait);
    }
  } else if (S.collectingKey === null) {
    el.className = 'trick-area';
  }
  const ctx = g.ctx;
  el.innerHTML = cards.map((c) => {
    const key = `${gk}:${c.card}`;
    const pos = posOf(c.seat);
    const anim = S.seenTrickCards.has(key) ? '' : ` enter-${pos}`;
    S.seenTrickCards.add(key);
    return `<div class="slot p${pos}${winner === c.seat ? ' win' : ''}${anim}">${cardHTML(c.card, { ctx })}</div>`;
  }).join('');
}

function renderActionbar(view) {
  const g = view.game;
  const bar = $('#actionbar');
  const me = g.seat;
  const parts = [];
  const myParty = g.myParty;
  if (myParty && g.phase !== 'vorbehalt') {
    const lvl = g.ann[myParty];
    parts.push(`<span class="badge ${myParty}">${myParty === 're' ? 'Du: Re' : 'Du: Kontra'}${lvl ? ' · ' + esc(annLabel(myParty, lvl)) : ''}</span>`);
  }
  if (g.dealer === me) parts.push('<span class="badge dealer">Geber</span>');
  if (g.schweine === me) parts.push(`<span class="badge pig">🐷${g.schweineAnnounced ? ' Schweine' : ' Schweine (beim 1. Fuchs)'}</span>`);
  if (g.phase === 'playing') {
    const mine = g.turn === me;
    parts.push(`<span class="status-text${mine ? ' me' : ''}">${mine ? (g.trick.cards.length ? 'Du bist dran' : 'Du spielst aus') : `${esc(nameOf(g.turn))} ist dran`} · ${g.tricksWon[me]} St.</span>`);
    if (g.nextAnn) {
      const confirm = S.annConfirm === `${view.table.gameNo}:${g.nextAnn.level}`;
      parts.push(`<button class="btn small ${myParty}${confirm ? ' confirm' : ''}" data-act="announce">${confirm ? `Sicher? ${esc(g.nextAnn.label)}!` : esc(g.nextAnn.label)}</button>`);
    }
  } else if (g.phase === 'vorbehalt') {
    parts.push(`<span class="status-text${g.vorbehaltTurn === me ? ' me' : ''}">${g.vorbehaltTurn === me ? 'Deine Ansage: gesund oder Vorbehalt?' : `Vorbehalt: ${esc(nameOf(g.vorbehaltTurn))} überlegt …`}</span>`);
  } else if (g.phase === 'finished') {
    parts.push('<button class="btn small primary" data-act="result">Abrechnung</button>');
  }
  bar.innerHTML = parts.join('');
}

let cardWidthCache = 0;
function cardWidth() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--cw)';
  document.body.appendChild(probe);
  cardWidthCache = probe.getBoundingClientRect().width || 70;
  probe.remove();
  return cardWidthCache;
}

function renderHand(view) {
  const g = view.game;
  const el = $('#hand');
  const hand = g.phase === 'vorbehalt' ? sortHand(g.hand, g.ctx) : g.hand;
  const myTurn = g.phase === 'playing' && g.turn === g.seat;
  el.classList.toggle('myturn', myTurn);
  const W = el.clientWidth || window.innerWidth;
  const cw = cardWidth();
  const n = hand.length;
  const maxStep = cw * 0.92;
  const step = n > 1 ? Math.min(maxStep, (W - 56 - cw) / (n - 1)) : 0;
  const total = cw + step * (n - 1);
  const left0 = (W - total) / 2;
  const mid = (n - 1) / 2;
  el.innerHTML = hand.map((id, i) => {
    const legal = myTurn && g.legal.includes(id);
    const cls = [myTurn ? (legal ? 'legal' : 'illegal') : '', S.selected === id ? 'selected' : ''].join(' ');
    const angle = (i - mid) * (n > 6 ? 1.8 : 2.6);
    const drop = Math.pow(Math.abs(i - mid), 2) * 0.9;
    return cardHTML(id, {
      cls,
      ctx: g.phase === 'vorbehalt' ? null : g.ctx,
      attrs: `style="left:${left0 + i * step}px;transform:translateY(${drop}px) rotate(${angle}deg);z-index:${i + 1}"`,
    });
  }).join('');
}

function renderCenter(view) {
  const g = view.game;
  const el = $('#center-note');
  el.style.pointerEvents = 'none';
  if (g.phase === 'vorbehalt' && g.vorbehaltTurn === g.seat && g.options.length) {
    el.style.pointerEvents = 'auto';
    const hasHochzeit = g.options.includes('hochzeit-F');
    const solo = g.options.some((o) => o.startsWith('solo-'));
    const hochHint = 'Hochzeit: Wer in den ersten 3 Stichen den ersten Stich der angesagten Art macht, spielt mit dir. Sonst spielst du allein (Solo).';
    el.innerHTML = `<div class="panel" style="background:var(--panel-strong)">
      <div style="font-weight:700;margin-bottom:10px">Gesund oder Vorbehalt?</div>
      <div class="row wrap" style="justify-content:center">
        <button class="btn primary" data-decl="gesund">Gesund</button>
        ${hasHochzeit ? '<button class="btn" data-decl="hochzeit-F">💍 Hochzeit · 1. Fehlstich</button><button class="btn" data-decl="hochzeit-T">💍 Hochzeit · 1. Trumpfstich</button>' : ''}
        ${solo ? '<button class="btn" data-act="solo-picker">Solo …</button>' : ''}
      </div>
      ${hasHochzeit ? `<div class="decl-hint">${esc(hochHint)}<br>„Gesund“ mit beiden Kreuz-Damen = stilles Solo.</div>` : ''}
    </div>`;
    return;
  }
  if (g.phase === 'vorbehalt') {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = '';
}

// ---------- Ereignisse → Sprechblasen & Toasts ----------
function processEvents(view) {
  const g = view.game;
  const gk = view.table.gameNo;
  if (S.lastEvent.game !== gk) S.lastEvent = { game: gk, id: 0 };
  const fresh = g.events.filter((e) => e.id > S.lastEvent.id);
  if (!fresh.length) return;
  S.lastEvent.id = fresh[fresh.length - 1].id;
  for (const ev of fresh) {
    switch (ev.type) {
      case 'declare':
        if (ev.vorbehalt) speech(ev.seat, 'Vorbehalt!');
        break;
      case 'contract':
        if (ev.contract === 'hochzeit') {
          toast(`💍 ${nameOf(ev.seat)} hat eine Hochzeit – ${ev.mode === 'T' ? 'erster Trumpfstich' : 'erster Fehlstich'}!`, true);
        } else if (ev.contract !== 'normal') {
          toast(`${nameOf(ev.seat)} spielt ${CONTRACTS[ev.contract].label}`, true);
        }
        break;
      case 'announce':
        speech(ev.seat, `${ev.label}!`);
        if (ev.seat !== g.seat) toast(`${nameOf(ev.seat)}: ${ev.label}!`);
        break;
      case 'schweine':
        speech(ev.seat, 'Schweine! 🐷');
        toast(`🐷 ${nameOf(ev.seat)} hat Schweine!`, true);
        break;
      case 'hochzeitPartner':
        toast(`💍 ${nameOf(ev.seat)} heiratet mit!`);
        break;
      case 'hochzeitSolo':
        toast(`Kein Partner in 3 Stichen – ${nameOf(ev.seat)} spielt allein`, true);
        break;
      default:
    }
  }
}

function speech(seat, text) {
  const pos = posOf(seat);
  const host = pos === 0 ? $('#seat-0-speech') : $(`#seat-${pos}`);
  if (!host) return;
  host.querySelectorAll('.speech').forEach((s) => s.remove());
  const b = document.createElement('div');
  b.className = 'speech';
  b.textContent = text;
  host.appendChild(b);
  setTimeout(() => b.remove(), 2800);
}

function toast(text, hot = false) {
  const t = document.createElement('div');
  t.className = `toast${hot ? ' hot' : ''}`;
  t.textContent = text;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ---------- Dialoge ----------
function openModal(name, html, { wide = false } = {}) {
  S.modal = name;
  const body = $('#modal-body');
  body.className = `modal${wide ? ' wide' : ''}`;
  body.innerHTML = html;
  $('#modal').classList.add('open');
  body.scrollTop = 0;
}
function closeModal() {
  S.modal = null;
  $('#modal').classList.remove('open');
}

function closeBtn() {
  return '<button class="icon-btn" data-act="close" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
}

function openSoloPicker() {
  const g = S.view.game;
  const solos = g.options.filter((o) => o.startsWith('solo-'));
  const hints = {
    'solo-Q': 'Nur Damen sind Trumpf', 'solo-J': 'Nur Buben sind Trumpf', 'solo-0': 'Kein Trumpf',
    'solo-C': 'Kreuz statt Karo', 'solo-S': 'Pik statt Karo', 'solo-H': 'Herz statt Karo', 'solo-D': 'Wie Normalspiel, allein',
  };
  openModal('solo', `
    <div class="modal-head"><div><h2>Solo ansagen</h2><p class="lead">Du spielst allein gegen alle – Punkte zählen dreifach.</p></div>${closeBtn()}</div>
    <div class="last-trick" style="flex-wrap:wrap;gap:4px">${sortHand(g.hand, g.ctx).map((c) => `<div class="col">${cardHTML(c)}</div>`).join('')}</div>
    <div class="decl-grid">
      ${solos.map((o) => `<button class="btn" data-decl="${o}"><div>${esc(DECLARATION_LABELS[o])}</div><div class="muted" style="font-size:11px;font-weight:500">${esc(hints[o])}</div></button>`).join('')}
    </div>`);
}

function maybeShowResult(view) {
  const g = view.game;
  if (g.phase !== 'finished' || !g.result) return;
  const key = view.table.gameNo;
  if (S.resultShownFor === key) {
    if (S.modal === 'result') openResult(); // Bereit-Status aktualisieren
    return;
  }
  S.resultShownFor = key;
  clearTimeout(S.resultTimer);
  S.resultTimer = setTimeout(() => openResult(), g.result.kind === 'hochzeit' ? 900 : 1700);
}

function openResult() {
  const view = S.view;
  if (!view || !view.game || !view.game.result) return;
  const g = view.game;
  const r = g.result;
  const t = view.table;
  const h = t.history[t.history.length - 1];
  if (!h) return;
  const me = g.seat;
  let hero = '';
  let body = '';
  if (r.kind === 'hochzeit') {
    hero = `<div class="big">💍 Hochzeit</div><div class="muted">${esc(nameOf(r.seat))} bekommt ${r.perSeat[r.seat]} Punkte, alle anderen je ${r.perSeat[(r.seat + 1) % 4]}. Es wird neu gegeben.</div>`;
  } else {
    const winTxt = r.winner === 're' ? (r.solo ? `${nameOf(r.soloist)} gewinnt das Solo!` : 'Re gewinnt!')
      : r.winner === 'kontra' ? (r.solo ? 'Die Gegenspieler gewinnen!' : 'Kontra gewinnt!') : 'Keiner gewinnt';
    const iWon = r.perSeat[me] > 0;
    hero = `<div class="big ${r.winner || ''}">${esc(winTxt)}</div>
      <div class="muted">${esc(h.label)}${h.multiplier > 1 ? ` · Bock ×${h.multiplier}` : ''}${r.perSeat[me] !== 0 ? (iWon ? ' · 🎉 Glückwunsch!' : '') : ''}</div>`;
    const reNames = r.reSeats.map(nameOf).join(' & ');
    const koNames = r.kontraSeats.map(nameOf).join(' & ');
    const rePct = Math.max(8, Math.min(92, (r.reEyes / 240) * 100));
    const items = r.items.map((it) => `<li><span class="l">${esc(it.label)}</span><span class="v">${it.value}</span></li>`).join('');
    const sp = r.special.map((it) => `<li class="sp"><span class="l">${esc(it.label)} (${it.party === 're' ? 'Re' : 'Kontra'})</span><span class="v ${it.party === r.winner || !r.winner ? '' : 'neg'}">${it.party === (r.winner || 're') ? '+' : '−'}${it.value}</span></li>`).join('');
    const base = Math.abs(r.reValue);
    body = `
      <div class="eyes-bar"><div class="re" style="width:${rePct}%">${r.reEyes}</div><div class="kontra" style="width:${100 - rePct}%">${r.kontraEyes}</div></div>
      <div class="eyes-legend"><span>Re: ${esc(reNames)}</span><span>Kontra: ${esc(koNames)}</span></div>
      <ul class="items">${items}${sp}
        <li class="total"><span>Spielwert${r.solo ? ' (Solist ×3)' : ''}${h.multiplier > 1 ? ` · Bock ×${h.multiplier}` : ''}</span><span class="v">${base}${h.multiplier > 1 ? ` × ${h.multiplier} = ${base * h.multiplier}` : ''}</span></li>
      </ul>`;
  }
  const scores = [0, 1, 2, 3].map((s) => `
    <div class="score-cell"><div class="n">${esc(nameOf(s))}${s === me ? ' (Du)' : ''}</div>
      <div class="d ${h.perSeat[s] > 0 ? 'pos' : h.perSeat[s] < 0 ? 'neg' : ''}">${fmt(h.perSeat[s])}</div>
      <div class="t">Σ ${fmt(t.totals[s])}</div></div>`).join('');
  const bockNote = h.triggers.length
    ? `<div class="bock-note">🔥 <b>Bockrunde!</b> ${esc(h.triggers.join(' · '))} – die nächsten ${t.rules.bockGames} Spiele zählen doppelt${h.triggers.length > 1 ? ' (mehrfach)' : ''}.</div>` : '';
  const waiting = t.ready[me]
    ? `<p class="muted" style="text-align:center">Warte auf: ${t.players.map((p, i) => (!t.ready[i] ? esc(p.name) : null)).filter(Boolean).join(', ')}</p>` : '';
  openModal('result', `
    <div class="result-hero">${hero}</div>
    ${body}
    ${bockNote}
    <div class="score-row">${scores}</div>
    ${waiting}
    <div class="row" style="justify-content:space-between">
      <button class="btn" data-act="scores">Punkteliste</button>
      <button class="btn primary" data-act="next" ${t.ready[me] ? 'disabled' : ''}>Nächstes Spiel</button>
    </div>`);
}

function openScores() {
  const t = S.view ? S.view.table : null;
  if (!t) return;
  const names = t.players.map((p) => esc(p.name));
  const rows = t.history.slice().reverse().map((h) => `
    <tr class="${h.multiplier > 1 ? 'bock' : ''}">
      <td>${h.nr}</td>
      <td class="game">${esc(h.label)}${h.multiplier > 1 ? ` ×${h.multiplier}` : ''}${h.triggers.length ? ' 🔥' : ''}</td>
      ${h.perSeat.map((v, i) => `<td><span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${fmt(v)}</span><span class="cum">${h.totals[i]}</span></td>`).join('')}
    </tr>`).join('');
  const bockInfo = t.bock.length
    ? `<div class="bock-note">Noch <b>${t.bock.length}</b> Bockspiel${t.bock.length > 1 ? 'e' : ''}${t.bock.some((b) => b > 1) ? ' (inkl. Doppelbock)' : ''}: ${t.bock.map((b) => `×${2 ** b}`).join(' · ')}</div>` : '';
  openModal('scores', `
    <div class="modal-head"><div><h2>Punkteliste</h2><p class="lead">${t.history.length} Spiele · Runde ${Math.floor(Math.max(0, t.gameNo - 1) / 4) + 1}</p></div>${closeBtn()}</div>
    ${bockInfo}
    <div class="sheet-wrap">
      <table class="sheet">
        <thead><tr><th>#</th><th>Spiel</th>${names.map((n) => `<th>${n}</th>`).join('')}</tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted" style="text-align:center">Noch keine Spiele</td></tr>'}</tbody>
        <tfoot><tr><td></td><td>Summe</td>${t.totals.map((v) => `<td class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v}</td>`).join('')}</tr></tfoot>
      </table>
    </div>`, { wide: true });
}

function openLastTrick() {
  const g = S.view && S.view.game;
  if (!g || !g.lastTrick) { toast('Noch kein Stich gespielt'); return; }
  const lt = g.lastTrick;
  openModal('last', `
    <div class="modal-head"><div><h2>Letzter Stich</h2><p class="lead">${esc(nameOf(lt.winner))} bekommt ${lt.eyes} Augen</p></div>${closeBtn()}</div>
    <div class="last-trick">${lt.cards.map((c) => `<div class="col${c.seat === lt.winner ? ' win' : ''}">${cardHTML(c.card, { ctx: g.ctx })}<span>${esc(nameOf(c.seat))}</span></div>`).join('')}</div>`);
}

function openMenu() {
  const online = S.conn && S.conn.kind === 'online';
  openModal('menu', `
    <div class="modal-head"><div><h2>Menü</h2>${online ? `<p class="lead">Online-Raum <b class="code" style="font-size:18px">${esc(S.conn.room)}</b></p>` : ''}</div>${closeBtn()}</div>
    <div class="settings-grid">
      <button class="btn block" data-act="scores">Punkteliste</button>
      <button class="btn block" data-act="settings">Regeln &amp; Optionen</button>
      ${online && S.conn.isHost ? '<button class="btn block" data-act="botify-menu">Abwesende Spieler durch Bots ersetzen</button>' : ''}
      ${!online ? '<button class="btn block" data-act="new-round">Neue Runde (Punkte zurücksetzen)</button>' : ''}
      <button class="btn block" data-act="home">${online ? 'Raum verlassen' : 'Zum Startbildschirm'}</button>
    </div>`);
}

function openSettings() {
  const r = prefs.rules;
  const toggles = Object.keys(RULE_LABELS).map((k) => `
    <label class="toggle"><span>${esc(RULE_LABELS[k])}</span><input type="checkbox" data-rule="${k}" ${r[k] ? 'checked' : ''}></label>`).join('');
  const seg = (name, cur, opts) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-val="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
  openModal('settings', `
    <div class="modal-head"><div><h2>Regeln &amp; Optionen</h2><p class="lead">Regeländerungen gelten ab dem nächsten Spiel.</p></div>${closeBtn()}</div>
    <div class="section-title">Bedienung</div>
    <div class="settings-grid">
      <div class="toggle"><span>Tempo der Mitspieler</span>${seg('speed', prefs.speed, Object.entries(SPEEDS).map(([k, v]) => [k, v.label]))}</div>
      <label class="toggle"><span>Karte mit einem Tipp spielen</span><input type="checkbox" data-pref="quickPlay" ${prefs.quickPlay ? 'checked' : ''}></label>
    </div>
    <div class="section-title">Ansagen</div>
    <div class="settings-grid">
      <div class="toggle"><span>Re/Kontra bis zur … Karte</span>${seg('announceUntil', r.announceUntil, [[2, '2.'], [3, '3.'], [4, '4.'], [5, '5.']])}</div>
    </div>
    <div class="section-title">Regeln</div>
    <div class="settings-grid">${toggles}
      <div class="toggle"><span>Anzahl Bockspiele</span>${seg('bockGames', r.bockGames, [[3, '3'], [4, '4'], [5, '5']])}</div>
    </div>
    <div class="section-title">Online</div>
    <div class="field">
      <input class="input" id="server-url" placeholder="wss://dein-server.onrender.com/ws" value="${esc(prefs.serverUrl)}">
      <span class="muted" style="font-size:12px">Adresse des DoKo-Servers (siehe README). Leer lassen, wenn die Seite direkt vom Server kommt.</span>
    </div>
    <div class="row" style="margin-top:16px;justify-content:space-between">
      <button class="btn" data-act="reset-rules">Standard</button>
      <button class="btn primary" data-act="save-settings">Speichern</button>
    </div>`);
}

function readSettingsForm() {
  const body = $('#modal-body');
  const r = { ...prefs.rules };
  body.querySelectorAll('[data-rule]').forEach((inp) => { r[inp.dataset.rule] = inp.checked; });
  body.querySelectorAll('[data-seg]').forEach((seg) => {
    const on = seg.querySelector('.on');
    if (!on) return;
    const name = seg.dataset.seg;
    if (name === 'speed') prefs.speed = on.dataset.val;
    else if (name === 'bockGames' || name === 'announceUntil') r[name] = Number(on.dataset.val);
    else r[name] = on.dataset.val;
  });
  body.querySelectorAll('[data-pref]').forEach((inp) => { prefs[inp.dataset.pref] = inp.checked; });
  const url = body.querySelector('#server-url');
  if (url) prefs.serverUrl = url.value.trim();
  prefs.rules = mergeRules(r);
  savePrefs();
  if (S.conn && S.conn.kind === 'local') {
    const sp = SPEEDS[prefs.speed];
    S.conn.table.botDelay = sp.botDelay;
    S.conn.table.trickPause = sp.trickPause;
    S.conn.table.setRules(prefs.rules);
    persistLocal(S.conn.table);
  } else if (S.conn && S.conn.kind === 'online' && S.conn.isHost) {
    S.conn.setRules(prefs.rules);
  }
  renderHome();
}

// ---------- Online ----------
function openOnline() {
  const saved = load('doko.online');
  openModal('online', `
    <div class="modal-head"><div><h2>Online spielen</h2><p class="lead">Freunde treten mit dem Raum-Code bei. Freie Plätze übernehmen Bots.</p></div>${closeBtn()}</div>
    <div class="settings-grid">
      <div class="field"><label>Server</label><input class="input" id="srv" placeholder="wss://dein-server.onrender.com/ws" value="${esc(prefs.serverUrl)}"></div>
      <button class="btn primary block" data-act="create-room">Neuen Raum eröffnen</button>
      <div class="row"><input class="input" id="room-code" maxlength="5" placeholder="Code" style="text-transform:uppercase;letter-spacing:.2em;font-weight:800"><button class="btn" data-act="join-room">Beitreten</button></div>
      ${saved ? `<button class="btn block" data-act="rejoin">Zurück in Raum ${esc(saved.room)}</button>` : ''}
      <div class="err" id="online-err"></div>
      <p class="muted" style="font-size:12px;line-height:1.5;margin:0">Der Online-Modus benötigt den kleinen DoKo-Server aus diesem Projekt (<code>npm start</code>), z. B. kostenlos gehostet auf Render.com. Wird die Seite direkt vom Server geladen, ist die Adresse schon eingetragen.</p>
    </div>`);
}

async function goOnline(kind) {
  const url = ($('#srv') && $('#srv').value.trim()) || prefs.serverUrl;
  const errEl = $('#online-err');
  if (!url) { errEl.textContent = 'Bitte eine Server-Adresse eintragen.'; return; }
  prefs.serverUrl = url;
  savePrefs();
  const name = playerName();
  const code = $('#room-code') ? $('#room-code').value.trim() : '';
  if (kind === 'join' && code.length < 4) { errEl.textContent = 'Bitte den Raum-Code eingeben.'; return; }
  errEl.textContent = 'Verbinde …';
  closeConn();
  const conn = new RemoteConnection(url);
  try {
    await conn.connect();
  } catch (e) {
    errEl.textContent = `${e.message}. Läuft der Server?`;
    return;
  }
  conn.on((msg) => {
    if (msg.type === 'joined') save('doko.online', { url, room: msg.room, token: msg.token });
    if (msg.type === 'error' && S.modal === 'online' && $('#online-err')) $('#online-err').textContent = msg.error;
  });
  attach(conn);
  if (kind === 'create') conn.create(name, prefs.rules);
  else if (kind === 'join') conn.join(code, name);
  else {
    const saved = load('doko.online');
    if (saved) conn.rejoin(saved.room, saved.token);
  }
}

function renderLobby(lobby) {
  const conn = S.conn;
  if (!conn) return;
  const seats = lobby.seats.map((s, i) => `
    <div class="seat-row">
      <div class="avatar" style="background:${AVATAR_COLORS[i]}">${s.name ? esc(s.name[0].toUpperCase()) : '?'}</div>
      <div class="grow"><b>${s.name ? esc(s.name) : '<span class="muted">frei – wird Bot</span>'}</b>${i === conn.seat ? ' <span class="muted">(Du)</span>' : ''}${i === lobby.host ? ' <span class="badge info">Host</span>' : ''}</div>
      ${s.name && !s.online ? '<span class="badge off">offline</span>' : ''}
    </div>`).join('');
  const shareUrl = `${location.origin}${location.pathname}?room=${lobby.room}${prefs.serverUrl && prefs.serverUrl !== defaultServerUrl() ? `&server=${encodeURIComponent(prefs.serverUrl)}` : ''}`;
  openModal('lobby', `
    <div class="modal-head"><div><h2>Raum</h2><p class="lead">Teile den Code mit deinen Freunden.</p></div><button class="btn small" data-act="home">Verlassen</button></div>
    <div style="text-align:center;margin:6px 0 4px"><div class="code">${esc(lobby.room)}</div></div>
    <div class="row" style="justify-content:center"><button class="btn small" data-act="share" data-url="${esc(shareUrl)}">Einladungslink teilen</button></div>
    <div class="seats">${seats}</div>
    ${conn.isHost
    ? '<button class="btn primary block" data-act="start-online">Spiel starten</button><p class="muted" style="font-size:12px;text-align:center">Leere Plätze werden mit Bots besetzt. Es gelten deine Regeln.</p>'
    : '<p class="muted" style="text-align:center">Warte, bis der Host das Spiel startet …</p>'}`);
}

// ---------- Eingaben ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act],[data-decl],[data-val]');
  if (!t) return;
  if (t.dataset.val && t.parentElement.dataset.seg) {
    t.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === t));
    return;
  }
  if (t.dataset.decl) {
    if (S.modal === 'solo') closeModal();
    send({ type: 'declare', choice: t.dataset.decl });
    return;
  }
  const act = t.dataset.act;
  switch (act) {
    case 'close': closeModal(); break;
    case 'announce': {
      const g = S.view.game;
      const key = `${S.view.table.gameNo}:${g.nextAnn && g.nextAnn.level}`;
      if (S.annConfirm === key) {
        S.annConfirm = null;
        send({ type: 'announce' });
      } else {
        S.annConfirm = key;
        renderActionbar(S.view);
        setTimeout(() => { if (S.annConfirm === key) { S.annConfirm = null; if (S.view) renderActionbar(S.view); } }, 3000);
      }
      break;
    }
    case 'solo-picker': openSoloPicker(); break;
    case 'result': openResult(); break;
    case 'next': send({ type: 'next' }); if (S.conn && S.conn.kind === 'local') closeModal(); break;
    case 'scores': openScores(); break;
    case 'settings': openSettings(); break;
    case 'save-settings': readSettingsForm(); closeModal(); toast('Gespeichert'); break;
    case 'reset-rules': prefs.rules = { ...DEFAULT_RULES }; savePrefs(); openSettings(); break;
    case 'new-round':
      if (confirm('Neue Runde starten? Der aktuelle Punktestand wird gelöscht.')) {
        closeModal();
        save('doko.table', null);
        startLocal();
      }
      break;
    case 'home':
      closeModal();
      if (S.conn && S.conn.kind === 'online') save('doko.online', null);
      closeConn();
      renderHome();
      showScreen('home');
      break;
    case 'create-room': goOnline('create'); break;
    case 'join-room': goOnline('join'); break;
    case 'rejoin': goOnline('rejoin'); break;
    case 'start-online': S.conn && S.conn.startGame(); break;
    case 'botify-menu': {
      const t2 = S.view.table;
      t2.players.forEach((p, i) => { if (p.kind === 'human' && p.online === false) S.conn.botify(i); });
      closeModal();
      break;
    }
    case 'share': {
      const url = t.dataset.url;
      if (navigator.share) navigator.share({ title: 'DoKo 2026', text: 'Komm an den Doppelkopf-Tisch!', url }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Link kopiert'));
      break;
    }
    default:
  }
});

$('#hand').addEventListener('click', (e) => {
  const cardEl = e.target.closest('.card');
  if (!cardEl || !S.view) return;
  const g = S.view.game;
  const id = cardEl.dataset.card;
  if (g.phase !== 'playing') return;
  if (g.turn !== g.seat) {
    S.selected = S.selected === id ? null : id;
    renderHand(S.view);
    return;
  }
  if (!g.legal.includes(id)) {
    toast(g.trick.cards.length ? 'Du musst bedienen!' : 'Nicht erlaubt');
    return;
  }
  if (prefs.quickPlay || S.selected === id) {
    S.selected = null;
    send({ type: 'play', card: id });
  } else {
    S.selected = id;
    renderHand(S.view);
  }
});

$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal' && !['lobby'].includes(S.modal)) closeModal();
});

$('#btn-new').addEventListener('click', () => {
  if (load('doko.table') && !confirm('Neue Runde starten? Die gespeicherte Runde wird überschrieben.')) return;
  save('doko.table', null);
  startLocal();
});
$('#btn-continue').addEventListener('click', () => startLocal(load('doko.table')));
$('#btn-online').addEventListener('click', () => { playerName(); openOnline(); });
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-menu').addEventListener('click', openMenu);
$('#btn-score').addEventListener('click', openScores);
$('#btn-last').addEventListener('click', openLastTrick);
$('#name-input').addEventListener('change', playerName);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.modal && S.modal !== 'lobby') closeModal(); });

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (S.view && S.view.game) renderHand(S.view); }, 80);
});

// ---------- Start ----------
renderHome();
const params = new URLSearchParams(location.search);
if (params.get('server')) { prefs.serverUrl = params.get('server'); savePrefs(); }
if (params.get('room')) {
  openOnline();
  $('#room-code').value = params.get('room');
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
