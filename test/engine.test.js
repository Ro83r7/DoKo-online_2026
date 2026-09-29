import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDeck, eyesOf, seededRng, trumpRank, winningIndex, legalCards, scoreGame, mergeRules,
  createGame, applyAction, Table, getGameView,
} from '../js/engine/index.js';

const N = { contract: 'normal', schweine: false, secondDulleBeats: true };
const rules = mergeRules();

test('Deck: 40 Karten, 240 Augen', () => {
  const d = makeDeck();
  assert.equal(d.length, 40);
  assert.equal(new Set(d).size, 40);
  assert.equal(d.reduce((s, c) => s + eyesOf(c), 0), 240);
});

test('Trumpfreihenfolge im Normalspiel', () => {
  const order = ['H100', 'CQ0', 'SQ0', 'HQ0', 'DQ0', 'CJ0', 'SJ0', 'HJ0', 'DJ0', 'DA0', 'D100', 'DK0'];
  for (let i = 0; i < order.length - 1; i++) {
    assert.ok(trumpRank(order[i], N) > trumpRank(order[i + 1], N), `${order[i]} > ${order[i + 1]}`);
  }
  assert.equal(trumpRank('HA0', N), -1);
  assert.equal(trumpRank('CA0', N), -1);
});

test('Schweine sind höchste Trümpfe (über der Dulle)', () => {
  const ctx = { ...N, schweine: true };
  assert.ok(trumpRank('DA0', ctx) > trumpRank('H100', ctx));
  const cards = [{ seat: 0, card: 'H100' }, { seat: 1, card: 'DA1' }, { seat: 2, card: 'H101' }, { seat: 3, card: 'CQ0' }];
  assert.equal(cards[winningIndex(cards, ctx)].seat, 1);
});

test('Zweite Herz-Zehn schlägt die erste', () => {
  const cards = [{ seat: 0, card: 'H100' }, { seat: 1, card: 'CQ0' }, { seat: 2, card: 'H101' }, { seat: 3, card: 'DK0' }];
  assert.equal(cards[winningIndex(cards, N)].seat, 2);
  assert.equal(cards[winningIndex(cards, { ...N, secondDulleBeats: false })].seat, 0);
});

test('Gleiche Karten: erste gewinnt (außer Dulle)', () => {
  const cards = [{ seat: 0, card: 'CA0' }, { seat: 1, card: 'CA1' }, { seat: 2, card: 'CK0' }, { seat: 3, card: 'C100' }];
  assert.equal(cards[winningIndex(cards, N)].seat, 0);
});

test('Bedienpflicht: Trumpf auf Trumpf, Herz-Zehn ist kein Herz', () => {
  const hand = ['H100', 'HA0', 'CK0'];
  assert.deepEqual(legalCards(hand, [{ seat: 0, card: 'DK0' }], N), ['H100']);
  assert.deepEqual(legalCards(hand, [{ seat: 0, card: 'HK0' }], N), ['HA0']);
  assert.deepEqual(legalCards(hand, [{ seat: 0, card: 'SA0' }], N).length, 3);
});

test('Damen-Solo: nur Damen sind Trumpf, Herz-Zehn ist Herz', () => {
  const ctx = { contract: 'solo-Q', schweine: false, secondDulleBeats: true };
  assert.equal(trumpRank('H100', ctx), -1);
  assert.equal(trumpRank('CJ0', ctx), -1);
  assert.ok(trumpRank('DQ0', ctx) >= 0);
  const cards = [{ seat: 0, card: 'HK0' }, { seat: 1, card: 'H100' }, { seat: 2, card: 'HA0' }, { seat: 3, card: 'CA0' }];
  assert.equal(cards[winningIndex(cards, ctx)].seat, 2);
});

// ---------- Abrechnung ----------

