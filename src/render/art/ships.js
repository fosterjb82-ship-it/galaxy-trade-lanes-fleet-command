// High-resolution ship art. Each ship is drawn as vector shapes in a
// 100 × 60 box facing right, then scaled to the exact device-pixel size.
// Metallic gradient hulls, panel lines, glass cockpits, player-colour trim
// and glowing engines; frame flickers the engine flames.

import { makeCanvas, poly, lighten, darken, rgba } from './core.js';

const HULL = { top: '#f1f4fa', mid: '#b8c1d3', low: '#7c869c', bottom: '#3a4256' };
const PIRATE_HULL = { top: '#a3a8b6', mid: '#666c7c', low: '#3e4250', bottom: '#1d1f27' };

export const SHIP_ASPECT = 0.6; // height / width

function hullGradient(ctx, s, y0, y1, h) {
  const g = ctx.createLinearGradient(0, y0 * s, 0, y1 * s);
  g.addColorStop(0, h.top);
  g.addColorStop(0.38, h.mid);
  g.addColorStop(0.72, h.low);
  g.addColorStop(1, h.bottom);
  return g;
}

function flame(ctx, s, x, y, len, width, colors, flicker) {
  const L = len * flicker;
  const g = ctx.createLinearGradient(x * s, 0, (x - L) * s, 0);
  g.addColorStop(0, colors[0]);
  g.addColorStop(0.25, colors[1]);
  g.addColorStop(1, rgba(colors[2], 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x * s, (y - width) * s);
  ctx.quadraticCurveTo((x - L * 0.55) * s, (y - width * 0.6) * s, (x - L) * s, y * s);
  ctx.quadraticCurveTo((x - L * 0.55) * s, (y + width * 0.6) * s, x * s, (y + width) * s);
  ctx.closePath();
  ctx.fill();
  // Hot core glow.
  const r = ctx.createRadialGradient(x * s, y * s, 0, x * s, y * s, width * 2.2 * s);
  r.addColorStop(0, rgba('#ffffff', 0.9));
  r.addColorStop(1, rgba(colors[1], 0));
  ctx.fillStyle = r;
  ctx.beginPath();
  ctx.arc(x * s, y * s, width * 2.2 * s, 0, Math.PI * 2);
  ctx.fill();
}

function cockpit(ctx, s, x, y, rx, ry, glass) {
  const g = ctx.createLinearGradient(0, (y - ry) * s, 0, (y + ry) * s);
  g.addColorStop(0, glass[0]);
  g.addColorStop(0.45, glass[1]);
  g.addColorStop(1, glass[2]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x * s, y * s, rx * s, ry * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(0.6, s * 0.6);
  ctx.strokeStyle = 'rgba(5, 10, 25, 0.7)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.ellipse((x + rx * 0.25) * s, (y - ry * 0.45) * s, rx * 0.35 * s, ry * 0.22 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function turret(ctx, s, x, y, r, barrel, h, up = true) {
  ctx.fillStyle = h.low;
  ctx.fillRect(x * s, (y - 1.3) * s, barrel * s, 2.6 * s);
  ctx.strokeStyle = 'rgba(5, 8, 18, 0.8)';
  ctx.lineWidth = Math.max(0.6, s * 0.5);
  ctx.strokeRect(x * s, (y - 1.3) * s, barrel * s, 2.6 * s);
  const g = ctx.createRadialGradient((x - r * 0.3) * s, (y - r * 0.4) * s, 0, x * s, y * s, r * s);
  g.addColorStop(0, h.top);
  g.addColorStop(1, h.bottom);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x * s, y * s, r * s, up ? Math.PI : 0, up ? Math.PI * 2 : Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** Fill + outline a polygon with the hull gradient. */
function hull(ctx, s, pts, h, fill = null) {
  const ys = pts.map((p) => p[1]);
  poly(ctx, pts, s);
  ctx.fillStyle = fill ?? hullGradient(ctx, s, Math.min(...ys), Math.max(...ys), h);
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(0.8, s * 1.1);
  ctx.strokeStyle = 'rgba(6, 9, 20, 0.88)';
  ctx.stroke();
}

function lines(ctx, s, segs, color = 'rgba(20, 26, 45, 0.45)') {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.5, s * 0.55);
  ctx.beginPath();
  for (const [[x0, y0], [x1, y1]] of segs) {
    ctx.moveTo(x0 * s, y0 * s);
    ctx.lineTo(x1 * s, y1 * s);
  }
  ctx.stroke();
}

function trim(ctx, s, pts, color) {
  const ys = pts.map((p) => p[1]);
  poly(ctx, pts, s);
  const g = ctx.createLinearGradient(0, Math.min(...ys) * s, 0, Math.max(...ys) * s);
  g.addColorStop(0, lighten(color, 0.35));
  g.addColorStop(1, darken(color, 0.25));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, s * 0.5);
  ctx.strokeStyle = 'rgba(6, 9, 20, 0.6)';
  ctx.stroke();
}

const mirror = (pts) => pts.map(([x, y]) => [x, 60 - y]);

const DESIGNS = {
  fighter(ctx, s, k) {
    flame(ctx, s, 17, 30, 20, 3.4, k.flame, k.flicker);
    const wing = [[28, 24], [44, 5], [55, 5], [53, 24]];
    hull(ctx, s, wing, k.h, k.wing);
    hull(ctx, s, mirror(wing), k.h, k.wing);
    trim(ctx, s, [[44, 5], [55, 5], [54.4, 10], [42, 10]], k.P);
    trim(ctx, s, mirror([[44, 5], [55, 5], [54.4, 10], [42, 10]]), k.P);
    hull(ctx, s, [[16, 25], [34, 21], [72, 24], [95, 30], [72, 36], [34, 39], [16, 35]], k.h);
    trim(ctx, s, [[34, 28.6], [70, 28], [76, 30], [70, 32], [34, 31.4]], k.P);
    lines(ctx, s, [[[48, 22.5], [48, 37.5]], [[30, 23], [30, 37]]]);
    cockpit(ctx, s, 70, 28.4, 9, 3.6, k.glass);
  },
  freighter(ctx, s, k) {
    flame(ctx, s, 8, 23, 14, 3, k.flame, k.flicker);
    flame(ctx, s, 8, 37, 14, 3, k.flame, k.flicker * 0.95);
    hull(ctx, s, [[6, 17], [16, 17], [16, 29], [6, 29]], k.h);
    hull(ctx, s, [[6, 31], [16, 31], [16, 43], [6, 43]], k.h);
    hull(ctx, s, [[14, 25], [64, 25], [64, 35], [14, 35]], k.h);
    const box = (x, y, c) => {
      hull(ctx, s, [[x, y], [x + 13, y], [x + 13, y + 11], [x, y + 11]], k.h, c);
      lines(ctx, s, [[[x + 4.3, y + 1], [x + 4.3, y + 10]], [[x + 8.6, y + 1], [x + 8.6, y + 10]]], 'rgba(0,0,0,0.25)');
    };
    const cols = [k.P, '#a8b2c6', lighten(k.P, 0.25)];
    [18, 32, 46].forEach((x, i) => {
      box(x, 13, cols[i % 3]);
      box(x, 36, cols[(i + 1) % 3]);
    });
    hull(ctx, s, [[62, 18], [84, 20], [97, 30], [84, 40], [62, 42]], k.h);
    trim(ctx, s, [[62, 37], [84, 37], [90, 35.5], [84, 40], [62, 42]], k.P);
    for (let i = 0; i < 4; i++) cockpit(ctx, s, 80 + i * 3.2, 27, 1.2, 1.4, k.glass);
  },
  frigate(ctx, s, k) {
    flame(ctx, s, 11, 30, 20, 4, k.flame, k.flicker);
    const fin = [[22, 22], [33, 7], [44, 7], [44, 21]];
    hull(ctx, s, fin, k.h, k.wing);
    hull(ctx, s, mirror(fin), k.h, k.wing);
    trim(ctx, s, [[33, 7], [44, 7], [44, 11], [30.5, 11]], k.P);
    trim(ctx, s, mirror([[33, 7], [44, 7], [44, 11], [30.5, 11]]), k.P);
    hull(ctx, s, [[10, 22], [40, 17], [80, 22], [98, 30], [80, 38], [40, 43], [10, 38]], k.h);
    trim(ctx, s, [[26, 28.2], [80, 28.2], [88, 30], [80, 31.8], [26, 31.8]], k.P);
    lines(ctx, s, [[[40, 18], [40, 42]], [[62, 20], [62, 40]], [[20, 23], [20, 37]]]);
    turret(ctx, s, 52, 19.5, 5, 18, k.h);
    cockpit(ctx, s, 83, 26.6, 7, 2.8, k.glass);
  },
  destroyer(ctx, s, k) {
    flame(ctx, s, 6, 24, 18, 3.8, k.flame, k.flicker);
    flame(ctx, s, 6, 36, 18, 3.8, k.flame, k.flicker * 0.93);
    hull(ctx, s, [[37, 14], [49, 5], [64, 5], [69, 15]], k.h);
    hull(ctx, s, [[5, 19], [28, 13], [78, 16], [99, 30], [78, 44], [28, 47], [5, 41]], k.h);
    trim(ctx, s, [[16, 28], [86, 28], [93, 30], [86, 32], [16, 32]], k.P);
    trim(ctx, s, [[28, 13.6], [52, 14.6], [52, 16.4], [28, 15.6]], k.P);
    lines(ctx, s, [[[28, 14], [28, 46]], [[48, 15], [48, 45]], [[66, 16], [66, 44]], [[10, 24], [26, 22]], [[10, 36], [26, 38]]]);
    turret(ctx, s, 33, 19, 5.2, 20, k.h);
    turret(ctx, s, 56, 20, 5.2, 20, k.h);
    turret(ctx, s, 44, 41, 4.6, 18, k.h, false);
    for (let i = 0; i < 3; i++) cockpit(ctx, s, 56 + i * 3.4, 9, 1.3, 1.2, k.glass);
  },
  corvette(ctx, s, k) {
    flame(ctx, s, 14, 30, 16, 3.6, k.flame, k.flicker);
    const pod = (y) => {
      hull(ctx, s, [[30, y], [62, y], [64, y + 4.5], [62, y + 9], [30, y + 9]], k.h);
      trim(ctx, s, [[30, y + 6.5], [62, y + 6.5], [62, y + 9], [30, y + 9]], k.P);
      for (let i = 0; i < 3; i++) {
        const my = y + 1.6 + i * 2.6;
        poly(ctx, [[62, my - 1], [69, my], [62, my + 1]], s);
        ctx.fillStyle = '#f4f7ff';
        ctx.fill();
        ctx.fillStyle = '#e5484d';
        ctx.beginPath();
        ctx.arc(68 * s, my * s, 0.9 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    pod(10);
    pod(41);
    hull(ctx, s, [[34, 19], [44, 19], [44, 41], [34, 41]], k.h, k.wing);
    hull(ctx, s, [[14, 23], [64, 21], [88, 27], [97, 30], [88, 33], [64, 39], [14, 37]], k.h);
    trim(ctx, s, [[20, 28.6], [74, 28.6], [80, 30], [74, 31.4], [20, 31.4]], k.P);
    lines(ctx, s, [[[50, 22], [50, 38]], [[26, 24], [26, 36]]]);
    cockpit(ctx, s, 80, 28.2, 7, 2.8, k.glass);
  },
  interceptor(ctx, s, k) {
    flame(ctx, s, 9, 30, 26, 3, k.flame, k.flicker);
    const wing = [[30, 27], [51, 3], [60, 3], [56, 27]];
    hull(ctx, s, wing, k.h, k.wing);
    hull(ctx, s, mirror(wing), k.h, k.wing);
    trim(ctx, s, [[51, 3], [60, 3], [59.4, 8], [47, 8]], k.P);
    trim(ctx, s, mirror([[51, 3], [60, 3], [59.4, 8], [47, 8]]), k.P);
    hull(ctx, s, [[8, 26], [60, 24], [99, 30], [60, 36], [8, 34]], k.h);
    trim(ctx, s, [[20, 29.2], [84, 29.4], [84, 30.6], [20, 30.8]], k.P);
    cockpit(ctx, s, 66, 28.3, 8, 2.8, k.glass);
    // Ion emitter glow at the nose.
    const g = ctx.createRadialGradient(94 * s, 30 * s, 0, 94 * s, 30 * s, 6 * s);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    g.addColorStop(0.35, 'rgba(197, 140, 255, 0.85)');
    g.addColorStop(1, 'rgba(155, 92, 230, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(94 * s, 30 * s, 6 * s, 0, Math.PI * 2);
    ctx.fill();
  },
  runner(ctx, s, k) {
    flame(ctx, s, 12, 26, 18, 3, k.flame, k.flicker);
    flame(ctx, s, 12, 34, 18, 3, k.flame, k.flicker * 0.94);
    hull(ctx, s, [[30, 20], [40, 9], [51, 9], [53, 19]], k.h, k.wing);
    hull(ctx, s, [[26, 38], [70, 38], [74, 43], [70, 49], [26, 49]], k.h, null);
    trim(ctx, s, [[28, 40], [68, 40], [71, 43.5], [68, 47], [28, 47]], k.P);
    hull(ctx, s, [[12, 22], [48, 18], [86, 24], [98, 30], [86, 36], [48, 40], [12, 38]], k.h);
    trim(ctx, s, [[40, 9], [51, 9], [52, 13], [36.5, 13]], k.P);
    lines(ctx, s, [[[48, 19], [48, 39]], [[30, 21], [30, 38]]]);
    cockpit(ctx, s, 82, 27.2, 8, 3, k.glass);
  },
  carrier(ctx, s, k) {
    for (const y of [22, 30, 38]) flame(ctx, s, 4, y, 13, 2.8, k.flame, k.flicker * (0.92 + (y % 3) * 0.04));
    hull(ctx, s, [[52, 16], [56, 5], [71, 5], [73, 16]], k.h);
    hull(ctx, s, [[4, 16], [84, 16], [99, 30], [84, 44], [4, 44]], k.h);
    // Flight deck.
    poly(ctx, [[10, 25.5], [86, 25.5], [90, 30], [86, 34.5], [10, 34.5]], s);
    ctx.fillStyle = '#262c3c';
    ctx.fill();
    ctx.setLineDash([2.4 * s, 2 * s]);
    lines(ctx, s, [[[12, 30], [84, 30]]], 'rgba(240, 244, 255, 0.85)');
    ctx.setLineDash([]);
    for (let x = 14; x < 84; x += 10) {
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(x * s, 26.6 * s, 0.7 * s, 0, Math.PI * 2);
      ctx.arc(x * s, 33.4 * s, 0.7 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    trim(ctx, s, [[10, 18], [80, 18], [80, 21], [10, 21]], k.P);
    trim(ctx, s, [[10, 39], [80, 39], [80, 42], [10, 42]], k.P);
    // Hangar mouth glow.
    const g = ctx.createLinearGradient(86 * s, 0, 96 * s, 0);
    g.addColorStop(0, 'rgba(255, 209, 102, 0.95)');
    g.addColorStop(1, 'rgba(255, 140, 66, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(86 * s, 28 * s, 10 * s, 4 * s);
    for (let i = 0; i < 4; i++) cockpit(ctx, s, 59 + i * 3.4, 9.5, 1.2, 1.3, k.glass);
  },
  pirate(ctx, s, k) {
    flame(ctx, s, 11, 30, 20, 4, k.flame, k.flicker);
    for (const spike of [[[30, 19], [36, 4], [42, 18]], [[50, 19], [57, 7], [62, 20]]]) {
      hull(ctx, s, spike, k.h, k.wing);
      hull(ctx, s, mirror(spike), k.h, k.wing);
    }
    hull(ctx, s, [[10, 22], [40, 16], [76, 21], [98, 30], [76, 39], [40, 44], [10, 38]], k.h);
    trim(ctx, s, [[18, 28.4], [78, 28.4], [86, 30], [78, 31.6], [18, 31.6]], k.P);
    lines(ctx, s, [[[30, 18], [30, 42]], [[56, 19], [56, 41]], [[44, 23], [70, 25]], [[44, 37], [70, 35]]]);
    turret(ctx, s, 46, 19, 4.6, 16, k.h);
    cockpit(ctx, s, 82, 28, 6.5, 2.6, k.glass);
  },
};

export const SHIP_DESIGNS = Object.keys(DESIGNS);

/**
 * @param {number} width   device pixels
 * @param {string} type    ship type (or 'pirate')
 * @param {string} color   trim colour
 * @param {number} frame   engine flicker frame
 * @param {{ flash?: boolean }} opts  white silhouette for hit flashes
 */
export function renderShip(width, type, color, frame = 0, { flash = false } = {}) {
  const W = Math.max(8, Math.round(width));
  const Hh = Math.round(W * SHIP_ASPECT);
  const c = makeCanvas(W, Hh);
  const ctx = c.getContext('2d');
  const s = W / 100;
  const pirate = type === 'pirate';
  const h = pirate ? PIRATE_HULL : HULL;
  const flicker = [1, 0.86, 1.1, 0.94][frame % 4];
  const k = {
    s, h, P: color, flicker,
    wing: (() => {
      const g = ctx.createLinearGradient(0, 0, 0, 60 * s);
      g.addColorStop(0, pirate ? '#6b7186' : '#c9d1e0');
      g.addColorStop(0.5, pirate ? '#3a3e4c' : '#6d778d');
      g.addColorStop(1, pirate ? '#6b7186' : '#c9d1e0');
      return g;
    })(),
    flame: pirate ? ['#fff3d6', '#ff8c42', '#e5484d'] : ['#ffffff', '#8fe3ff', '#3b9eff'],
    glass: pirate ? ['#ffd0c8', '#ff4d4d', '#5a0d0d'] : ['#f0fdff', '#55d3f5', '#0c4a68'],
  };
  (DESIGNS[type] ?? DESIGNS.frigate)(ctx, s, k);
  if (flash) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillRect(0, 0, W, Hh);
  }
  return c;
}
