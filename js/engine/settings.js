// Hausregeln – Standardwerte entsprechen unserer Runde.

export const DEFAULT_RULES = {
  secondDulleBeats: true,     // 2. Herz-Zehn schlägt die erste
  schweine: true,             // Beide Füchse auf einer Hand = höchste Trümpfe
  karlchen: true,             // Kreuz-Bube macht den letzten Stich: +1
  fuchsGefangen: true,        // Karo-Ass des Gegners gefangen: +1
  doppelkopf: true,           // Stich mit ≥ 40 Augen: +1
  announceUntil: 5,           // Re/Kontra möglich, bis die eigene 5. Karte liegt (DKV: 2)
  solosAllowed: true,         // Freiwillige Soli (keine Pflichtsoli)
  soloistLeads: true,         // Solist spielt aus
  bockGames: 4,               // Anzahl Bockspiele = Spieleranzahl
  bockOnZero: true,           // Bock bei 0-Punkte-Spiel
  bockOnHeartTrick: true,     // Bock bei durchlaufendem Herz
  bockOnReKontra: true,       // Bock wenn Re UND Kontra angesagt
};

export const RULE_LABELS = {
  secondDulleBeats: '2. Herz-Zehn schlägt die erste',
  schweine: 'Schweine (beide Füchse = höchste Trümpfe)',
  karlchen: 'Karlchen (Kreuz-Bube im letzten Stich)',
  fuchsGefangen: 'Fuchs gefangen (+1)',
  doppelkopf: 'Doppelkopf – Stich mit 40+ Augen (+1)',
  solosAllowed: 'Freiwillige Soli erlaubt',
  soloistLeads: 'Solist spielt aus',
  bockOnZero: 'Bock bei 0-Punkte-Spiel',
  bockOnHeartTrick: 'Bock bei durchlaufendem Herz',
  bockOnReKontra: 'Bock bei Re + Kontra',
};

export function mergeRules(rules = {}) {
  const out = { ...DEFAULT_RULES };
  for (const k of Object.keys(DEFAULT_RULES)) {
    if (rules[k] !== undefined && typeof rules[k] === typeof DEFAULT_RULES[k]) out[k] = rules[k];
  }
  out.announceUntil = Math.max(1, Math.min(8, Math.round(out.announceUntil)));
  out.bockGames = Math.max(1, Math.min(8, Math.round(out.bockGames)));
  return out;
}
