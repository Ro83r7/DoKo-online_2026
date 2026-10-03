// Kartenbilder als eigenständige SVGs (französisches Blatt, Doppelkopf ohne Neunen).
// Jede Karte wird einmal erzeugt, als Blob-URL zwischengespeichert und vom Browser dekodiert gecacht.
// Echte Vektor-Symbole statt Schriftzeichen → auf iOS kein Emoji-Herz, überall gestochen scharf.

const W = 250;
const H = 350;
const CX = W / 2;
const CY = H / 2;

// ---------- Farben ----------
const PALETTES = {
  2: {
    C: ['#3a4152', '#10141d'],
    S: ['#3a4152', '#10141d'],
    H: ['#ea3a52', '#b0122b'],
    D: ['#ea3a52', '#b0122b'],
  },
  // Deutsches Turnierbild: Kreuz schwarz, Pik grün, Herz rot, Karo orange
  4: {
    C: ['#3a4152', '#10141d'],
    S: ['#2fa060', '#136b3a'],
    H: ['#ea3a52', '#b0122b'],
    D: ['#f39a2a', '#c2610a'],
  },
};

const GOLD = '#d9a520';
const GOLD_DARK = '#8a6510';
const SKIN = '#f6dcc0';
const SKIN_LINE = '#b98463';
const RED = '#b91c2e';
const BLUE = '#1f3c8c';
const INK = '#1b2130';

const RANK_LABEL = { A: 'A', '10': '10', K: 'K', Q: 'D', J: 'B' };
const SUIT_LABEL = { C: 'Kreuz', S: 'Pik', H: 'Herz', D: 'Karo' };
const RANK_NAME = { A: 'Ass', '10': 'Zehn', K: 'König', Q: 'Dame', J: 'Bube' };

// ---------- Symbole (100×100-Box) ----------
const PATH = {
  H: 'M50 91C50 91 5 62 5 33C5 17 17 7 31 7C40 7 47 12 50 20C53 12 60 7 69 7C83 7 95 17 95 33C95 62 50 91 50 91Z',
  D: 'M50 3C62 22 75 36 91 50C75 64 62 78 50 97C38 78 25 64 9 50C25 36 38 22 50 3Z',
  S: 'M50 5C50 5 95 35 95 61C95 75 85 83 73 83C64 83 57 78 53 71C54 81 58 89 67 95L33 95C42 89 46 81 47 71C43 78 36 83 27 83C15 83 5 75 5 61C5 35 50 5 50 5Z',
};

function suitShape(suit, fill) {
  if (suit === 'C') {
    return `<g fill="${fill}"><circle cx="50" cy="27" r="21"/><circle cx="27" cy="57" r="21"/><circle cx="73" cy="57" r="21"/><circle cx="50" cy="50" r="13"/><path d="M45 56C45 75 40 87 30 96H70C60 87 55 75 55 56Z"/></g>`;
  }
  return `<path d="${PATH[suit]}" fill="${fill}"/>`;
}

/** Symbol mit Mittelpunkt (x, y) und Kantenlänge s, optional auf dem Kopf. */
function pip(suit, x, y, s, fill, flip = false) {
  const k = s / 100;
  const rot = flip ? ` rotate(180 50 50)` : '';
  return `<g transform="translate(${x - s / 2} ${y - s / 2}) scale(${k})${rot}">${suitShape(suit, fill)}</g>`;
}

// ---------- Ecken ----------
function corner(rank, suit, fill) {
  const label = RANK_LABEL[rank];
  const ten = label.length > 1;
  const text = `<text x="27" y="${ten ? 50 : 52}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${ten ? 34 : 42}" letter-spacing="${ten ? -3 : 0}" fill="${fill}">${label}</text>`;
  const one = `<g>${text}${pip(suit, 27, 75, 25, fill)}</g>`;
  return `${one}<g transform="rotate(180 ${CX} ${CY})">${one}</g>`;
}