/** Baut ein fertiges Spiel mit vorgegebener Augenverteilung. */
function fakeGame({ parties = ['re', 're', 'kontra', 'kontra'], reEyes, ann = { re: 0, kontra: 0 }, lastTrick = null, contract = 'normal', r = {} }) {
  // 9 Stiche verteilen, der 10. ist optional vorgegeben
  const tricks = [];
  const reSeat = parties.indexOf('re');
  const koSeat = parties.indexOf('kontra');
  let rest = reEyes;
  let lastEyes = 0;
  if (lastTrick) lastEyes = lastTrick.eyes;
  if (lastTrick && parties[lastTrick.winner] === 're') rest -= lastEyes;
  let restKo = 240 - reEyes - (lastTrick && parties[lastTrick.winner] === 'kontra' ? lastEyes : 0);
  const n = lastTrick ? 9 : 10;
  for (let i = 0; i < n; i++) {
    const giveRe = rest > 0 && (restKo <= 0 || i % 2 === 0);
    const amount = giveRe ? Math.min(rest, 39) : Math.min(restKo, 39);
    tricks.push({ winner: giveRe ? reSeat : koSeat, eyes: i === n - 1 ? (giveRe ? rest : restKo) : amount, cards: [{ seat: 0, card: 'CK0' }, { seat: 1, card: 'CK1' }, { seat: 2, card: 'SK0' }, { seat: 3, card: 'SK1' }] });
    if (giveRe) rest -= tricks[i].eyes; else restKo -= tricks[i].eyes;
  }
  // übrige Augen auf letzte Stiche verteilen (Testhelfer, nicht perfekt realistisch)
  if (rest > 0) tricks.find((t) => parties[t.winner] === 're').eyes += rest;
  if (restKo > 0) tricks.find((t) => parties[t.winner] === 'kontra').eyes += restKo;
  if (lastTrick) tricks.push(lastTrick);
  return { rules: mergeRules(r), contract: { type: contract }, parties, tricks, ann, schweine: null };
}

test('Re gewinnt mit 121: 1 Punkt', () => {
  const res = scoreGame(fakeGame({ reEyes: 121 }));
  assert.equal(res.winner, 're');
  assert.equal(res.reValue, 1);
  assert.deepEqual(res.perSeat, [1, 1, -1, -1]);
});

test('Kontra gewinnt mit 120: gewonnen + gegen die Alten', () => {
  const res = scoreGame(fakeGame({ reEyes: 120 }));
  assert.equal(res.winner, 'kontra');
  assert.equal(res.reValue, -2);
});

test('Re + Kontra angesagt, Re mit 175: 1 + keine 90 + 2 + 2 = 6 und Bock', () => {
  const res = scoreGame(fakeGame({ reEyes: 175, ann: { re: 1, kontra: 1 } }));
  assert.equal(res.reValue, 6);
  assert.ok(res.triggers.includes('Re und Kontra angesagt'));
});

test('Absage keine 90 nicht erfüllt: Kontra gewinnt mit 90', () => {
  const res = scoreGame(fakeGame({ reEyes: 150, ann: { re: 2, kontra: 0 } }));
  assert.equal(res.winner, 'kontra');
  // gewonnen 1 + Re angesagt 2 + keine 90 abgesagt 1 + gegen die Alten 1 = 5
  assert.equal(res.reValue, -5);
});

test('Karlchen im letzten Stich; 0-Punkte-Spiel löst Bock aus', () => {
  const last = { winner: 2, eyes: 8, cards: [{ seat: 0, card: 'DK0' }, { seat: 1, card: 'DK1' }, { seat: 2, card: 'CJ0' }, { seat: 3, card: 'DJ0' }] };
  const res = scoreGame(fakeGame({ reEyes: 125, lastTrick: last }));
  assert.equal(res.winner, 're');
  assert.ok(res.special.some((s) => s.label === 'Karlchen' && s.party === 'kontra'));
  assert.equal(res.reValue, 0);
  assert.ok(res.triggers.includes('0-Punkte-Spiel'));
});

test('Solo zählt dreifach', () => {
  const res = scoreGame(fakeGame({ parties: ['kontra', 're', 'kontra', 'kontra'], reEyes: 130, contract: 'solo-Q' }));
  assert.equal(res.solo, true);
  assert.deepEqual(res.perSeat, [-1, 3, -1, -1]);
});

test('Durchlaufendes Herz löst Bock aus', () => {
  const g = fakeGame({ reEyes: 130 });
  g.tricks[0].cards = [{ seat: 0, card: 'HA0' }, { seat: 1, card: 'HK0' }, { seat: 2, card: 'HA1' }, { seat: 3, card: 'HK1' }];
  assert.ok(scoreGame(g).triggers.includes('Durchlaufendes Herz'));
});

// ---------- Spielablauf ----------

