// High-resolution planets. Each style gets an equirectangular surface map
// (and a cloud map) built once from 3D noise sampled on the sphere, so it
// wraps seamlessly. A frame then maps the map onto a lit sphere: diffuse light
// from the top-left, a soft terminator, ocean glint, drifting clouds, an
// atmosphere rim and optional rings. Turning the map gives the spin.

import { makeCanvas, ramp, fbm, noise3, smoothstep, hexRgb, rgba, rng } from './core.js';

const TW = 384;
const TH = 192;

const STYLES = {
  terran: {
    seed: 11,
    ocean: ramp([[0, '#06204f'], [0.7, '#0f3f8f'], [1, '#2f86d6']]),
    land: ramp([[0, '#2f7a3a'], [0.35, '#5d9a3c'], [0.6, '#9a8a55'], [0.8, '#8d8a86'], [1, '#f2f4f8']]),
    sea: 0.53, ice: 0.8, clouds: 0.62, atmo: '#79b8ff', freq: 1.7,
  },
  jungle: {
    seed: 23,
    ocean: ramp([[0, '#05333d'], [1, '#1f9a8f']]),
    land: ramp([[0, '#14502a'], [0.4, '#2f8f3a'], [0.75, '#7fc85a'], [1, '#d8f0a0']]),
    sea: 0.47, ice: 0.9, clouds: 0.66, atmo: '#9be3a8', freq: 2.1,
  },
  rust: {
    seed: 37,
    land: ramp([[0, '#3d150c'], [0.3, '#7a2f18'], [0.55, '#b4542e'], [0.8, '#d98a5a'], [1, '#f2c09a']]),
    sea: -1, ice: 0.9, clouds: 0, atmo: '#f0a582', freq: 2.4, craters: 18,
  },
  ice: {
    seed: 51,
    land: ramp([[0, '#4f8fa8'], [0.45, '#9fd4e6'], [0.75, '#d9f2fb'], [1, '#ffffff']]),
    sea: -1, ice: 2, clouds: 0.7, atmo: '#bdeeff', freq: 2.0, cracks: true,
  },
  violet: {
    seed: 67,
    ocean: ramp([[0, '#1a0a3a'], [1, '#5a2ea8']]),
    land: ramp([[0, '#7a4fb0'], [0.5, '#b88ae0'], [1, '#f2dcff']]),
    sea: 0.5, ice: 0.9, clouds: 0.68, atmo: '#d6b3ff', freq: 1.9, cloudTint: '#f3d9ff',
  },
  gas: {
    seed: 83,
    bands: ramp([[0, '#6b3b0e'], [0.2, '#b8742a'], [0.4, '#e2b25c'], [0.55, '#f6e2a8'], [0.7, '#d39a48'], [0.85, '#9c5a1c'], [1, '#f0d290']]),
    atmo: '#ffd98a', gas: true,
  },
};

/** Which look each planet uses. */
export const KEY_LOOKS = ['jungle', 'rust', 'ice', 'violet'];

const textures = new Map();

function sphere(u, v) {
  const lon = u * Math.PI * 2;
  const lat = (v - 0.5) * Math.PI;
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
}

