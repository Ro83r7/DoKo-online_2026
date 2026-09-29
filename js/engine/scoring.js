// Abrechnung nach DKV-Schema (ohne Neunen) plus Hausregeln.
import { isFox, isCharlie, suitOf } from './cards.js';
import { CONTRACTS, trumpRank, winningIndex } from './rules.js';

const THRESH = { 2: 90, 3: 60, 4: 30 }; // Absage-Level → Grenze

/** Hat die Partei mit `eyes`/`tricks` die Absage `lvl` des GEGNERS unterlaufen (= Gegner hat erfüllt)? */
function heldBelow(lvl, eyes, tricks) {
  if (lvl === 5) return tricks === 0;
  return eyes < THRESH[lvl];
}

/** Erreicht die Partei gegen eine gegnerische Absage `lvl` genug für den Sieg? */
function reachedAgainst(lvl, eyes, tricks) {
  if (lvl === 5) return tricks >= 1;
  return eyes >= THRESH[lvl];
}

export function scoreGame(g) {
  const ctx = {
    contract: g.contract.type,
    schweine: g.schweine !== null,
    secondDulleBeats: g.rules.secondDulleBeats,
  };
  const parties = g.parties;
  const reSeats = [0, 1, 2, 3].filter((s) => parties[s] === 're');
  const kontraSeats = [0, 1, 2, 3].filter((s) => parties[s] === 'kontra');
  const solo = reSeats.length === 1;
  const tricksOf = (p) => g.tricks.filter((t) => parties[t.winner] === p);
  const reEyes = tricksOf('re').reduce((s, t) => s + t.eyes, 0);
  const kontraEyes = 240 - reEyes;
  const reTricks = tricksOf('re').length;
  const kontraTricks = 10 - reTricks;
  const eyes = { re: reEyes, kontra: kontraEyes };
  const tricks = { re: reTricks, kontra: kontraTricks };
  const reL = g.ann.re;
  const koL = g.ann.kontra;

  // Wer hat gewonnen?
  let reWins;
  if (reL >= 2) reWins = heldBelow(reL, kontraEyes, kontraTricks);
  else if (koL >= 2) reWins = reachedAgainst(koL, reEyes, reTricks);
  else reWins = reEyes >= 121;
  let koWins;
  if (koL >= 2) koWins = heldBelow(koL, reEyes, reTricks);
  else if (reL >= 2) koWins = reachedAgainst(reL, kontraEyes, kontraTricks);
  else koWins = kontraEyes >= 120;
  const winner = reWins ? 're' : koWins ? 'kontra' : null;

  const items = []; // {label, party, value}
  if (winner) {
    const loser = winner === 're' ? 'kontra' : 're';
    const add = (label, value = 1) => items.push({ label, party: winner, value });
    add(winner === 're' ? 'Gewonnen (Re)' : 'Gewonnen (Kontra)');
    if (eyes[loser] < 90) add('Keine 90 gespielt');
    if (eyes[loser] < 60) add('Keine 60 gespielt');
    if (eyes[loser] < 30) add('Keine 30 gespielt');
    if (tricks[loser] === 0) add('Schwarz gespielt');
    if (reL >= 1) add('Re angesagt', 2);
    if (koL >= 1) add('Kontra angesagt', 2);
    for (const [p, l] of [['re', reL], ['kontra', koL]]) {
      const who = p === 're' ? 'Re' : 'Kontra';
      if (l >= 2) add(`Keine 90 abgesagt (${who})`);
      if (l >= 3) add(`Keine 60 abgesagt (${who})`);
      if (l >= 4) add(`Keine 30 abgesagt (${who})`);
      if (l >= 5) add(`Schwarz abgesagt (${who})`);
    }
    const lL = loser === 're' ? reL : koL;
    if (lL >= 2 && eyes[winner] >= 120) add('120 gegen keine 90');
    if (lL >= 3 && eyes[winner] >= 90) add('90 gegen keine 60');
    if (lL >= 4 && eyes[winner] >= 60) add('60 gegen keine 30');
    if (lL >= 5 && eyes[winner] >= 30) add('30 gegen schwarz');
    if (winner === 'kontra' && !solo) add('Gegen die Alten');
  }

  // Sonderpunkte (nur Normalspiele, nicht im Solo)
  const special = [];
  if (!solo && !CONTRACTS[g.contract.type].solo) {
    g.tricks.forEach((t, i) => {
      const wp = parties[t.winner];
      if (g.rules.doppelkopf && t.eyes >= 40) special.push({ label: 'Doppelkopf', party: wp, value: 1 });
      if (g.rules.fuchsGefangen && g.schweine === null) {
        for (const c of t.cards) {
          if (isFox(c.card) && trumpRank(c.card, ctx) >= 0 && parties[c.seat] !== wp) {
            special.push({ label: 'Fuchs gefangen', party: wp, value: 1 });
          }
        }
      }
      if (g.rules.karlchen && i === 9) {
        const wc = t.cards[winningIndex(t.cards, ctx)].card;
        if (isCharlie(wc)) special.push({ label: 'Karlchen', party: wp, value: 1 });
      }
    });
  }

  const base = items.reduce((s, it) => s + it.value, 0);
  const sp = { re: 0, kontra: 0 };
  for (const it of special) sp[it.party] += it.value;
  // Spielwert aus Sicht von Re (positiv = Re bekommt Punkte)
  let reValue;
  if (winner === 're') reValue = base + sp.re - sp.kontra;
  else if (winner === 'kontra') reValue = -(base + sp.kontra - sp.re);
  else reValue = sp.re - sp.kontra;

  const perSeat = [0, 1, 2, 3].map((s) => {
    if (solo) return parties[s] === 're' ? 3 * reValue : -reValue;
    return parties[s] === 're' ? reValue : -reValue;
  });

  // Bock-Auslöser
  const triggers = [];
  if (g.rules.bockOnZero && reValue === 0) triggers.push('0-Punkte-Spiel');
  if (g.rules.bockOnHeartTrick && g.tricks.some((t) => t.cards.every((c) => suitOf(c.card) === 'H' && trumpRank(c.card, ctx) < 0))) {
    triggers.push('Durchlaufendes Herz');
  }
  if (g.rules.bockOnReKontra && reL >= 1 && koL >= 1) triggers.push('Re und Kontra angesagt');

  return {
    kind: 'game',
    solo,
    soloist: solo ? reSeats[0] : null,
    reSeats,
    kontraSeats,
    reEyes,
    kontraEyes,
    reTricks,
    kontraTricks,
    ann: { re: reL, kontra: koL },
    winner,
    items,
    special,
    reValue,
    perSeat: perSeat.map((v) => v + 0), // -0 vermeiden
    triggers,
  };
}
