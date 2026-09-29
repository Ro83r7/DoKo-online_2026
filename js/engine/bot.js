// Einfache, aber solide Heuristik-KI. Sie sieht NUR, was auch ein Mensch am Platz sehen würde (getGameView).
import { suitOf, rankOf, eyesOf, isFox, isClubQueen, isDulle } from './cards.js';
import { trumpRank, winningIndex, cardClass, CONTRACTS, SOLO_TYPES, legalCards, power } from './rules.js';

// ---------- Handbewertung ----------

function handStrength(hand, ctx) {
  let s = 0;
  let trumps = 0;
  for (const id of hand) {
    const t = trumpRank(id, ctx);
    if (t >= 0) {
      trumps++;
      if (t >= 100) s += 3.5;
      else if (t === 90) s += 3;
      else if (t >= 83) s += 2.6; // Kreuz-Dame
      else if (t >= 82) s += 2.2;
      else if (t >= 80) s += 1.7;
      else if (t >= 70) s += 1.1;
      else s += 0.6;
    } else if (rankOf(id) === 'A') {
      const suitCount = hand.filter((c) => suitOf(c) === suitOf(id) && trumpRank(c, ctx) < 0).length;
      s += suitCount <= 3 ? 1.5 : 0.8;
    }
  }
  // Fehlfarben-Freiheit ist wertvoll
  for (const suit of ['C', 'S', 'H', 'D']) {
    if (CONTRACTS[ctx.contract].trumpSuit === suit) continue;
    if (!hand.some((c) => suitOf(c) === suit && trumpRank(c, ctx) < 0)) s += 0.8;
  }
  return { s, trumps };
}

export function botDeclare(view) {
  const hand = view.hand;
  const opts = view.options;
  const hochzeit = () => {
    // Mit Fehlkarten zum Abgeben → erster Fehlstich, sonst erster Trumpfstich
    const nctx = { contract: 'normal', schweine: false, secondDulleBeats: true };
    const fehl = hand.filter((c) => trumpRank(c, nctx) < 0 && rankOf(c) !== 'A').length;
    return fehl >= 2 ? 'hochzeit-F' : 'hochzeit-T';
  };
  if (!view.rules.solosAllowed) return opts.includes('hochzeit-F') ? hochzeit() : 'gesund';
  const candidates = [];
  const ctxFor = (type) => ({ contract: type, schweine: false, secondDulleBeats: view.rules.secondDulleBeats });
  for (const type of SOLO_TYPES) {
    if (!opts.includes(type)) continue;
    const ctx = ctxFor(type);
    const aces = hand.filter((c) => rankOf(c) === 'A' && trumpRank(c, ctx) < 0).length;
    if (type === 'solo-Q' || type === 'solo-J') {
      const r = type === 'solo-Q' ? 'Q' : 'J';
      const n = hand.filter((c) => rankOf(c) === r).length;
      const top = hand.filter((c) => rankOf(c) === r && (suitOf(c) === 'C' || suitOf(c) === 'S')).length;
      if (n >= 5 && top >= 3 && n + aces >= 8) candidates.push({ type, score: n + aces });
    } else if (type === 'solo-0') {
      if (aces >= 6) candidates.push({ type, score: aces + 2 });
    } else {
      const { s, trumps } = handStrength(hand, ctx);
      if (trumps >= 8 && s >= 20) candidates.push({ type, score: s / 2 });
    }
  }
  if (!candidates.length) return opts.includes('hochzeit-F') ? hochzeit() : 'gesund';
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].type;
}

// ---------- Parteiwissen aus Sicht des Bots ----------

