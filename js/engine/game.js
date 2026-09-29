// Zustandsmaschine für ein einzelnes Spiel (Geben → Vorbehalt → Stiche → Abrechnung).
// Der Zustand ist reines JSON, damit er gespeichert und über das Netz übertragen werden kann.
import { makeDeck, shuffle, isClubQueen, isFox, eyesOf, suitOf } from './cards.js';
import {
  CONTRACTS, SOLO_TYPES, schweineApply, winningIndex, legalCards, sortHand, cardClass,
} from './rules.js';
import { scoreGame } from './scoring.js';

export const ANN_LABELS = ['', null, 'keine 90', 'keine 60', 'keine 30', 'schwarz'];
export const annLabel = (party, lvl) => (lvl === 1 ? (party === 're' ? 'Re' : 'Kontra') : ANN_LABELS[lvl]);

export const DECLARATION_LABELS = {
  gesund: 'Gesund',
  hochzeit: 'Hochzeit',
  ...Object.fromEntries(SOLO_TYPES.map((t) => [t, CONTRACTS[t].label])),
};

const next = (seat, n = 1) => (seat + n) % 4;

export function createGame({ rules, dealer, rng = Math.random, hands = null }) {
  let dealt = hands;
  if (!dealt) {
    const deck = shuffle(makeDeck(), rng);
    dealt = [0, 1, 2, 3].map((i) => deck.slice(i * 10, i * 10 + 10));
  }
  const ctx = { contract: 'normal', schweine: false, secondDulleBeats: rules.secondDulleBeats };
  return {
    rules,
    dealer,
    phase: 'vorbehalt',
    hands: dealt.map((h) => sortHand(h, ctx)),
    initialHands: dealt.map((h) => sortHand(h, ctx)),
    vorbehalt: { turn: next(dealer), declarations: [null, null, null, null] },
    contract: null, // { type, soloist, hochzeit, clarified, clarifyTricks }
    parties: [null, null, null, null],
    revealed: [null, null, null, null],
    schweine: null, // Sitz mit beiden Füchsen (falls Regel aktiv)
    schweineAnnounced: false,
    ann: { re: 0, kontra: 0 },
    annBySeat: [0, 0, 0, 0],
    annLog: [], // [{seat, party, level, trick}]
    trick: { leader: null, cards: [] },
    tricks: [],
    turn: null,
    result: null,
    events: [],
  };
}

export function ctxOf(g) {
  return {
    contract: g.contract ? g.contract.type : 'normal',
    schweine: g.schweine !== null,
    secondDulleBeats: g.rules.secondDulleBeats,
  };
}

/** Wer muss gerade handeln? (für Bots und Anzeige) */
export function actorOf(g) {
  if (g.phase === 'vorbehalt') return g.vorbehalt.turn;
  if (g.phase === 'playing') return g.turn;
  return null;
}

export function availableDeclarations(g, seat) {
  const out = ['gesund'];
  const qs = g.hands[seat].filter(isClubQueen).length;
  if (qs === 2) out.push('hochzeit');
  if (g.rules.solosAllowed) out.push(...SOLO_TYPES);
  return out;
}

function pushEvent(g, ev) {
  g.eventSeq = (g.eventSeq || 0) + 1;
  ev.id = g.eventSeq;
  g.events.push(ev);
  if (g.events.length > 60) g.events.shift();
}

// ---------- Aktionen ----------

export function applyAction(g, seat, action) {
  if (!action || typeof action !== 'object') return fail('Ungültige Aktion');
  switch (action.type) {
    case 'declare': return declare(g, seat, action.choice);
    case 'play': return play(g, seat, action.card);
    case 'announce': return announce(g, seat);
    default: return fail('Unbekannte Aktion');
  }
}

const fail = (error) => ({ ok: false, error });
const OK = { ok: true };

function declare(g, seat, choice) {
  if (g.phase !== 'vorbehalt') return fail('Kein Vorbehalt möglich');
  if (g.vorbehalt.turn !== seat) return fail('Du bist nicht dran');
  if (!availableDeclarations(g, seat).includes(choice)) return fail('Nicht erlaubt');
  g.vorbehalt.declarations[seat] = choice;
  pushEvent(g, { type: 'declare', seat, vorbehalt: choice !== 'gesund' });
  const nextSeat = next(seat);
  if (nextSeat !== next(g.dealer)) {
    g.vorbehalt.turn = nextSeat;
    return OK;
  }
  resolveVorbehalt(g);
  return OK;
}

