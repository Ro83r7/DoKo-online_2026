import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDeck, eyesOf, seededRng, shuffle, trumpRank, winningIndex, legalCards, scoreGame, mergeRules,
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

function handsWithHochzeit(rng) {
  const rest = shuffle(makeDeck().filter((c) => !c.startsWith('CQ')), rng);
  return [rest.slice(0, 10), ['CQ0', 'CQ1', ...rest.slice(10, 18)], rest.slice(18, 28), rest.slice(28, 38)];
}

function playRandom(g, rng, until = () => false) {
  while (g.phase === 'playing' && !until()) {
    const v = getGameView(g, g.turn);
    assert.ok(applyAction(g, g.turn, { type: 'play', card: v.legal[Math.floor(rng() * v.legal.length)] }).ok);
  }
}

test('Hochzeit: Ansage „erster Fehlstich“ / „erster Trumpfstich“, sonst allein', () => {
  const rng = seededRng(11);
  const seen = { partner: 0, alone: 0, T: 0, F: 0 };
  for (let n = 0; n < 400; n++) {
    const mode = n % 2 ? 'T' : 'F';
    const g = createGame({ rules, dealer: 0, hands: handsWithHochzeit(rng) });
    const v = getGameView(g, 1);
    assert.ok(v.options.includes('hochzeit-F') && v.options.includes('hochzeit-T'));
    assert.ok(applyAction(g, 1, { type: 'declare', choice: `hochzeit-${mode}` }).ok);
    for (const s of [2, 3, 0]) applyAction(g, s, { type: 'declare', choice: 'gesund' });
    assert.equal(g.phase, 'playing');
    // Vor der Klärung darf niemand ansagen
    for (let s = 0; s < 4; s++) assert.equal(getGameView(g, s).nextAnn, null);
    playRandom(g, rng);
    const ctx = { contract: 'normal', schweine: g.schweine !== null, secondDulleBeats: true };
    const first = g.tricks.slice(0, 3).find((t) => {
      const isT = trumpRank(t.cards[0].card, ctx) >= 0;
      return (mode === 'T' ? isT : !isT) && t.winner !== 1;
    });
    const r = g.result;
    if (first) {
      seen.partner++;
      seen[mode]++;
      assert.deepEqual(r.reSeats.sort(), [1, first.winner].sort());
      assert.equal(r.solo, false);
    } else {
      seen.alone++;
      assert.deepEqual(r.reSeats, [1]);
      assert.equal(r.solo, true);
      assert.equal(r.perSeat[1], -3 * r.perSeat[0]);
    }
    assert.equal(r.perSeat.reduce((x, y) => x + y, 0), 0);
  }
  assert.ok(seen.partner > 0 && seen.alone > 0 && seen.T > 0 && seen.F > 0, JSON.stringify(seen));
});

function gameAfterTricks(r, n) {
  const g = createGame({ rules: mergeRules(r), dealer: 3, rng: seededRng(5) });
  for (const s of [0, 1, 2, 3]) applyAction(g, s, { type: 'declare', choice: 'gesund' });
  if (g.contract.silentSolo !== undefined) return null;
  for (let i = 0; i < n * 4; i++) {
    const v = getGameView(g, g.turn);
    applyAction(g, g.turn, { type: 'play', card: v.legal[0] });
  }
  return g;
}

test('Ansage-Fristen: Re/Kontra bis die 5. Karte liegt', () => {
  // Nach 4 Stichen (6 Karten auf der Hand) geht Re/Kontra noch
  let g = gameAfterTricks({}, 4);
  for (let s = 0; s < 4; s++) assert.equal(getGameView(g, s).nextAnn.level, 1);
  // Nach 5 Stichen (5. Karte liegt) nicht mehr
  g = gameAfterTricks({}, 5);
  for (let s = 0; s < 4; s++) assert.equal(applyAction(g, s, { type: 'announce' }).ok, false);
  // Absage keine 90 noch bis die 6. Karte liegt
  g = gameAfterTricks({}, 4);
  const s0 = g.turn;
  assert.ok(applyAction(g, s0, { type: 'announce' }).ok);
  const v = getGameView(g, g.turn);
  applyAction(g, g.turn, { type: 'play', card: v.legal[0] });
  for (let i = 0; i < 3; i++) { const w = getGameView(g, g.turn); applyAction(g, g.turn, { type: 'play', card: w.legal[0] }); }
  assert.equal(getGameView(g, s0).nextAnn.level, 2);
});

test('Ansage-Fristen: DKV-Einstellung (bis zur 2. Karte)', () => {
  const g = gameAfterTricks({ announceUntil: 2 }, 2);
  for (let s = 0; s < 4; s++) assert.equal(applyAction(g, s, { type: 'announce' }).ok, false);
});

test('Standardregeln: Fuchs gefangen und Doppelkopf zählen', () => {
  assert.equal(rules.fuchsGefangen, true);
  assert.equal(rules.doppelkopf, true);
  const g = fakeGame({ reEyes: 130 });
  g.tricks[0] = { winner: 2, eyes: 42, cards: [{ seat: 0, card: 'DA0' }, { seat: 1, card: 'H100' }, { seat: 2, card: 'H101' }, { seat: 3, card: 'DK0' }] };
  // Augen wieder auf 240 bringen ist hier egal – geprüft werden nur die Sonderpunkte
  const res = scoreGame(g);
  assert.ok(res.special.some((x) => x.label === 'Doppelkopf' && x.party === 'kontra'));
  assert.ok(res.special.some((x) => x.label === 'Fuchs gefangen' && x.party === 'kontra'));
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
  for (const r of [{}, { fuchsGefangen: false, doppelkopf: false, announceUntil: 2 }]) {
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