// ---------- Zahlenkarten ----------
function aceFace(suit, fill, pal) {
  const ring = pal[1];
  const orn = (x, y) => `<path d="M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z" fill="${GOLD}"/>`;
  return `
    <circle cx="${CX}" cy="${CY}" r="86" fill="none" stroke="${ring}" stroke-opacity=".14" stroke-width="1.5"/>
    <circle cx="${CX}" cy="${CY}" r="78" fill="none" stroke="${GOLD}" stroke-opacity=".55" stroke-width="1" stroke-dasharray="2 5"/>
    ${orn(CX, CY - 86)}${orn(CX, CY + 86)}${orn(CX - 86, CY)}${orn(CX + 86, CY)}
    <g filter="url(#soft)">${pip(suit, CX, CY + 2, 118, fill)}</g>`;
}

function tenFace(suit, fill) {
  const xs = [80, 170];
  const ys = [82, 145, 205, 268];
  let out = '';
  for (const x of xs) for (const y of ys) out += pip(suit, x, y, 46, fill, y > CY);
  out += pip(suit, CX, 113, 46, fill) + pip(suit, CX, 237, 46, fill, true);
  return out;
}

// ---------- Bildkarten (obere Hälfte, wird gespiegelt) ----------
function robe(primary, secondary) {
  return `
    <path d="M66 175L69 156Q74 139 100 131H150Q176 139 181 156L184 175Z" fill="${primary}"/>
    <path d="M66 175L69 156Q74 139 100 131H150Q176 139 181 156L184 175Z" fill="url(#sheen)"/>
    <path d="M103 133L125 172L147 133Z" fill="${secondary}"/>
    <path d="M99 131L125 175L151 131" fill="none" stroke="${GOLD}" stroke-width="4.5" stroke-linejoin="round"/>
    <rect x="116" y="112" width="18" height="22" fill="${SKIN}"/>`;
}

function face({ beard = false, lashes = false, lips = '#b4333f' } = {}) {
  return `
    <ellipse cx="125" cy="96" rx="19" ry="22" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1"/>
    <circle cx="114" cy="103" r="3.4" fill="#f0a39a" opacity=".55"/>
    <circle cx="136" cy="103" r="3.4" fill="#f0a39a" opacity=".55"/>
    <ellipse cx="118" cy="94" rx="2.3" ry="1.7" fill="#2a1a12"/>
    <ellipse cx="132" cy="94" rx="2.3" ry="1.7" fill="#2a1a12"/>
    ${lashes ? '<path d="M114.5 92L113 90M121.5 92L123 90M128.5 92L127 90M135.5 92L137 90" stroke="#2a1a12" stroke-width="1"/>' : ''}
    <path d="M113 88Q118 85 122 88M128 88Q132 85 137 88" stroke="#5b3a21" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M125 95Q122.5 102 126 103.5" stroke="${SKIN_LINE}" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    ${beard ? '' : `<path d="M120 110Q125 113.5 130 110" stroke="${lips}" stroke-width="2" fill="none" stroke-linecap="round"/>`}`;
}

function arm(color, d, hx, hy) {
  return `<path d="${d}" stroke="${color}" stroke-width="11" fill="none" stroke-linecap="round"/>
    <path d="${d}" stroke="#000" stroke-opacity=".12" stroke-width="11" fill="none" stroke-linecap="round" stroke-dasharray="0 6 30"/>
    <circle cx="${hx}" cy="${hy}" r="5.6" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width=".9"/>`;
}