/** Build (once) the surface and cloud maps for a style. */
function texture(name) {
  if (textures.has(name)) return textures.get(name);
  const st = STYLES[name];
  const color = new Uint8ClampedArray(TW * TH * 3);
  const water = new Uint8Array(TW * TH);
  const cloud = new Uint8Array(TW * TH);
  const craters = [];
  if (st.craters) {
    const r = rng(st.seed);
    for (let i = 0; i < st.craters; i++) craters.push({ p: sphere(r(), 0.15 + r() * 0.7), rad: 0.05 + r() * 0.12 });
  }
  for (let y = 0; y < TH; y++) {
    const v = (y + 0.5) / TH;
    const lat = Math.abs(v - 0.5) * 2;
    for (let x = 0; x < TW; x++) {
      const u = (x + 0.5) / TW;
      const [px, py, pz] = sphere(u, v);
      const i = y * TW + x;
      let rgb;
      if (st.gas) {
        const turb = fbm(px * 2.2, py * 2.2, pz * 2.2, st.seed, 4);
        const band = 0.5 + 0.5 * Math.sin(py * 15 + turb * 5.5 + Math.sin(py * 5) * 1.5);
        rgb = st.bands(band * 0.85 + turb * 0.15);
        // Great storm.
        const sd = Math.hypot((u - 0.32) * 2.6, (v - 0.64) * 6.5);
        if (sd < 1) {
          const k = smoothstep(1, 0.25, sd);
          const swirl = 0.5 + 0.5 * Math.sin(sd * 14 + Math.atan2(v - 0.64, u - 0.32) * 2);
          const storm = [190 + swirl * 40, 90 + swirl * 40, 50];
          rgb = rgb.map((c, j) => c + (storm[j] - c) * k * 0.85);
        }
      } else {
        const f = st.freq;
        const h = fbm(px * f, py * f, pz * f, st.seed, 6);
        if (h < st.sea) {
          rgb = st.ocean(h / st.sea);
          water[i] = 255;
        } else {
          rgb = st.land((h - Math.max(0, st.sea)) / (1 - Math.max(0, st.sea)));
          const detail = noise3(px * 14, py * 14, pz * 14, st.seed + 5);
          rgb = rgb.map((c) => c * (0.88 + detail * 0.24));
        }
        if (st.cracks) {
          const c = fbm(px * 3.2, py * 3.2, pz * 3.2, st.seed + 9, 4);
          if (Math.abs(c - 0.5) < 0.012) rgb = [60, 120, 160];
        }
        for (const cr of craters) {
          const d = Math.acos(Math.max(-1, Math.min(1, px * cr.p[0] + py * cr.p[1] + pz * cr.p[2])));
          if (d < cr.rad * 1.25) {
            const k = d / cr.rad;
            const mul = k < 0.85 ? 0.72 : k < 1.05 ? 1.25 : 1;
            rgb = rgb.map((c2) => c2 * mul);
          }
        }
        // Polar ice.
        const iceEdge = st.ice + (noise3(px * 6, py * 6, pz * 6, st.seed + 3) - 0.5) * 0.12;
        if (lat > iceEdge) {
          rgb = [235, 243, 250];
          water[i] = 0;
        }
        if (st.clouds) {
          const cl = fbm(px * 2.6 + 4, py * 3.4, pz * 2.6, st.seed + 11, 5);
          cloud[i] = Math.round(smoothstep(st.clouds - 0.08, st.clouds + 0.12, cl) * 230);
        }
      }
      color[i * 3] = rgb[0];
      color[i * 3 + 1] = rgb[1];
      color[i * 3 + 2] = rgb[2];
    }
  }
  const t = { color, water, cloud, st, cloudRgb: st.cloudTint ? hexRgb(st.cloudTint) : [246, 248, 252], atmo: hexRgb(st.atmo) };
  textures.set(name, t);
  return t;
}

// Per-size sphere geometry: which pixels are on the disc and how they're lit.
const geometry = new Map();
const L = (() => {
  const v = [-0.58, -0.52, 0.63];
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
})();
const H = (() => {
  const v = [L[0], L[1], L[2] + 1];
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
})();

function sphereGeometry(diameter) {
  const key = diameter;
  if (geometry.has(key)) return geometry.get(key);
  const r = diameter / 2;
  const pts = [];
  for (let y = 0; y < diameter; y++) {
    for (let x = 0; x < diameter; x++) {
      const nx = (x + 0.5 - r) / r;
      const ny = (y + 0.5 - r) / r;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      const lon = Math.atan2(nx, nz) / (Math.PI * 2);
      const v = Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI + 0.5;
      const dot = nx * L[0] + ny * L[1] + nz * L[2];
      const light = 0.06 + 0.94 * smoothstep(-0.18, 0.95, dot);
      const spec = Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]) ** 70;
      const rim = (1 - nz) ** 2.4;
      const edge = Math.min(1, (1 - Math.sqrt(d2)) * r * 1.5); // anti-aliased edge
      pts.push({ i: (y * diameter + x) * 4, lon, ty: Math.min(TH - 1, Math.floor(v * TH)), light, spec, rim, dot, edge });
    }
  }
  const g = { pts, diameter };
  geometry.set(key, g);
  if (geometry.size > 40) geometry.delete(geometry.keys().next().value);
  return g;
}