function knownParties(view) {
  const kp = view.parties.slice();
  const me = view.seat;
  const my = view.myParty;
  if (!my) return kp;
  kp[me] = my;
  const c = view.contract;
  if (c && c.type === 'normal' && c.hochzeit === undefined) {
    const playedQ = [];
    for (const t of pastTricks(view).concat([view.trick.cards])) for (const pc of t) if (isClubQueen(pc.card)) playedQ.push(pc.seat);
    if (my === 're') {
      const partner = playedQ.find((s) => s !== me);
      if (partner !== undefined) {
        for (let s = 0; s < 4; s++) kp[s] = s === me || s === partner ? 're' : 'kontra';
      }
    }
  }
  const reCount = kp.filter((p) => p === 're').length;
  const koCount = kp.filter((p) => p === 'kontra').length;
  const reTotal = c && (c.solo || (c.hochzeit !== undefined && c.clarified && c.partner == null)) ? 1 : 2;
  if (reCount === reTotal) for (let s = 0; s < 4; s++) if (!kp[s]) kp[s] = 'kontra';
  if (koCount === 4 - reTotal) for (let s = 0; s < 4; s++) if (!kp[s]) kp[s] = 're';
  return kp;
}

// Vergangene Stiche (Sitz + Karte) – öffentlich, jeder am Tisch hätte sie sehen können.
function pastTricks(view) {
  return view.playedTricks || [];
}

// ---------- Kartenwahl ----------

export function botPlay(view) {
  const legal = view.legal;
  if (legal.length === 1) return legal[0];
  const ctx = view.ctx;
  const kp = knownParties(view);
  const me = view.seat;
  const my = kp[me];
  const trick = view.trick.cards;
  const c = view.contract;
  if (c && c.hochzeit !== undefined && !c.clarified) {
    const h = hochzeitPlay(view, legal, ctx, trick);
    if (h) return h;
  }
  if (!trick.length) return lead(view, legal, ctx, kp);
  return follow(view, legal, ctx, kp, my, trick);
}

/** Hochzeit vor der Klärung: Hochzeiter spielt die angesagte Stichart klein an, die anderen wollen sie gewinnen. */
function hochzeitPlay(view, legal, ctx, trick) {
  const c = view.contract;
  const isT = (id) => trumpRank(id, ctx) >= 0;
  const wantT = c.hochzeitMode === 'T';
  if (view.seat === c.hochzeit) {
    if (!trick.length) {
      const fitting = legal.filter((id) => isT(id) === wantT && !isFox(id));
      if (fitting.length) return fitting.sort((a, b) => power(a, ctx) - power(b, ctx))[0];
      return null;
    }
    const leadT = isT(trick[0].card);
    if (leadT === wantT) return lowest(legal, ctx); // Stich den anderen überlassen
    return null;
  }
  return null;
}

const pts = (cards) => cards.reduce((s, c) => s + eyesOf(c.card), 0);

function remainingHigher(view, id, ctx) {
  // Gibt es noch unbekannte Trümpfe, die `id` schlagen können?
  const t = trumpRank(id, ctx);
  const seen = new Set(view.played.concat(view.hand));
  const all = allCards();
  let count = 0;
  for (const c of all) {
    if (seen.has(c)) continue;
    const tc = trumpRank(c, ctx);
    if (tc > t || (tc === t && t === 90 && ctx.secondDulleBeats)) count++;
  }
  return count;
}

let ALL = null;
function allCards() {
  if (!ALL) {
    ALL = [];
    for (const s of ['C', 'S', 'H', 'D']) for (const r of ['A', '10', 'K', 'Q', 'J']) for (const k of [0, 1]) ALL.push(`${s}${r}${k}`);
  }
  return ALL;
}

function lowest(cards, ctx) {
  // Möglichst wenig Augen, dann möglichst schwach; Füchse und Dullen nicht verschenken
  return cards.slice().sort((a, b) => {
    const wa = eyesOf(a) * 2 + (trumpRank(a, ctx) >= 0 ? 3 + trumpRank(a, ctx) / 30 : 0) + (isFox(a) ? 20 : 0);
    const wb = eyesOf(b) * 2 + (trumpRank(b, ctx) >= 0 ? 3 + trumpRank(b, ctx) / 30 : 0) + (isFox(b) ? 20 : 0);
    return wa - wb;
  })[0];
}