function king(primary, secondary) {
  return `
    <path d="M104 92Q102 72 125 71Q148 72 146 92L149 112Q142 101 140 92H110Q108 101 101 112Z" fill="#d9d3c6"/>
    ${robe(primary, secondary)}
    <path d="M86 141Q125 125 164 141Q162 152 150 149Q125 140 100 149Q88 152 86 141Z" fill="#fbfaf6" stroke="#cfc9bc" stroke-width="1"/>
    <g fill="${INK}"><circle cx="99" cy="143" r="1.7"/><circle cx="113" cy="138.5" r="1.7"/><circle cx="137" cy="138.5" r="1.7"/><circle cx="151" cy="143" r="1.7"/></g>
    ${face({ beard: true })}
    <path d="M106 99Q107 127 125 133Q143 127 144 99Q137 114 125 114Q113 114 106 99Z" fill="#ece7dc" stroke="#cfc9bc" stroke-width="1"/>
    <path d="M113 107Q120 101 125 105Q130 101 137 107Q130 110.5 125 108Q120 110.5 113 107Z" fill="#d3ccbe"/>
    <path d="M101 77L99 50L110 62L118 43L125 57L132 43L140 62L151 50L149 77Z" fill="${GOLD}" stroke="${GOLD_DARK}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M101 77L99 50L110 62L118 43L125 57L132 43L140 62L151 50L149 77Z" fill="url(#sheen)"/>
    <rect x="100" y="70" width="50" height="9" rx="2" fill="#b8860b"/>
    <circle cx="112" cy="74.5" r="2.6" fill="${RED}"/><circle cx="125" cy="74.5" r="3.1" fill="${BLUE}"/><circle cx="138" cy="74.5" r="2.6" fill="${RED}"/>
    <g fill="${GOLD}" stroke="${GOLD_DARK}" stroke-width=".8"><circle cx="99" cy="50" r="2.6"/><circle cx="118" cy="43" r="2.6"/><circle cx="132" cy="43" r="2.6"/><circle cx="151" cy="50" r="2.6"/></g>
    <path d="M179 56V147" stroke="#cdd3dc" stroke-width="6" stroke-linecap="round"/>
    <path d="M180.5 58V146" stroke="#ffffff" stroke-width="1.4" opacity=".8"/>
    <path d="M166 149H192" stroke="${GOLD}" stroke-width="5" stroke-linecap="round"/>
    <path d="M179 151V166" stroke="#6b4a2b" stroke-width="5"/>
    <circle cx="179" cy="169" r="4.2" fill="${GOLD}" stroke="${GOLD_DARK}" stroke-width=".8"/>
    ${arm(primary, 'M158 141Q171 148 177 158', 179, 158)}`;
}

function queen(primary, secondary) {
  const pearls = Array.from({ length: 9 }, (_, t) => {
    const x = 106 + t * 4.75;
    const y = 135 + 6 * Math.sin((Math.PI * t) / 8);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#fffdf6" stroke="#c9c0ae" stroke-width=".6"/>`;
  }).join('');
  const petals = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    return `<circle cx="${(80 + Math.cos(a) * 6.5).toFixed(1)}" cy="${(108 + Math.sin(a) * 6.5).toFixed(1)}" r="5.6" fill="#e2607a"/>`;
  }).join('');
  return `
    <path d="M103 98Q100 69 125 68Q150 69 147 98Q150 124 161 141Q146 143 140 128H110Q104 143 89 141Q100 124 103 98Z" fill="#7a4524"/>
    ${robe(primary, secondary)}
    ${face({ lashes: true, lips: '#c2334a' })}
    <path d="M106 91Q109 73 125 73Q141 73 144 91Q134 80 125 82Q116 80 106 91Z" fill="#7a4524"/>
    <path d="M107 77L113 65L119 72L125 58L131 72L137 65L143 77Q125 70 107 77Z" fill="${GOLD}" stroke="${GOLD_DARK}" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="125" cy="67" r="2.6" fill="${RED}"/>
    ${pearls}
    <path d="M77 172Q73 140 80 114" stroke="#2f7d4a" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M76 146Q64 140 62 128Q72 132 76 142Z" fill="#3f9a5f"/>
    ${petals}<circle cx="80" cy="108" r="4" fill="${GOLD}"/>
    ${arm(primary, 'M93 141Q83 146 80 151', 78, 152)}`;
}