function handsWithHochzeit() {
  const d = makeDeck().filter((c) => !c.startsWith('CQ'));
  return [
    d.slice(0, 10),
    ['CQ0', 'CQ1', ...d.slice(10, 18)],
    d.slice(18, 28),
    d.slice(28, 38),
  ];
}

test('Hochzeit (Auszahlung): +3 für den Hochzeiter, je −1 für die anderen', () => {
  const g = createGame({ rules, dealer: 0, hands: handsWithHochzeit() });
  assert.ok(applyAction(g, 1, { type: 'declare', choice: 'hochzeit' }).ok);
  for (const s of [2, 3, 0]) assert.ok(applyAction(g, s, { type: 'declare', choice: 'gesund' }).ok);
  assert.equal(g.phase, 'finished');
  assert.deepEqual(g.result.perSeat, [-1, 3, -1, -1]);
});

test('Hochzeit (klassisch): erster fremder Stich bestimmt den Partner', () => {
  const g = createGame({ rules: mergeRules({ hochzeitMode: 'play' }), dealer: 0, hands: handsWithHochzeit() });
  applyAction(g, 1, { type: 'declare', choice: 'hochzeit' });
  for (const s of [2, 3, 0]) applyAction(g, s, { type: 'declare', choice: 'gesund' });
  assert.equal(g.phase, 'playing');
  let guard = 0;
  while (!g.contract.clarified && guard++ < 20) {
    const seat = g.turn;
    const v = getGameView(g, seat);
    applyAction(g, seat, { type: 'play', card: v.legal[0] });
  }
  assert.ok(g.contract.clarified);
  const reCount = g.parties.filter((p) => p === 're').length;
  assert.ok(reCount === 1 || reCount === 2);
});

test('Ansage-Fristen: Re nur bis zur 2. Karte', () => {
  const g = createGame({ rules, dealer: 3, rng: seededRng(5) });
  for (const s of [0, 1, 2, 3]) applyAction(g, s, { type: 'declare', choice: 'gesund' });
  // Zwei Stiche spielen
  for (let i = 0; i < 8; i++) {
    const v = getGameView(g, g.turn);
    applyAction(g, g.turn, { type: 'play', card: v.legal[0] });
  }
  for (let s = 0; s < 4; s++) assert.equal(applyAction(g, s, { type: 'announce' }).ok, false);
});

test('Bock: Auslöser → nächste 4 Spiele doppelt', () => {
  const t = new Table({ players: [0, 1, 2, 3].map((i) => ({ name: `B${i}`, kind: 'bot' })), schedule: null, rng: seededRng(3) });
  t.state.bock = [];
  // Simuliere Auslöser direkt
  t.state.game.result = null;
  const trig = ['Re und Kontra angesagt'];
  for (let i = 0; i < trig.length; i++) for (let k = 0; k < t.state.rules.bockGames; k++) t.state.bock[k] = (t.state.bock[k] || 0) + 1;
  t.newGame();
  assert.equal(t.state.multiplier, 2);
});

test('Simulation: 3000 Bot-Spiele laufen fehlerfrei und nullsummig', () => {
  for (const r of [{}, { hochzeitMode: 'play', fuchsGefangen: true, doppelkopf: true }]) {
    const t = new Table({ players: [0, 1, 2, 3].map((i) => ({ name: `B${i}`, kind: 'bot' })), rules: r, schedule: null, rng: seededRng(42) });
    let steps = 0;
    const seenContracts = new Set();
    while (t.state.gameNo <= 1500) {
      if (!t.step()) {
        const g = t.game;
        assert.equal(g.phase, 'finished', 'Tisch hängt');
        if (g.result.kind === 'game') {
          assert.equal(g.result.reEyes + g.result.kontraEyes, 240);
          assert.equal(g.tricks.reduce((s, x) => s + x.eyes, 0), 240);
        }
        seenContracts.add(t.state.history.at(-1).label);
        assert.equal(g.result.perSeat.reduce((a, b) => a + b, 0), 0, 'nicht nullsummig');
        t.act(0, { type: 'next' });
      }
      assert.ok(++steps < 200000);
    }
    assert.equal(t.state.totals.reduce((a, b) => a + b, 0), 0);
    assert.ok(seenContracts.size >= 2, [...seenContracts].join());
  }
});