function fattest(cards, ctx, safe) {
  // Schmieren: viele Augen, aber keine hohen Trümpfe opfern
  return cards.slice().sort((a, b) => {
    const score = (c) => {
      const t = trumpRank(c, ctx);
      let v = eyesOf(c) * 3;
      if (t >= 80) v -= 40; // Damen / Dulle / Schweine behalten
      if (t >= 70 && t < 80) v -= 10;
      if (isFox(c) && !safe) v -= 30;
      if (isFox(c) && safe) v += 10;
      return v;
    };
    return score(b) - score(a);
  })[0];
}

function suitPlayedBefore(view, suit, ctx) {
  return (view.playedTricks || []).some((t) => cardClass(t[0].card, ctx) === suit);
}

function lead(view, legal, ctx, kp) {
  const me = view.seat;
  const my = kp[me];
  const trumps = legal.filter((c) => trumpRank(c, ctx) >= 0);
  const fehl = legal.filter((c) => trumpRank(c, ctx) < 0);
  const soloist = view.contract && view.contract.solo && view.contract.soloist === me;

  // Sicherer Stich mit dem höchsten Trumpf (keiner kann drüber)
  const topTrump = trumps.slice().sort((a, b) => trumpRank(b, ctx) - trumpRank(a, ctx))[0];
  if (topTrump && remainingHigher(view, topTrump, ctx) === 0 && (soloist || trumps.length >= 4 || view.trickCount >= 6)) {
    if (!(isDulle(topTrump) && remainingDulle(view) && !ctx.secondDulleBeats)) return topTrump;
  }

  // Fehl-Asse in noch nicht gespielten Farben
  const aces = fehl.filter((c) => rankOf(c) === 'A' && !suitPlayedBefore(view, suitOf(c), ctx));
  if (aces.length && !soloist) {
    aces.sort((a, b) => countSuit(legal, suitOf(a), ctx) - countSuit(legal, suitOf(b), ctx));
    return aces[0];
  }
  if (soloist && trumps.length >= 4) {
    // Solist zieht Trumpf
    return trumps.sort((a, b) => trumpRank(b, ctx) - trumpRank(a, ctx))[0];
  }
  if (aces.length) return aces[0];

  if (my === 're' && trumps.length >= 5 && !(view.contract && view.contract.solo)) {
    // Re spielt Trumpf an – mittelhoch, keine Füchse
    const mids = trumps.filter((c) => !isFox(c) && trumpRank(c, ctx) < 90);
    if (mids.length) return mids.sort((a, b) => trumpRank(b, ctx) - trumpRank(a, ctx))[Math.min(1, mids.length - 1)];
  }
  if (fehl.length) {
    // Kurze Fehlfarbe mit wenig Augen anspielen (Partner kann evtl. stechen)
    const bySuit = {};
    for (const c of fehl) (bySuit[suitOf(c)] ||= []).push(c);
    const suits = Object.keys(bySuit).sort((a, b) => bySuit[a].length - bySuit[b].length);
    const s = suits[0];
    return lowest(bySuit[s], ctx);
  }
  return lowest(trumps.filter((c) => !isFox(c)).length ? trumps.filter((c) => !isFox(c)) : trumps, ctx);
}

function remainingDulle(view) {
  const seen = view.played.concat(view.hand).filter(isDulle).length;
  return seen < 2;
}

function countSuit(hand, suit, ctx) {
  return hand.filter((c) => suitOf(c) === suit && trumpRank(c, ctx) < 0).length;
}