function jack(primary, secondary) {
  return `
    <path d="M104 96Q102 74 125 73Q148 74 146 96L147 113Q141 104 141 94H109Q109 104 103 113Z" fill="#c9963b"/>
    ${robe(primary, secondary)}
    <path d="M101 134Q125 147 149 134Q149 141 125 151Q101 141 101 134Z" fill="#fbfaf6" stroke="#cfc9bc" stroke-width="1"/>
    ${face()}
    <path d="M73 172V56" stroke="#7a4f2a" stroke-width="4" stroke-linecap="round"/>
    <path d="M73 58L90 65Q92 76 73 83Z" fill="#cdd3dc" stroke="#8b939e" stroke-width="1"/>
    <path d="M73 58L60 64Q60 70 73 72Z" fill="#cdd3dc" stroke="#8b939e" stroke-width="1"/>
    <path d="M73 58V44" stroke="#9aa2ad" stroke-width="3" stroke-linecap="round"/>
    ${arm(primary, 'M93 140Q82 143 76 140', 73, 140)}
    <path d="M99 81Q103 57 128 57Q155 59 155 79Q126 70 99 81Z" fill="${primary}" stroke="rgba(0,0,0,.35)" stroke-width="1"/>
    <path d="M99 81Q126 71 155 79L155 84Q126 76 99 86Z" fill="${GOLD}"/>
    <path d="M148 66Q170 39 195 45Q175 50 161 64Q171 58 182 60Q167 66 152 75Z" fill="#f6f2e8" stroke="#bdb6a6" stroke-width="1"/>`;
}

const ROBES = {
  C: [BLUE, RED, '#eef1f8'],
  S: ['#17594a', RED, '#edf5f1'],
  H: [RED, BLUE, '#fbf0ea'],
  D: ['#6a2c8c', RED, '#f6eff8'],
};

function courtFace(rank, suit, fill, pal) {
  const [primary, secondary, tint] = ROBES[suit];
  const fig = rank === 'K' ? king(primary, secondary) : rank === 'Q' ? queen(primary, secondary) : jack(primary, secondary);
  // Rahmen x 48–202, y 40–310; die obere Hälfte wird an der Mitte gespiegelt
  const half = `<g clip-path="url(#half)">
    <rect x="48" y="40" width="154" height="135" fill="url(#tint)"/>
    <g transform="translate(125 175) scale(.96) translate(-125 -175)">${fig}</g>
  </g>`;
  return `
    <rect x="48" y="40" width="154" height="270" rx="10" fill="${tint}"/>
    ${half}
    <g transform="rotate(180 ${CX} ${CY})">${half}</g>
    <rect x="48" y="169" width="154" height="12" fill="#fffaf0"/>
    <path d="M48 169H202M48 181H202" stroke="${GOLD}" stroke-width="1.6"/>
    ${pip(suit, CX - 30, CY, 8, fill)}${pip(suit, CX, CY, 9, fill)}${pip(suit, CX + 30, CY, 8, fill)}
    <rect x="48" y="40" width="154" height="270" rx="10" fill="none" stroke="${pal[1]}" stroke-width="2.5"/>
    <rect x="52.5" y="44.5" width="145" height="261" rx="7" fill="none" stroke="${GOLD}" stroke-width="1.2"/>`;
}

// ---------- Ganze Karte ----------
function gradientDefs(pal) {
  return `
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#fcfaf4"/><stop offset="1" stop-color="#f1ecdf"/></linearGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal[0]}"/><stop offset="1" stop-color="${pal[1]}"/></linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".18"/></filter>
    <linearGradient id="tint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="half"><rect x="48" y="40" width="154" height="135" rx="10"/></clipPath>`;
}