function resolveVorbehalt(g) {
  const order = [1, 2, 3, 4].map((i) => next(g.dealer, i));
  const decl = g.vorbehalt.declarations;
  g.vorbehalt.turn = null;
  const soloSeat = order.find((s) => decl[s].startsWith('solo-'));
  const hochSeat = order.find((s) => decl[s] === 'hochzeit');
  let leader = next(g.dealer);

  if (soloSeat !== undefined) {
    g.contract = { type: decl[soloSeat], soloist: soloSeat };
    for (let s = 0; s < 4; s++) g.parties[s] = s === soloSeat ? 're' : 'kontra';
    g.revealed = g.parties.slice();
    if (g.rules.soloistLeads) leader = soloSeat;
    pushEvent(g, { type: 'contract', contract: g.contract.type, seat: soloSeat });
  } else if (hochSeat !== undefined) {
    if (g.rules.hochzeitMode === 'payout') {
      g.contract = { type: 'normal', hochzeit: hochSeat, payout: true };
      g.phase = 'finished';
      const bonus = g.rules.hochzeitBonus;
      const perSeat = [0, 1, 2, 3].map((s) => (s === hochSeat ? bonus : -bonus / 3));
      g.result = { kind: 'hochzeit', seat: hochSeat, perSeat, triggers: [] };
      pushEvent(g, { type: 'contract', contract: 'hochzeit', seat: hochSeat });
      return;
    }
    g.contract = { type: 'normal', hochzeit: hochSeat, clarified: false, clarifyTricks: 0 };
    for (let s = 0; s < 4; s++) g.parties[s] = s === hochSeat ? 're' : 'kontra';
    g.revealed[hochSeat] = 're';
    pushEvent(g, { type: 'contract', contract: 'hochzeit', seat: hochSeat });
  } else {
    g.contract = { type: 'normal' };
    for (let s = 0; s < 4; s++) g.parties[s] = g.hands[s].some(isClubQueen) ? 're' : 'kontra';
    // Stilles Solo: beide Kreuz-Damen, aber "gesund" gesagt.
    const qs = g.parties.filter((p) => p === 're').length;
    if (qs === 1) g.contract.silentSolo = g.parties.indexOf('re');
    pushEvent(g, { type: 'contract', contract: 'normal' });
  }

  if (g.rules.schweine && schweineApply(g.contract.type)) {
    const s = [0, 1, 2, 3].find((i) => g.hands[i].filter(isFox).length === 2);
    if (s !== undefined) g.schweine = s;
  }
  const ctx = ctxOf(g);
  g.hands = g.hands.map((h) => sortHand(h, ctx));
  g.phase = 'playing';
  g.turn = leader;
  g.trick = { leader, cards: [] };
}

export function isSoloGame(g) {
  if (!g.contract) return false;
  return g.parties.filter((p) => p === 're').length === 1;
}

/** Nächste mögliche Ansage (Level 1–5) für den Sitz oder null. */
export function nextAnnouncement(g, seat) {
  if (g.phase !== 'playing' || !g.contract) return null;
  const c = g.contract;
  if (c.hochzeit !== undefined && !c.clarified) return null;
  const party = g.parties[seat];
  const opp = party === 're' ? 'kontra' : 're';
  const lvl = g.ann[party];
  const want = lvl + 1;
  if (want > 5) return null;
  const offset = c.hochzeit !== undefined ? c.clarifyTricks : 0;
  let minCards = 10 - want - offset;
  if (want === 1 && g.ann[opp] >= 1) minCards -= 1; // Erwiderung einen Stich später erlaubt
  return g.hands[seat].length >= minCards ? want : null;
}

function announce(g, seat) {
  const want = nextAnnouncement(g, seat);
  if (!want) return fail('Ansage nicht (mehr) möglich');
  const party = g.parties[seat];
  g.ann[party] = want;
  g.annBySeat[seat] = want;
  g.annLog.push({ seat, party, level: want, trick: g.tricks.length });
  g.revealed[seat] = party;
  deduceRevealed(g);
  pushEvent(g, { type: 'announce', seat, party, level: want, label: annLabel(party, want) });
  return OK;
}

/** Öffentlich bekannte Parteien ableiten: 2× Re oder 3× Kontra bekannt → alles klar. */
function deduceRevealed(g) {
  const re = g.revealed.filter((p) => p === 're').length;
  const ko = g.revealed.filter((p) => p === 'kontra').length;
  if (re === 2 || ko === 3) g.revealed = g.parties.slice();
}