function follow(view, legal, ctx, kp, my, trick) {
  const wi = winningIndex(trick, ctx);
  const winnerSeat = trick[wi].seat;
  const winCard = trick[wi].card;
  const isLast = trick.length === 3;
  const partnerWins = kp[winnerSeat] && kp[winnerSeat] === my;
  const oppWins = kp[winnerSeat] && kp[winnerSeat] !== my;
  const trickPts = pts(trick);
  const leadClass = cardClass(trick[0].card, ctx);

  const winning = legal.filter((c) => {
    const test = trick.concat([{ seat: view.seat, card: c }]);
    return winningIndex(test, ctx) === test.length - 1;
  });

  // Nach mir: sitzen dort Gegner?
  const after = [];
  for (let i = trick.length + 1; i < 4; i++) after.push((trick[0].seat + i) % 4);
  const oppAfter = after.some((s) => kp[s] !== my);

  if (partnerWins) {
    const strong = trumpRank(winCard, ctx) >= 0
      ? remainingHigher(view, winCard, ctx) === 0 || trumpRank(winCard, ctx) >= 82
      : rankOf(winCard) === 'A' && !suitPlayedBefore(view, leadClass, ctx);
    if (isLast || !oppAfter || strong) return fattest(legal, ctx, isLast || !oppAfter);
    return lowest(legal, ctx);
  }

  if (winning.length) {
    // Bei Fehl zuerst: mit Ass bedienen, wenn möglich
    if (leadClass !== 'T' && winning.some((c) => cardClass(c, ctx) === leadClass)) {
      const same = winning.filter((c) => cardClass(c, ctx) === leadClass).sort((a, b) => eyesOf(b) - eyesOf(a));
      if (isLast || !suitPlayedBefore(view, leadClass, ctx)) return isLast ? same[same.length - 1] : same[0];
    }
    const sorted = winning.slice().sort((a, b) => trumpRank(a, ctx) - trumpRank(b, ctx));
    if (isLast || !oppAfter) {
      if (trickPts >= 3 || oppWins || !kp[winnerSeat]) {
        const cheap = sorted.find((c) => !isFox(c) || isLast) || sorted[0];
        const cost = trumpRank(cheap, ctx);
        if (trickPts >= 10 || cost < 85 || oppWins) return cheap;
      }
      return lowest(legal, ctx);
    }
    // Nicht letzter: nur mit ausreichend hohem Trumpf übernehmen, wenn es sich lohnt
    const solid = sorted.filter((c) => trumpRank(c, ctx) >= 80 && !isFox(c));
    const safe = sorted.filter((c) => remainingHigher(view, c, ctx) === 0);
    if (trickPts >= 10 && (safe.length || solid.length)) return (safe[0] && trumpRank(safe[0], ctx) <= 95) ? safe[0] : solid[0] || safe[0];
    if (oppWins && trickPts >= 14 && sorted.length) return sorted[sorted.length > 1 ? 1 : 0];
    if (oppWins && solid.length && view.trickCount >= 7) return solid[0];
  }
  return lowest(legal, ctx);
}

// ---------- Ansagen ----------

export function botAnnounce(view) {
  if (!view.nextAnn) return false;
  const lvl = view.nextAnn.level;
  const ctx = view.ctx;
  const { s, trumps } = handStrength(view.hand, ctx);
  const tricksPlayed = view.trickCount;
  const soloist = view.contract && view.contract.solo && view.contract.soloist === view.seat;
  if (lvl === 1) {
    if (tricksPlayed === 0 && view.hand.length === 10) {
      if (soloist) return s >= 22;
      return s >= 15 && trumps >= 6;
    }
    return s >= 14 && trumps >= 5;
  }
  if (lvl === 2) {
    if (soloist) return s >= 27;
    return s >= 20 && trumps >= 7;
  }
  return false;
}

export function botAction(view) {
  if (view.phase === 'vorbehalt') return { type: 'declare', choice: botDeclare(view) };
  if (view.phase === 'playing') {
    if (botAnnounce(view)) return { type: 'announce' };
    return { type: 'play', card: botPlay(view) };
  }
  return null;
}

export { legalCards };
