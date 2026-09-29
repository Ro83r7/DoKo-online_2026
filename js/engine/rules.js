// Spielarten, Trumpfreihenfolge, Stichauswertung und Bedienpflicht.
import { suitOf, rankOf, SUIT_ORDER, FEHL_ORDER, SUITS } from './cards.js';

/**
 * trumpSuit: Farbe, die (zusätzlich) Trumpf ist
 * trumpQ/trumpJ: Damen/Buben sind Trumpf
 * Herz-Zehn (Dulle) ist Trumpf, sobald Damen UND Buben Trumpf sind.
 */
export const CONTRACTS = {
  normal: { label: 'Normalspiel', short: 'Normal', solo: false, trumpSuit: 'D', trumpQ: true, trumpJ: true },
  'solo-D': { label: 'Karo-Solo', short: 'Karo-Solo', solo: true, trumpSuit: 'D', trumpQ: true, trumpJ: true },
  'solo-H': { label: 'Herz-Solo', short: 'Herz-Solo', solo: true, trumpSuit: 'H', trumpQ: true, trumpJ: true },
  'solo-S': { label: 'Pik-Solo', short: 'Pik-Solo', solo: true, trumpSuit: 'S', trumpQ: true, trumpJ: true },
  'solo-C': { label: 'Kreuz-Solo', short: 'Kreuz-Solo', solo: true, trumpSuit: 'C', trumpQ: true, trumpJ: true },
  'solo-Q': { label: 'Damen-Solo', short: 'Damen-Solo', solo: true, trumpSuit: null, trumpQ: true, trumpJ: false },
  'solo-J': { label: 'Buben-Solo', short: 'Buben-Solo', solo: true, trumpSuit: null, trumpQ: false, trumpJ: true },
  'solo-0': { label: 'Fleischloser', short: 'Fleischlos', solo: true, trumpSuit: null, trumpQ: false, trumpJ: false },
};

export const SOLO_TYPES = ['solo-Q', 'solo-J', 'solo-C', 'solo-S', 'solo-H', 'solo-D', 'solo-0'];

/** Beide Füchse gelten nur als Schweine, wenn Karo Trumpffarbe ist. */
export function schweineApply(contract) {
  const c = CONTRACTS[contract];
  return c.trumpQ && c.trumpJ && c.trumpSuit === 'D';
}

/**
 * Trumpfrang einer Karte (höher = stärker) oder -1, wenn kein Trumpf.
 * ctx = { contract, schweine: boolean }
 */
export function trumpRank(id, ctx) {
  const c = CONTRACTS[ctx.contract];
  const suit = suitOf(id);
  const rank = rankOf(id);
  const full = c.trumpQ && c.trumpJ;
  if (full && ctx.schweine && c.trumpSuit === 'D' && suit === 'D' && rank === 'A') return 100;
  if (full && suit === 'H' && rank === '10') return 90;
  if (c.trumpQ && rank === 'Q') return 80 + SUIT_ORDER[suit];
  if (c.trumpJ && rank === 'J') return 70 + SUIT_ORDER[suit];
  if (c.trumpSuit && suit === c.trumpSuit) return 60 + FEHL_ORDER[rank];
  return -1;
}

export const isTrump = (id, ctx) => trumpRank(id, ctx) >= 0;

/** "T" für Trumpf, sonst die Farbe – das ist die zu bedienende "Farbe". */
export const cardClass = (id, ctx) => (isTrump(id, ctx) ? 'T' : suitOf(id));

/** Schlägt `a` (später gespielt) die bisher höchste Karte `b`? */
export function beats(a, b, leadClass, ctx) {
  const ta = trumpRank(a, ctx);
  const tb = trumpRank(b, ctx);
  if (ta >= 0 || tb >= 0) {
    if (ta < 0) return false;
    if (tb < 0) return true;
    if (ta > tb) return true;
    // Gleiche Karte: nur die zweite Herz-Zehn schlägt die erste (Hausregel).
    if (ta === tb && ta === 90 && ctx.secondDulleBeats) return true;
    return false;
  }
  if (suitOf(a) !== leadClass) return false;
  if (suitOf(b) !== leadClass) return true;
  return FEHL_ORDER[rankOf(a)] > FEHL_ORDER[rankOf(b)];
}

/** Index (in `cards`) der aktuell stechenden Karte. cards = [{seat, card}] */
export function winningIndex(cards, ctx) {
  if (!cards.length) return -1;
  const leadClass = cardClass(cards[0].card, ctx);
  let best = 0;
  for (let i = 1; i < cards.length; i++) {
    if (beats(cards[i].card, cards[best].card, leadClass, ctx)) best = i;
  }
  return best;
}

export function legalCards(hand, trickCards, ctx) {
  if (!trickCards.length) return hand.slice();
  const lead = cardClass(trickCards[0].card, ctx);
  const follow = hand.filter((id) => cardClass(id, ctx) === lead);
  return follow.length ? follow : hand.slice();
}

/** Sortierung für die Anzeige: Trümpfe (hoch → niedrig), dann Kreuz, Pik, Herz, Karo. */
export function sortHand(hand, ctx) {
  const key = (id) => {
    const t = trumpRank(id, ctx);
    if (t >= 0) return 1000 + t;
    return (SUIT_ORDER[suitOf(id)] + 1) * 10 + FEHL_ORDER[rankOf(id)];
  };
  return hand.slice().sort((a, b) => key(b) - key(a) || a.localeCompare(b));
}

/** Stärke einer Karte für Bots (nur relativ). */
export function power(id, ctx) {
  const t = trumpRank(id, ctx);
  return t >= 0 ? 100 + t : FEHL_ORDER[rankOf(id)];
}

export const FEHL_SUITS = (ctx) => SUITS.filter((s) => !(CONTRACTS[ctx.contract].trumpSuit === s));