function play(g, seat, card) {
  if (g.phase !== 'playing') return fail('Es wird gerade nicht gespielt');
  if (g.turn !== seat) return fail('Du bist nicht dran');
  const hand = g.hands[seat];
  if (!hand.includes(card)) return fail('Karte nicht auf der Hand');
  const ctx = ctxOf(g);
  const legal = legalCards(hand, g.trick.cards, ctx);
  if (!legal.includes(card)) return fail('Farbe bedienen!');

  g.hands[seat] = hand.filter((c) => c !== card);
  g.trick.cards.push({ seat, card });
  pushEvent(g, { type: 'play', seat, card });

  if (g.contract.type === 'normal' && g.contract.hochzeit === undefined && isClubQueen(card)) {
    if (g.revealed[seat] === 're' && g.contract.silentSolo === seat) {
      g.revealed = g.parties.slice(); // zweite Kreuz-Dame vom selben Spieler → Solo erkennbar
    } else {
      g.revealed[seat] = 're';
    }
    deduceRevealed(g);
  }
  if (g.schweine === seat && isFox(card) && !g.schweineAnnounced) {
    g.schweineAnnounced = true;
    pushEvent(g, { type: 'schweine', seat });
  }

  if (g.trick.cards.length < 4) {
    g.turn = next(seat);
    return OK;
  }
  // Stich ist komplett
  const wi = winningIndex(g.trick.cards, ctx);
  const winner = g.trick.cards[wi].seat;
  const eyes = g.trick.cards.reduce((s, c) => s + eyesOf(c.card), 0);
  const done = { leader: g.trick.leader, cards: g.trick.cards, winner, eyes };
  g.tricks.push(done);
  pushEvent(g, { type: 'trick', winner, eyes, n: g.tricks.length });

  const c = g.contract;
  if (c.hochzeit !== undefined && !c.clarified) {
    if (winner !== c.hochzeit) {
      g.parties[winner] = 're';
      c.clarified = true;
      c.partner = winner;
      c.clarifyTricks = g.tricks.length;
      g.revealed = g.parties.slice();
      pushEvent(g, { type: 'hochzeitPartner', seat: winner });
    } else if (g.tricks.length >= 3) {
      c.clarified = true;
      c.clarifyTricks = g.tricks.length;
      g.revealed = g.parties.slice();
      pushEvent(g, { type: 'hochzeitSolo', seat: c.hochzeit });
    }
  }

  if (g.tricks.length === 10) {
    g.phase = 'finished';
    g.turn = null;
    g.trick = { leader: null, cards: [] };
    g.revealed = g.parties.slice();
    g.result = scoreGame(g);
    return OK;
  }
  g.turn = winner;
  g.trick = { leader: winner, cards: [] };
  return OK;
}

// ---------- Sicht eines Spielers (keine fremden Karten!) ----------

export function publicParties(g, seat) {
  const out = g.revealed.slice();
  if (seat !== null && seat !== undefined && g.contract && out[seat] === null) {
    const hochUnclear = g.contract.hochzeit !== undefined && !g.contract.clarified;
    if (!hochUnclear) out[seat] = g.parties[seat];
  }
  return out;
}

export function getGameView(g, seat) {
  const ctx = ctxOf(g);
  const mine = seat !== null && seat !== undefined;
  const legal = mine && g.phase === 'playing' && g.turn === seat
    ? legalCards(g.hands[seat], g.trick.cards, ctx) : [];
  const played = g.tricks.flatMap((t) => t.cards.map((c) => c.card)).concat(g.trick.cards.map((c) => c.card));
  const nextAnn = mine ? nextAnnouncement(g, seat) : null;
  const finished = g.phase === 'finished';
  return {
    seat: mine ? seat : null,
    phase: g.phase,
    dealer: g.dealer,
    rules: g.rules,
    hand: mine ? g.hands[seat].slice() : [],
    handCounts: g.hands.map((h) => h.length),
    declarations: g.vorbehalt.declarations.map((d, s) => {
      if (d === null || d === 'gesund' || s === seat) return d;
      const c = g.contract;
      if (c && (c.soloist === s || c.hochzeit === s)) return d;
      return 'vorbehalt';
    }),
    vorbehaltTurn: g.vorbehalt.turn,
    options: mine && g.phase === 'vorbehalt' && g.vorbehalt.turn === seat ? availableDeclarations(g, seat) : [],
    contract: g.contract ? publicContract(g) : null,
    ctx,
    parties: publicParties(g, seat),
    myParty: mine ? publicParties(g, seat)[seat] : null,
    ann: { ...g.ann },
    annBySeat: g.annBySeat.slice(),
    annLog: g.annLog.slice(),
    nextAnn: nextAnn ? { level: nextAnn, label: annLabel(g.parties[seat], nextAnn) } : null,
    schweine: g.schweineAnnounced ? g.schweine : (mine && g.schweine === seat ? seat : null),
    schweineAnnounced: g.schweineAnnounced,
    trick: { leader: g.trick.leader, cards: g.trick.cards.slice() },
    lastTrick: g.tricks.length ? g.tricks[g.tricks.length - 1] : null,
    tricksWon: [0, 1, 2, 3].map((s) => g.tricks.filter((t) => t.winner === s).length),
    trickCount: g.tricks.length,
    played,
    playedTricks: g.tricks.map((t) => t.cards),
    turn: g.turn,
    legal,
    events: g.events.slice(-12),
    result: finished ? g.result : null,
    tricks: finished ? g.tricks : null,
    initialHands: finished ? g.initialHands : null,
  };
}

function publicContract(g) {
  const c = g.contract;
  const out = { type: c.type, label: CONTRACTS[c.type].label, solo: CONTRACTS[c.type].solo };
  if (c.soloist !== undefined) out.soloist = c.soloist;
  if (c.hochzeit !== undefined) {
    out.hochzeit = c.hochzeit;
    out.clarified = !!c.clarified;
    out.label = 'Hochzeit';
    if (c.clarified) out.partner = c.partner ?? null;
  }
  if (g.phase === 'finished' && c.silentSolo !== undefined) {
    out.silentSolo = c.silentSolo;
    out.label = 'Stilles Solo';
  }
  return out;
}

export { cardClass, suitOf };
