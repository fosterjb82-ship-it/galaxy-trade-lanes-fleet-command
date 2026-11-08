// Pixel-art sprites. Images are pixel art; all text and numbers are drawn
// separately at full device resolution. Sprites are built once into small
// offscreen canvases and drawn scaled by whole numbers with smoothing off.

import { TILE_W, TILE_H } from '../map/hex.js';

export const PLAYER_COLORS = [
  { name: 'Crimson', main: '#e5484d', dark: '#8e1f24', light: '#ff9592' },
  { name: 'Azure', main: '#3b9eff', dark: '#1a4f8c', light: '#9ccbff' },
  { name: 'Viridian', main: '#30c26b', dark: '#176b3a', light: '#8fe6b0' },
  { name: 'Amber', main: '#f5a524', dark: '#8a5a0a', light: '#ffd58a' },
  { name: 'Violet', main: '#9b6cff', dark: '#4e2f99', light: '#cdb8ff' },
  { name: 'Teal', main: '#20c5c5', dark: '#0d6a6a', light: '#8cecec' },
];

export const PIRATE_COLOR = { name: 'Pirates', main: '#d23c3c', dark: '#5a1212', light: '#ff8a7a' };

const BASE_PALETTE = {
  k: '#0b0d18', // outline
  g: '#9aa3b8', // hull
  G: '#cfd6e6', // hull highlight
  d: '#5a6278', // hull shadow
  c: '#6fe3ff', // glass / cockpit
  y: '#ffd166', // engine / lights
  o: '#ff8c42', // engine flame
  w: '#f4f7ff', // white
  Y: '#c9971f', // gold dark
};

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Turn rows of palette characters into a canvas. '.' is transparent. */
function fromRows(rows, palette) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const col = palette[rows[y][x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

export const PLANET_FRAMES = 48;

function hash3(a, b, c) {
  const v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Procedural pixel planet with 3-tone lighting, outline and optional ring.
 * The surface is mapped onto a sphere and turned by `frame`, so continents
 * (rocky worlds) or storms (gas giants) drift across the face as it spins.
 */
function planet(size, { base, light, dark, ring = null, bands = null, seed = 1, gas = false }, frame = 0) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const r = size / 2 - (ring ? 3.2 : 1.2);
  const phase = (frame / PLANET_FRAMES) * Math.PI * 2;
  const px = (x, y, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  };
  const ringAt = (x, y) => {
    if (!ring) return 0;
    // Tilted ellipse ring.
    const dx = x - cx;
    const dy = (y - cy) * 3.2 + dx * 0.55;
    const d = Math.hypot(dx, dy);
    return d > r + 1.2 && d < r + 3.4 ? (dy < 0 ? -1 : 1) : 0; // -1 back, +1 front
  };
  const shade = (col, lit) => (lit > 0.55 ? mix(col, '#ffffff', 0.28) : lit > -0.25 ? col : mix(col, dark, 0.55));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      const rg = ringAt(x, y);
      if (d <= r) {
        if (d > r - 1) {
          px(x, y, BASE_PALETTE.k);
          continue;
        }
        const lit = (-dx - dy) / (r * 1.4) + 0.25; // light from top-left
        let col = lit > 0.55 ? light : lit > -0.25 ? base : dark;
        if (bands) {
          // Longitude on the sphere, turned by the frame.
          const z = Math.sqrt(Math.max(0, r * r - dx * dx - dy * dy));
          const lon = Math.atan2(dx, z) + phase;
          const u = ((lon / (Math.PI * 2)) % 1 + 1) % 1;
          const cell = Math.floor(u * 18);
          const row = Math.floor((dy / r) * 5 + 5);
          if (gas) {
            if (Math.floor((y + seed) / 2) % 3 === 0) col = shade(bands, lit);
            // A storm spot riding the turning surface.
            const su = (u - 0.3 + 1) % 1;
            if (su < 0.08 && Math.abs(dy - r * 0.25) < 1.6) col = shade('#f4f7ff', lit);
          } else {
            const n = hash3(cell, row, seed) * 0.6 + hash3(cell >> 1, row >> 1, seed + 9) * 0.4;
            if (n > 0.56) col = shade(bands, lit);
            if (Math.abs(dy) > r * 0.72 && n > 0.3) col = shade('#e8f4ff', lit); // polar caps
          }
        }
        if (rg === 1) col = ring;
        px(x, y, col);
      } else if (rg !== 0) {
        px(x, y, ring);
      }
    }
  }
  return c;
}