function scopeIds(svg, prefix) {
  return svg.replace(/id="(\w+)"/g, `id="${prefix}-$1"`).replace(/url\(#(\w+)\)/g, `url(#${prefix}-$1)`);
}

export function cardSVG(id, fourColor = false) {
  const suit = id[0];
  const r = id.slice(1, -1);
  const pal = PALETTES[fourColor ? 4 : 2][suit];
  const fill = 'url(#ink)';
  let body;
  if (r === 'A') body = aceFace(suit, fill, pal);
  else if (r === '10') body = tenFace(suit, fill);
  else body = courtFace(r, suit, fill, pal);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>${gradientDefs(pal)}</defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="url(#paper)" stroke="#d8d2c4" stroke-width="2"/>
  <rect x="7" y="7" width="${W - 14}" height="${H - 14}" rx="11" fill="none" stroke="#000" stroke-opacity=".05" stroke-width="1"/>
  ${body}
  ${corner(r, suit, fill)}
</svg>`;
  return scopeIds(svg, `k${suit}${r}${fourColor ? 4 : 2}`);
}

export function backSVG() {
  const g = '#e9c46a';
  const small = (s, x, y) => pip(s, x, y, 16, g);
  return scopeIds(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#27509f"/><stop offset=".5" stop-color="#173a7c"/><stop offset="1" stop-color="#0c1f4a"/></linearGradient>
    <pattern id="lat" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path d="M0 0H18M0 0V18" stroke="${g}" stroke-opacity=".2" stroke-width="1.2"/>
      <circle cx="9" cy="9" r="1.7" fill="${g}" fill-opacity=".35"/>
    </pattern>
    <radialGradient id="glow" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="#fbf8f1" stroke="#d8d2c4" stroke-width="2"/>
  <rect x="11" y="11" width="${W - 22}" height="${H - 22}" rx="10" fill="url(#bg)"/>
  <rect x="11" y="11" width="${W - 22}" height="${H - 22}" rx="10" fill="url(#lat)"/>
  <rect x="11" y="11" width="${W - 22}" height="${H - 22}" rx="10" fill="url(#glow)"/>
  <rect x="19" y="19" width="${W - 38}" height="${H - 38}" rx="7" fill="none" stroke="${g}" stroke-opacity=".75" stroke-width="1.6"/>
  <ellipse cx="${CX}" cy="${CY}" rx="56" ry="72" fill="#0c1f4a" stroke="${g}" stroke-width="2.2"/>
  <ellipse cx="${CX}" cy="${CY}" rx="49" ry="65" fill="none" stroke="${g}" stroke-opacity=".5" stroke-width="1" stroke-dasharray="3 4"/>
  ${small('C', CX, CY - 46)}${small('H', CX + 32, CY)}${small('S', CX, CY + 46)}${small('D', CX - 32, CY)}
  <text x="${CX}" y="${CY + 9}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="26" fill="${g}">DK</text>
</svg>`, 'back');
}

// ---------- URLs (einmal erzeugen, dann wiederverwenden) ----------
const urlCache = new Map();

function toUrl(svg) {
  try {
    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
      return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    }
  } catch { /* Fallback unten */ }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** URL des Kartenbildes, unabhängig von der Kopie (CQ0 = CQ1). */
export function cardUrl(id, fourColor = false) {
  const key = `${fourColor ? 4 : 2}:${id.slice(0, -1)}`;
  let u = urlCache.get(key);
  if (!u) {
    u = toUrl(cardSVG(id, fourColor));
    urlCache.set(key, u);
  }
  return u;
}

export function backUrl() {
  let u = urlCache.get('back');
  if (!u) {
    u = toUrl(backSVG());
    urlCache.set('back', u);
  }
  return u;
}

export function cardLabel(id) {
  const suit = id[0];
  const rank = id.slice(1, -1);
  return `${SUIT_LABEL[suit]} ${RANK_NAME[rank]}`;
}

/** Alle Kartenbilder vorab dekodieren, damit das erste Ausspielen nicht ruckelt. */
export function preloadCards(fourColor = false) {
  if (typeof Image === 'undefined') return;
  const ids = [];
  for (const s of ['C', 'S', 'H', 'D']) for (const r of ['A', '10', 'K', 'Q', 'J']) ids.push(`${s}${r}0`);
  for (const id of ids) {
    const img = new Image();
    img.src = cardUrl(id, fourColor);
    if (img.decode) img.decode().catch(() => {});
  }
  const b = new Image();
  b.src = backUrl();
}

/** Vektor-Farbsymbol für die Oberfläche (Badges, Logo, Toasts). */
export function suitIcon(suit, color = 'currentColor', size = 16) {
  return `<svg class="suit-ico" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">${suitShape(suit, color)}</svg>`;
}
