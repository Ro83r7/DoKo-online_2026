// Karten, Deck und Hilfsfunktionen – Doppelkopf ohne Neunen (40 Karten).

export const SUITS = ['C', 'S', 'H', 'D'];
export const RANKS = ['A', '10', 'K', 'Q', 'J'];

export const EYES = { A: 11, '10': 10, K: 4, Q: 3, J: 2 };
export const SUIT_NAMES = { C: 'Kreuz', S: 'Pik', H: 'Herz', D: 'Karo' };
export const SUIT_SYMBOLS = { C: '♣', S: '♠', H: '♥', D: '♦' };
export const RANK_NAMES = { A: 'Ass', '10': 'Zehn', K: 'König', Q: 'Dame', J: 'Bube' };
export const RANK_SHORT = { A: 'A', '10': '10', K: 'K', Q: 'D', J: 'B' };

/** Reihenfolge der Farben untereinander (Kreuz > Pik > Herz > Karo). */
export const SUIT_ORDER = { C: 3, S: 2, H: 1, D: 0 };
/** Reihenfolge innerhalb einer Fehlfarbe. */
export const FEHL_ORDER = { A: 5, '10': 4, K: 3, Q: 2, J: 1 };

// Karten-IDs: Farbe + Rang + Kopie, z. B. "CQ0", "H101".
export function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) for (const c of [0, 1]) deck.push(`${s}${r}${c}`);
  return deck;
}

export const suitOf = (id) => id[0];
export const rankOf = (id) => id.slice(1, -1);
export const eyesOf = (id) => EYES[rankOf(id)];
export const sameCard = (a, b) => a.slice(0, -1) === b.slice(0, -1);
export const cardName = (id) => `${SUIT_NAMES[suitOf(id)]} ${RANK_NAMES[rankOf(id)]}`;
export const cardShort = (id) => `${SUIT_SYMBOLS[suitOf(id)]}${RANK_SHORT[rankOf(id)]}`;

export const isClubQueen = (id) => id.startsWith('CQ');
export const isFox = (id) => id.startsWith('DA');
export const isDulle = (id) => id.startsWith('H10');
export const isCharlie = (id) => id.startsWith('CJ');

/** Deterministischer Zufallsgenerator (mulberry32) – für Tests und Server. */
export function seededRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