/** Ring-shaped space station; its running lights chase around the ring. */
function station(size, accent, frame = 0) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const cx = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cx;
      const d = Math.hypot(dx, dy);
      let col = null;
      if (d > 5.2 && d <= 7.4) col = d > 6.6 || d < 5.9 ? BASE_PALETTE.k : (dx + dy < 0 ? BASE_PALETTE.G : BASE_PALETTE.g);
      else if (d <= 2.6) col = d > 1.8 ? BASE_PALETTE.k : BASE_PALETTE.c;
      else if ((Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6) && d < 5.3) col = BASE_PALETTE.d;
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  // Lights on the ring: one bright at a time, chasing round.
  const lights = [[cx, 1.6], [size - 2.6, cx], [cx, size - 2.6], [1.6, cx]];
  lights.forEach(([x, y], i) => {
    ctx.fillStyle = i === frame % 4 ? '#ffffff' : accent;
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  });
  return c;
}

/** Jump-gate ring for lane intersections; the ring turns and the core pulses. */
function gate(size, frame = 0) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const cx = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cx;
      const d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx) + frame * (Math.PI / 16);
      const notch = Math.abs(((ang / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.38;
      let col = null;
      if (d > 4.4 && d <= 6.6) col = notch ? '#1d3b52' : d > 5.9 ? '#2a6f8f' : '#5fd4ff';
      else if (d <= 2.2) col = d > 1.4 ? '#2a6f8f' : ['#c8f4ff', '#ffffff', '#c8f4ff', '#8fe6ff'][frame % 4];
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

/** Soft purple nebula blob for hidden nodes; it churns slowly. */
function nebula(size, frame = 0) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const cx = (size - 1) / 2;
  const noise = (x, y) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, (y - cx) * 1.15) / (size / 2);
      const v = 1 - d + (noise(x + frame * 3.1, y + frame * 1.7) - 0.5) * 0.45;
      const col = v > 0.62 ? '#c58cff' : v > 0.38 ? '#7d4fc4' : v > 0.18 ? '#45297a' : null;
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

const SHIP_ROWS = {
  fighter: [
    '............',
    '..kk........',
    '..kPk.......',
    '...kPkk.....',
    '.okkgggkk...',
    'oykgGgggcck.',
    'oykgggggcck.',
    '.okkgggkk...',
    '...kPkk.....',
    '..kPk.......',
    '..kk........',
    '............',
  ],
  freighter: [
    '............',
    '............',
    '..kkkkkkk...',
    '.kPPkGkgkk..',
    'okgggggggdk.',
    'ykgPPgPPggck',
    'ykgPPgPPggck',
    'okgggggggdk.',
    '.kPPkgkgkk..',
    '..kkkkkkk...',
    '............',
    '............',
  ],
  frigate: [
    '............',
    '....kkk.....',
    '...kPPgk....',
    '.okkGgggkk..',
    'oykgggPgggkk',
    'ykgggggggcck',
    'ykgggggggcck',
    'oykgggPgggkk',
    '.okkggggkk..',
    '...kPPgk....',
    '....kkk.....',
    '............',
  ],
  destroyer: [
    '....kkkk....',
    '..kkPPggk...',
    'okkGgggggkk.',
    'ykggdggggggk',
    'ykgPPPPggggk',
    'ykgggggggcck',
    'ykgggggggcck',
    'ykgPPPPggggk',
    'ykggdggggggk',
    'okkggggggkk.',
    '..kkPPggk...',
    '....kkkk....',
  ],
  corvette: [
    '............',
    '...kk.......',
    '..kPPk.kk...',
    '.okgggkwwk..',
    'oykGgggggkk.',
    'ykgggggggcck',
    'ykgggggggcck',
    'oykggggggkk.',
    '.okgggkwwk..',
    '..kPPk.kk...',
    '...kk.......',
    '............',
  ],
  interceptor: [
    '............',
    '............',
    '.kk.........',
    '.kPkk.......',
    'okkGggkkk...',
    'ykgggPggcckk',
    'ykgggPggcckk',
    'okkgggkkk...',
    '.kPkk.......',
    '.kk.........',
    '............',
    '............',
  ],
  runner: [
    '............',
    '............',
    '...kkkk.....',
    '.okPPGgkk...',
    'oykggggggkk.',
    'ykgPgggPgcck',
    'ykgPgggPgcck',
    'oykggggggkk.',
    '.okPPggkk...',
    '...kkkk.....',
    '............',
    '............',
  ],
  carrier: [
    '............',
    '.kkkkkkkkk..',
    'okGggggggk..',
    'ykgPgPgPggk.',
    'ykggggggggck',
    'ykddddddddck',
    'ykdwdwdwddck',
    'ykggggggggck',
    'ykgPgPgPggk.',
    'okgggggggk..',
    '.kkkkkkkkk..',
    '............',
  ],
};

const TRADE_ROWS = [
  '..............',
  '.YYYY....YYYY.',
  '.YyYy.kk.YyYy.',
  '.YYYYkyykYYYY.',
  '.YyYkgGgdkYyY.',
  '.YYYYkggkYYYY.',
  '.YyYy.kk.YyYy.',
  '.YYYY....YYYY.',
  '..............',
];

const CARD_ROWS = {
  credit: [
    '....kkkk....',
    '..kkyyyykk..',
    '.kyywwyyyyk.',
    '.kywyyyyyYk.',
    'kyyyyYYyyyYk',
    'kyyyYyyYyyYk',
    'kyyyYyyyyyYk',
    'kyyyYyyYyyYk',
    '.kyyyYYyyYk.',
    '.kyyyyyyYYk.',
    '..kkYYYYkk..',
    '....kkkk....',
  ],
  move: [
    '............',
    '..kk..kk....',
    '..kck.kck...',
    '...kck.kck..',
    '....kck.kck.',
    '.....kcwkcwk',
    '.....kcwkcwk',
    '....kck.kck.',
    '...kck.kck..',
    '..kck.kck...',
    '..kk..kk....',
    '............',
  ],
  attack: [
    '.....kk.....',
    '.....rr.....',
    '...kkrrkk...',
    '..krr..rrk..',
    '.kr......rk.',
    'krr..ww..rrk',
    'krr..ww..rrk',
    '.kr......rk.',
    '..krr..rrk..',
    '...kkrrkk...',
    '.....rr.....',
    '.....kk.....',
  ],
};

CARD_ROWS.shield = [
  '..kkkkkkkk..',
  '.kwcccccccbk',
  '.kwcccccccbk',
  '.kccccccccbk',
  '.kccccccccbk',
  '.kccccccccbk',
  '..kccccccbk.',
  '..kccccccbk.',
  '...kccccbk..',
  '....kccbk...',
  '.....kkk....',
  '............',
];
CARD_ROWS.repair = [
  '............',
  '....kkkk....',
  '....keEk....',
  '....keEk....',
  '.kkkkeEkkkk.',
  '.keeeeeeeEk.',
  '.kEEEEEEEEk.',
  '.kkkkeEkkkk.',
  '....keEk....',
  '....keEk....',
  '....kkkk....',
  '............',
];
CARD_ROWS.react = [
  '.......kk...',
  '......kyk...',
  '.....kyyk...',
  '....kyyk....',
  '...kyyykkk..',
  '..kyyyyyyk..',
  '..kkkyyyk...',
  '....kyyk....',
  '...kyyk.....',
  '...kyk......',
  '...kk.......',
  '............',
];

CARD_ROWS.upgrade = [
  '..k.k..k.k..',
  '.kkkkkkkkkk.',
  'kkggggggggkk',
  '.kgGGGGGGgk.',
  'kkgGccccGgkk',
  '.kgGcwccGgk.',
  'kkgGccccGgkk',
  '.kgGccccGgk.',
  'kkgGGGGGGgkk',
  '.kggggggggk.',
  '.kkkkkkkkkk.',
  '..k.k..k.k..',
];

const STAR_ROWS = ['..w..', '.wyw.', 'wyyyw', '.wyw.', '..w..'];

// ---------------------------------------------------------------- hex tiles
//
// Tile mask = the Voronoi cell of the hex lattice (28 px apart in a row,
// rows 24 px apart, offset 14), so tiles tessellate pixel-perfectly.


const LATTICE = [[28, 0], [-28, 0], [14, 24], [-14, 24], [14, -24], [-14, -24]];
let maskCache = null;

/** mask[y][x] = true if the pixel belongs to the tile centred at (14, 16). */
export function hexMask() {
  if (maskCache) return maskCache;
  maskCache = [];
  for (let y = 0; y < TILE_H; y++) {
    const row = [];
    for (let x = 0; x < TILE_W; x++) {
      const dx = x + 0.5 - TILE_W / 2;
      const dy = y + 0.5 - TILE_H / 2;
      const d0 = dx * dx + dy * dy;
      row.push(LATTICE.every(([lx, ly]) => d0 < (dx - lx) ** 2 + (dy - ly) ** 2));
    }
    maskCache.push(row);
  }
  return maskCache;
}

const inMask = (m, x, y) => y >= 0 && y < TILE_H && x >= 0 && x < TILE_W && m[y][x];

function hash2(x, y, s) {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

const TILE_STYLE = {
  empty: { base: '#0b1330', alt: '#0e1838', edge: '#1b2752' },
  feature: { base: '#0f1a40', alt: '#121f4a', edge: '#24336a' },
  void: { base: '#020208', alt: '#06040f', edge: '#0d0a1c' },
  asteroid: { base: '#0b1330', alt: '#0e1838', edge: '#1b2752' },
  nebula: { base: '#24124a', alt: '#32195f', edge: '#45297a' },
};

/** A hex tile background: terrain texture plus a 1-px bottom/right edge. */
function hexTile(kind, variant, tint = null, frame = 0) {
  const m = hexMask();
  const st = TILE_STYLE[kind];
  const c = makeCanvas(TILE_W, TILE_H);
  const ctx = c.getContext('2d');
  const put = (x, y, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  };
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      if (!m[y][x]) continue;
      const edge = !inMask(m, x + 1, y) || !inMask(m, x, y + 1) || !inMask(m, x + 1, y + 1);
      const n = hash2(x, y, variant);
      const nf = hash2(x, y, variant * 7 + frame); // animated noise
      let col = n < 0.5 ? st.base : st.alt;
      if (kind === 'nebula') {
        const d = Math.hypot(x - 14, (y - 16) * 0.9) / 15;
        const v = 1 - d + (nf - 0.5) * 0.5;
        col = v > 0.55 ? '#5b3a99' : v > 0.3 ? '#45297a' : v > 0.1 ? st.alt : st.base;
      }
      if (kind === 'void' && nf > 0.975) col = '#2a1650';
      if ((kind === 'empty' || kind === 'asteroid' || kind === 'feature') && n > 0.985) col = '#8b97c2';
      if (tint) col = mix(col, tint, n < 0.5 ? 0.42 : 0.34);
      put(x, y, edge ? st.edge : col);
    }
  }
  if (kind === 'asteroid') {
    // A few pixel rocks.
    const rocks = [[8, 11, 3], [17, 9, 2], [12, 19, 4], [20, 18, 2], [7, 21, 2]];
    for (const [rx, ry, size] of rocks) {
      const ox = Math.round((hash2(rx, ry, variant) - 0.5) * 3);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (size > 2 && (x === 0 || x === size - 1) && (y === 0 || y === size - 1)) continue;
          put(rx + x + ox, ry + y, y === 0 || x === 0 ? '#b8875a' : y === size - 1 ? '#5a4030' : '#8a6a48');
        }
      }
    }
  }
  if (kind === 'void') {
    // Faint rift crack.
    for (let i = 0; i < 9; i++) put(9 + i + Math.round(Math.sin(i + variant) * 1.5), 12 + i, '#1a0f33');
  }
  return c;
}