/**
 * Render a planet into a square canvas `size` px wide.
 * @param {string} style  key of STYLES
 * @param {number} phase  0..1 rotation
 * @param {{ ring?: string }} opts  ring colour for ringed planets
 */
export function renderPlanet(size, style, phase = 0, { ring = null } = {}) {
  const S = Math.max(8, Math.round(size));
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const cx = S / 2;
  const cy = S / 2;
  const r = Math.round(S * (ring ? 0.29 : 0.4));
  const tex = texture(style);

  // Outer atmosphere glow.
  const glow = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.32);
  glow.addColorStop(0, rgba(STYLES[style].atmo, 0.35));
  glow.addColorStop(1, rgba(STYLES[style].atmo, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.32, 0, Math.PI * 2);
  ctx.fill();

  const ringRot = -0.36;
  const drawRing = (front) => {
    if (!ring) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ringRot);
    ctx.beginPath();
    if (front) ctx.rect(-S, 0, S * 2, S);
    else ctx.rect(-S, -S, S * 2, S);
    ctx.clip();
    const bands = [[1.42, 0.08, 0.55], [1.58, 0.12, 0.85], [1.74, 0.06, 0.5], [1.86, 0.1, 0.7], [2.0, 0.05, 0.35]];
    for (const [rad, w, a] of bands) {
      ctx.beginPath();
      ctx.ellipse(0, 0, r * rad, r * rad * 0.28, 0, 0, Math.PI * 2);
      ctx.lineWidth = r * w;
      ctx.strokeStyle = rgba(ring, a * (front ? 1 : 0.75));
      ctx.stroke();
    }
    ctx.restore();
  };
  drawRing(false);

  // The sphere itself.
  const D = r * 2;
  const g = sphereGeometry(D);
  const sphereC = makeCanvas(D, D);
  const sctx = sphereC.getContext('2d');
  const img = sctx.createImageData(D, D);
  const data = img.data;
  const { color, water, cloud, cloudRgb, atmo } = tex;
  const cloudPhase = phase * 1.35 + 0.17;
  for (const p of g.pts) {
    const u = p.lon + phase;
    const tx = (Math.floor((u - Math.floor(u)) * TW)) % TW;
    const ti = p.ty * TW + tx;
    let R = color[ti * 3];
    let G = color[ti * 3 + 1];
    let B = color[ti * 3 + 2];
    // Clouds turn a little faster than the surface.
    const cu = p.lon + cloudPhase;
    const ci = p.ty * TW + (Math.floor((cu - Math.floor(cu)) * TW) % TW);
    const ca = cloud[ci] / 255;
    if (ca > 0) {
      R += (cloudRgb[0] - R) * ca;
      G += (cloudRgb[1] - G) * ca;
      B += (cloudRgb[2] - B) * ca;
    }
    let l = p.light;
    R *= l;
    G *= l;
    B *= l;
    if (water[ti] && ca < 0.5) {
      const s = p.spec * 120 * (1 - ca * 2);
      R += s;
      G += s;
      B += s;
    }
    // Atmosphere scattering at the limb, strongest on the lit side.
    const rimK = p.rim * (0.25 + 0.75 * Math.max(0, p.dot + 0.2)) * 0.9;
    R += (atmo[0] - R) * rimK;
    G += (atmo[1] - G) * rimK;
    B += (atmo[2] - B) * rimK;
    data[p.i] = R;
    data[p.i + 1] = G;
    data[p.i + 2] = B;
    data[p.i + 3] = 255 * p.edge;
  }
  sctx.putImageData(img, 0, 0);
  ctx.drawImage(sphereC, cx - r, cy - r);

  // Ring shadow across the planet's face.
  if (ring) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy + r * 0.12);
    ctx.rotate(ringRot);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.6, r * 0.42, 0, 0, Math.PI);
    ctx.lineWidth = r * 0.16;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.stroke();
    ctx.restore();
  }
  drawRing(true);
  return c;
}
