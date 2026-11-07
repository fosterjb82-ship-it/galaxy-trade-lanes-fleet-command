// Pixel-art sprites. Images are pixel art; all text and numbers are drawn
// separately at full device resolution. Sprites are built once into small
// offscreen canvases and drawn scaled by whole numbers with smoothing off.

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

/** Procedural pixel planet with 3-tone lighting, outline and optional ring. */
function planet(size, { base, light, dark, ring = null, bands = null, seed = 1 }) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const r = size / 2 - (ring ? 3.2 : 1.2);
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
        if (bands && Math.floor((y + seed) / 2) % 3 === 0 && lit > -0.25) col = bands;
        if (rg === 1) col = ring;
        px(x, y, col);
      } else if (rg !== 0) {
        px(x, y, ring);
      }
    }
  }
  return c;
}

/** Ring-shaped space station. */
function station(size, accent) {
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
  // Lights on the ring.
  ctx.fillStyle = accent;
  for (const [x, y] of [[cx, 1.6], [cx, size - 2.6], [1.6, cx], [size - 2.6, cx]]) ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  return c;
}

/** Jump-gate ring for lane intersections. */
function gate(size) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const cx = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cx;
      const d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const notch = Math.abs(((ang / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.38;
      let col = null;
      if (d > 4.4 && d <= 6.6) col = notch ? '#1d3b52' : d > 5.9 ? '#2a6f8f' : '#5fd4ff';
      else if (d <= 2.2) col = d > 1.4 ? '#2a6f8f' : '#c8f4ff';
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

/** Soft purple nebula blob for hidden nodes (deterministic dither). */
function nebula(size) {
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
      const v = 1 - d + (noise(x, y) - 0.5) * 0.45;
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

const STAR_ROWS = ['..w..', '.wyw.', 'wyyyw', '.wyw.', '..w..'];

const cache = new Map();

/** Get (and cache) a sprite canvas by key. */
export function sprite(key) {
  if (cache.has(key)) return cache.get(key);
  const [kind, variant] = key.split(':');
  let c;
  switch (kind) {
    case 'home': {
      const pc = PLAYER_COLORS[Number(variant)];
      c = planet(22, { base: '#3f7fd6', light: '#7fc0ff', dark: '#1f3f7a', bands: '#4fae6a', ring: pc.main, seed: 2 });
      break;
    }
    case 'core':
      c = planet(22, { base: '#e0a43a', light: '#ffe08a', dark: '#8a5a12', ring: '#f4f7ff', bands: '#c97a2a', seed: 1 });
      break;
    case 'key': {
      const looks = [
        { base: '#4fae6a', light: '#9be3a8', dark: '#22603a', bands: '#3f7fd6' },
        { base: '#c76b4a', light: '#f0a582', dark: '#6b2f1f', bands: '#a0543a' },
        { base: '#5fb8c9', light: '#b5ecf5', dark: '#2a5f6b', bands: null },
        { base: '#b089d6', light: '#e0c8ff', dark: '#563a7a', bands: '#8d6ab8' },
      ];
      c = planet(18, { ...looks[Number(variant) % looks.length], seed: Number(variant) });
      break;
    }
    case 'station':
      c = station(16, BASE_PALETTE.y);
      break;
    case 'intersection':
      c = gate(15);
      break;
    case 'trade':
      c = fromRows(TRADE_ROWS, BASE_PALETTE);
      break;
    case 'empty':
      c = fromRows(STAR_ROWS, { w: '#7f8bb0', y: '#c8d2f0' });
      break;
    case 'hidden':
      c = nebula(16);
      break;
    case 'ship': {
      // ship:<type>:<playerIndex|pirate>
      const [, type, owner] = key.split(':');
      const col = owner === 'pirate' ? PIRATE_COLOR : PLAYER_COLORS[Number(owner)];
      const pal = { ...BASE_PALETTE, P: col.main };
      if (owner === 'pirate') Object.assign(pal, { g: '#4a4f60', G: '#6b7186', d: '#2b2f3c', c: '#ff5a5a' });
      c = fromRows(SHIP_ROWS[type], pal);
      break;
    }
    default:
      throw new Error(`Unknown sprite ${key}`);
  }
  cache.set(key, c);
  return c;
}

/** Sprite key for a map node. */
export function nodeSpriteKey(node, { revealHidden = false } = {}) {
  if (node.type === 'home') return `home:${node.homeOf}`;
  if (node.core) return 'core';
  if (node.type === 'key') return `key:${node.id % 4}`;
  if (node.hidden && !revealHidden) return 'hidden';
  return node.type;
}

export const SHIP_TYPES = Object.keys(SHIP_ROWS);