/** Hex outline (both sides of each edge) in one colour, for selection rings. */
function hexOutline(color, thick = 1) {
  const m = hexMask();
  const c = makeCanvas(TILE_W, TILE_H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      if (!m[y][x]) continue;
      let edge = false;
      for (let d = 1; d <= thick && !edge; d++) {
        edge = [[d, 0], [-d, 0], [0, d], [0, -d]].some(([dx, dy]) => !inMask(m, x + dx, y + dy));
      }
      if (edge) ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

const cache = new Map();

/** Get (and cache) a sprite canvas by key. */
export function sprite(fullKey) {
  if (cache.has(fullKey)) return cache.get(fullKey);
  const [key, frameStr] = fullKey.split('@');
  const frame = Number(frameStr) || 0;
  const [kind, variant] = key.split(':');
  let c;
  switch (kind) {
    case 'home': {
      const pc = PLAYER_COLORS[Number(variant)];
      c = planet(22, { base: '#3f7fd6', light: '#7fc0ff', dark: '#1f3f7a', bands: '#4fae6a', ring: pc.main, seed: 2 }, frame);
      break;
    }
    case 'core':
      c = planet(22, { base: '#e0a43a', light: '#ffe08a', dark: '#8a5a12', ring: '#f4f7ff', bands: '#c97a2a', seed: 1, gas: true }, frame);
      break;
    case 'key': {
      const looks = [
        { base: '#4fae6a', light: '#9be3a8', dark: '#22603a', bands: '#3f7fd6' },
        { base: '#c76b4a', light: '#f0a582', dark: '#6b2f1f', bands: '#a0543a' },
        { base: '#5fb8c9', light: '#b5ecf5', dark: '#2a5f6b', bands: '#e8f4ff' },
        { base: '#b089d6', light: '#e0c8ff', dark: '#563a7a', bands: '#8d6ab8' },
      ];
      c = planet(18, { ...looks[Number(variant) % looks.length], seed: Number(variant) + 3 }, frame);
      break;
    }
    case 'station':
      c = station(16, BASE_PALETTE.y, frame);
      break;
    case 'intersection':
      c = gate(15, frame);
      break;
    case 'trade':
      c = fromRows(TRADE_ROWS, frame % 2 ? { ...BASE_PALETTE, y: '#fff2b8' } : BASE_PALETTE);
      break;
    case 'empty':
      c = fromRows(STAR_ROWS, { w: '#7f8bb0', y: '#c8d2f0' });
      break;
    case 'hidden':
      c = nebula(16, frame);
      break;
    case 'card':
      c = fromRows(CARD_ROWS[variant], { ...BASE_PALETTE, r: '#ff5d5d', b: '#1a4f8c', e: '#3ddc84', E: '#176b3a' });
      break;
    case 'tile': {
      // tile:<kind>:<variant>[:<tint>]
      const [, k, v, tint] = key.split(':');
      c = hexTile(k, Number(v), tint ? `#${tint}` : null, frame);
      break;
    }
    case 'outline': {
      // outline:<hex colour without #>:<thickness>
      const [, col, thick] = key.split(':');
      c = hexOutline(`#${col}`, Number(thick || 1));
      break;
    }
    case 'ship': {
      // ship:<type>:<playerIndex|pirate>
      const [, type, owner] = key.split(':');
      const col = owner === 'pirate' ? PIRATE_COLOR : PLAYER_COLORS[Number(owner)];
      const pal = { ...BASE_PALETTE, P: col.main };
      if (owner === 'pirate') Object.assign(pal, { g: '#4a4f60', G: '#6b7186', d: '#2b2f3c', c: '#ff5a5a' });
      if (frame % 2) Object.assign(pal, { o: BASE_PALETTE.y, y: '#fff2b8' }); // engine flicker
      c = fromRows(SHIP_ROWS[type], pal);
      break;
    }
    case 'flash': {
      // flash:<shipType>: white silhouette of a ship, for hit flashes
      const rows = SHIP_ROWS[variant] ?? SHIP_ROWS.frigate;
      const pal = {};
      for (const ch of new Set(rows.join(''))) if (ch !== '.') pal[ch] = '#ffffff';
      c = fromRows(rows, pal);
      break;
    }
    default:
      throw new Error(`Unknown sprite ${key}`);
  }
  cache.set(fullKey, c);
  return c;
}

const TERRAIN = new Set(['empty', 'void', 'asteroid', 'nebula']);

/**
 * Ambient animation: `tick` advances 8 times a second. Each kind of art
 * steps at its own pace; tick 0 everywhere gives still images.
 */
const offset = (node) => (node.q * 5 + node.r * 3 + 64) % 16; // de-sync neighbours

/** Sprite key for a tile's background. */
export function tileSpriteKey(node, tick = 0) {
  const variant = (node.q * 7 + node.r * 13 + 100) % 4;
  if (node.type === 'home') return `tile:feature:${variant}:${PLAYER_COLORS[node.homeOf].dark.slice(1)}`;
  if (node.type === 'nebula') return `tile:nebula:${variant}@${Math.floor((tick + offset(node)) / 3) % 4}`;
  if (node.type === 'void') return `tile:void:${variant}@${Math.floor((tick + offset(node)) / 4) % 6}`;
  if (TERRAIN.has(node.type)) return `tile:${node.type}:${variant}`;
  return `tile:feature:${variant}`;
}

/** Sprite key for the feature drawn on a tile, or null for plain terrain. */
export function featureSpriteKey(node, { revealHidden = false, tick = 0 } = {}) {
  const t = tick + offset(node);
  const spin = Math.floor(t / 3) % PLANET_FRAMES;
  if (node.type === 'home') return `home:${node.homeOf}@${spin}`;
  if (node.core) return `core@${Math.floor(t / 4) % PLANET_FRAMES}`;
  if (node.type === 'key') return `key:${(node.q * 3 + node.r * 5 + 40) % 4}@${spin}`;
  if (node.hidden) return revealHidden ? null : `hidden@${Math.floor(t / 3) % 6}`;
  if (node.type === 'station') return `station@${Math.floor(t / 2) % 4}`;
  if (node.type === 'intersection') return `intersection@${Math.floor(t / 2) % 32}`;
  if (node.type === 'trade') return `trade@${Math.floor(t / 4) % 2}`;
  if (TERRAIN.has(node.type)) return null;
  return node.type;
}

export const SHIP_TYPES = Object.keys(SHIP_ROWS);
