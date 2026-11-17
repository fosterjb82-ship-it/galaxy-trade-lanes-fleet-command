// Shared helpers for the high-resolution artwork: canvases, colour maths,
// seamless noise and a size-aware cache. All art is drawn procedurally at the
// exact device-pixel size it will be shown at, so it stays sharp at any zoom.

export function makeCanvas(w, h) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ---------------------------------------------------------------- colour

export function hexRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function rgbHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

export function mix(a, b, t) {
  const pa = hexRgb(a);
  const pb = hexRgb(b);
  return rgbHex(pa.map((v, i) => v + (pb[i] - v) * t));
}

export function rgba(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export const lighten = (hex, t) => mix(hex, '#ffffff', t);
export const darken = (hex, t) => mix(hex, '#000000', t);

/** Piecewise-linear colour ramp: stops = [[t, '#hex'], ...] sorted by t. */
export function ramp(stops) {
  const rgb = stops.map(([t, c]) => [t, hexRgb(c)]);
  return (t) => {
    if (t <= rgb[0][0]) return rgb[0][1];
    for (let i = 1; i < rgb.length; i++) {
      if (t <= rgb[i][0]) {
        const [t0, c0] = rgb[i - 1];
        const [t1, c1] = rgb[i];
        const k = (t - t0) / (t1 - t0);
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    }
    return rgb[rgb.length - 1][1];
  };
}

export const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- noise

/** Deterministic pseudo-random generator. */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash3(x, y, z, seed) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth 3D value noise in [0, 1]. */
export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * u;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * u;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * u;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

/** Fractal noise (sum of octaves) in roughly [0, 1]. */
export function fbm(x, y, z, seed = 0, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * freq, y * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- cache

/** Small LRU cache for rendered art canvases. */
export class ArtCache {
  constructor(limit = 600) {
    this.limit = limit;
    this.map = new Map();
  }

  get(key, build) {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const value = build();
    this.map.set(key, value);
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
    return value;
  }
}

// ---------------------------------------------------------------- shapes

/** Pointy-top hexagon path centred at (cx, cy) with circumradius r. */
export function hexPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Polygon from [[x, y], ...] scaled by s and offset. */
export function poly(ctx, pts, s = 1, ox = 0, oy = 0) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * s, oy + y * s) : ctx.moveTo(ox + x * s, oy + y * s)));
  ctx.closePath();
}
