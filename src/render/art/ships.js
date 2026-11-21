// High-resolution ship art, side view facing right.
//
// Each design is drawn as vector shapes in a 100 × 60 box and scaled to the
// exact device-pixel size it is shown at. Ships are lit from above: hulls get
// a steel gradient, riveted panel plating, a specular streak along the top,
// shadowed undersides and a crisp outline. Details are what make each class
// read differently: nozzle bells and exhaust plumes, lit window rows, twin
// turrets, missile hatches, cargo containers, sensor masts and player-colour
// markings. Classes also differ in size: a fighter fills about two thirds of
// the box, a destroyer or carrier all of it. Pirates are patched together
// from mismatched, rust-stained plates.

import { makeCanvas, lighten, darken, rgba, mix } from './core.js';

export const SHIP_ASPECT = 0.6; // height / width

const STEEL = { top: '#eef1f7', hi: '#c9d0dd', mid: '#97a1b4', low: '#5f6879', bottom: '#2a303d' };
const DARK = { top: '#9aa3b5', hi: '#6d7689', mid: '#4b5263', low: '#333947', bottom: '#191c25' };
const RUST = { top: '#c9b7a3', hi: '#9c8873', mid: '#6f5f50', low: '#4a3e35', bottom: '#221c18' };

/** How much of the 100 × 60 box each class fills (smaller = smaller ship). */
const SIZE = {
  fighter: 0.7, interceptor: 0.78, corvette: 0.84, freighter: 0.9, runner: 0.84,
  frigate: 0.88, destroyer: 1, carrier: 1, pirate: 0.88,
};

// ---------------------------------------------------------------- helpers

function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a scaled Path2D from ['M',x,y] ['L',x,y] ['Q',cx,cy,x,y] ['C',…] ['Z'] commands. */
function pathOf(cmds, s) {
  const p = new Path2D();
  for (const [op, ...a] of cmds) {
    const v = a.map((n) => n * s);
    if (op === 'M') p.moveTo(...v);
    else if (op === 'L') p.lineTo(...v);
    else if (op === 'Q') p.quadraticCurveTo(...v);
    else if (op === 'C') p.bezierCurveTo(...v);
    else if (op === 'Z') p.closePath();
  }
  return p;
}

const poly = (pts) => [['M', ...pts[0]], ...pts.slice(1).map((p) => ['L', ...p]), ['Z']];
const mirror = (cmds) => cmds.map(([op, ...a]) => [op, ...a.map((n, i) => (i % 2 ? 60 - n : n))]);
const bboxOf = (cmds) => {
  const xs = [];
  const ys = [];
  for (const [, ...a] of cmds) a.forEach((n, i) => (i % 2 ? ys : xs).push(n));
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

/**
 * A lit, plated hull section.
 * @param {object} o { metal, plates (true), seams, tone (-1..1 brightness), rust }
 */
function hull(k, cmds, o = {}) {
  const { ctx, s, rnd, detail } = k;
  const m = o.metal ?? k.metal;
  const p = pathOf(cmds, s);
  const b = bboxOf(cmds);
  const h = b.y1 - b.y0;
  const tone = o.tone ?? 0;
  const adj = (c) => (tone > 0 ? lighten(c, tone) : tone < 0 ? darken(c, -tone) : c);

  // Base: lit from above.
  const g = ctx.createLinearGradient(0, b.y0 * s, 0, b.y1 * s);
  g.addColorStop(0, adj(m.top));
  g.addColorStop(0.18, adj(m.hi));
  g.addColorStop(0.55, adj(m.mid));
  g.addColorStop(0.82, adj(m.low));
  g.addColorStop(1, adj(m.bottom));
  ctx.fillStyle = g;
  ctx.fill(p);

  ctx.save();
  ctx.clip(p);
  // Panel plating: rows of plates, each a touch lighter or darker.
  if (o.plates !== false && detail > 0.25) {
    const pw = o.plateW ?? 7;
    const ph = o.plateH ?? Math.max(3, h / 3);
    for (let y = b.y0; y < b.y1; y += ph) {
      const off = (Math.floor((y - b.y0) / ph) % 2) * pw * 0.5;
      for (let x = b.x0 - off; x < b.x1; x += pw) {
        const v = rnd() - 0.5;
        ctx.fillStyle = v > 0 ? rgba('#ffffff', v * 0.12) : rgba('#000000', -v * 0.16);
        ctx.fillRect(x * s, y * s, pw * s, ph * s);
      }
    }
    ctx.strokeStyle = rgba('#0a0e18', 0.28 * detail);
    ctx.lineWidth = Math.max(0.4, s * 0.28);
    ctx.beginPath();
    for (let y = b.y0 + ph; y < b.y1; y += ph) { ctx.moveTo(b.x0 * s, y * s); ctx.lineTo(b.x1 * s, y * s); }
    for (let y = b.y0; y < b.y1; y += ph) {
      const off = (Math.floor((y - b.y0) / ph) % 2) * pw * 0.5;
      for (let x = b.x0 - off + pw; x < b.x1; x += pw) { ctx.moveTo(x * s, y * s); ctx.lineTo(x * s, (y + ph) * s); }
    }
    ctx.stroke();
  }
  // Rust and scorch stains.
  if (o.rust) {
    for (let i = 0; i < o.rust; i++) {
      const x = b.x0 + rnd() * (b.x1 - b.x0);
      const y = b.y0 + rnd() * h;
      const r = (1.5 + rnd() * 4) * s;
      const rg = ctx.createRadialGradient(x * s, y * s, 0, x * s, y * s, r);
      rg.addColorStop(0, rgba(rnd() > 0.4 ? '#8a4a24' : '#1a120c', 0.55));
      rg.addColorStop(1, rgba('#8a4a24', 0));
      ctx.fillStyle = rg;
      ctx.fillRect(x * s - r, y * s - r, r * 2, r * 2);
    }
  }
  // Rear of the ship falls into shadow.
  const side = ctx.createLinearGradient(b.x0 * s, 0, b.x1 * s, 0);
  side.addColorStop(0, rgba('#000000', 0.32));
  side.addColorStop(0.45, rgba('#000000', 0));
  side.addColorStop(1, rgba('#ffffff', 0.04));
  ctx.fillStyle = side;
  ctx.fillRect(b.x0 * s, b.y0 * s, (b.x1 - b.x0) * s, h * s);
  // Specular streak near the top edge, and a reflected rim of light underneath.
  const spec = ctx.createLinearGradient(0, b.y0 * s, 0, (b.y0 + h * 0.4) * s);
  spec.addColorStop(0, rgba('#ffffff', 0));
  spec.addColorStop(0.35, rgba('#ffffff', 0.38));
  spec.addColorStop(0.55, rgba('#ffffff', 0));
  ctx.fillStyle = spec;
  ctx.fillRect(b.x0 * s, b.y0 * s, (b.x1 - b.x0) * s, h * 0.4 * s);
  const rim = ctx.createLinearGradient(0, (b.y1 - h * 0.12) * s, 0, b.y1 * s);
  rim.addColorStop(0, rgba('#7fb4ff', 0));
  rim.addColorStop(1, rgba('#7fb4ff', 0.22));
  ctx.fillStyle = rim;
  ctx.fillRect(b.x0 * s, (b.y1 - h * 0.12) * s, (b.x1 - b.x0) * s, h * 0.12 * s);
  ctx.restore();

  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(0.7, s * 0.75);
  ctx.strokeStyle = 'rgba(5, 7, 14, 0.92)';
  ctx.stroke(p);
  return p;
}

/** Player-colour paint: stripe, band or marking (clipped to `within` if given). */
function paint(k, cmds, color = k.P, within = null) {
  const { ctx, s } = k;
  const p = pathOf(cmds, s);
  const b = bboxOf(cmds);
  ctx.save();
  if (within) ctx.clip(within);
  const g = ctx.createLinearGradient(0, b.y0 * s, 0, b.y1 * s);
  g.addColorStop(0, lighten(color, 0.32));
  g.addColorStop(0.5, color);
  g.addColorStop(1, darken(color, 0.35));
  ctx.fillStyle = g;
  ctx.fill(p);
  ctx.lineWidth = Math.max(0.4, s * 0.35);
  ctx.strokeStyle = rgba('#05070e', 0.55);
  ctx.stroke(p);
  ctx.restore();
}

/** Thin dark detail lines (hatches, seams, greebles). */
function lines(k, segs, color = 'rgba(8, 11, 20, 0.6)', w = 0.45) {
  const { ctx, s } = k;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.4, s * w);
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of segs) {
    ctx.moveTo(x0 * s, y0 * s);
    ctx.lineTo(x1 * s, y1 * s);
  }
  ctx.stroke();
}

/** A row of lit windows. */
function windows(k, x0, x1, y, n, { size = 0.9, color = '#ffe6a8' } = {}) {
  const { ctx, s, detail } = k;
  if (detail < 0.2) return;
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / Math.max(1, n - 1);
    const lit = k.rnd() > 0.18;
    ctx.fillStyle = lit ? color : '#1a2233';
    ctx.fillRect((x - size * 0.5) * s, (y - size * 0.45) * s, size * s, size * 0.9 * s);
    if (lit) {
      ctx.fillStyle = rgba(color, 0.25);
      ctx.fillRect((x - size) * s, (y - size * 0.9) * s, size * 2 * s, size * 1.8 * s);
    }
  }
}

/** Glass canopy with a reflection. */
function canopy(k, cmds) {
  const { ctx, s } = k;
  const p = pathOf(cmds, s);
  const b = bboxOf(cmds);
  const g = ctx.createLinearGradient(0, b.y0 * s, 0, b.y1 * s);
  g.addColorStop(0, k.glass[0]);
  g.addColorStop(0.4, k.glass[1]);
  g.addColorStop(1, k.glass[2]);
  ctx.fillStyle = g;
  ctx.fill(p);
  ctx.save();
  ctx.clip(p);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(((b.x0 + b.x1) / 2 + (b.x1 - b.x0) * 0.12) * s, (b.y0 + (b.y1 - b.y0) * 0.3) * s, (b.x1 - b.x0) * 0.28 * s, (b.y1 - b.y0) * 0.16 * s, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = Math.max(0.5, s * 0.5);
  ctx.strokeStyle = 'rgba(5, 8, 16, 0.85)';
  ctx.stroke(p);
}

/** Engine nozzle bell at the rear (x is the exit plane) with its exhaust plume. */
function engine(k, x, y, r, len = 14, { bell = 4 } = {}) {
  const { ctx, s, flicker } = k;
  // Plume.
  const L = len * flicker;
  const pg = ctx.createLinearGradient(x * s, 0, (x - L) * s, 0);
  pg.addColorStop(0, k.flame[0]);
  pg.addColorStop(0.2, k.flame[1]);
  pg.addColorStop(0.6, rgba(k.flame[2], 0.45));
  pg.addColorStop(1, rgba(k.flame[2], 0));
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.moveTo(x * s, (y - r * 0.85) * s);
  ctx.quadraticCurveTo((x - L * 0.5) * s, (y - r * 0.55) * s, (x - L) * s, y * s);
  ctx.quadraticCurveTo((x - L * 0.5) * s, (y + r * 0.55) * s, x * s, (y + r * 0.85) * s);
  ctx.closePath();
  ctx.fill();
  // Shock diamonds.
  if (k.detail > 0.3) {
    for (let i = 1; i <= 3; i++) {
      const dx = x - (L * i) / 4.2;
      const dr = r * (0.42 - i * 0.08);
      ctx.fillStyle = rgba('#ffffff', 0.5 - i * 0.12);
      ctx.beginPath();
      ctx.ellipse(dx * s, y * s, dr * 1.6 * s, dr * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Bell.
  const cmds = poly([[x, y - r], [x + bell, y - r * 0.62], [x + bell, y + r * 0.62], [x, y + r]]);
  hull(k, cmds, { metal: DARK, plates: false });
  const glow = ctx.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * 1.3 * s);
  glow.addColorStop(0, rgba('#ffffff', 0.95));
  glow.addColorStop(0.4, rgba(k.flame[1], 0.7));
  glow.addColorStop(1, rgba(k.flame[2], 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(x * s, y * s, r * 0.55 * s, r * 0.95 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Twin-barrel turret (dorsal when up, ventral otherwise), barrels pointing forward. */
function turret(k, x, y, r, barrel, up = true) {
  const { ctx, s } = k;
  const dir = up ? -1 : 1;
  for (const off of [-0.55, 0.55]) {
    const by = y + dir * r * 0.45 + off;
    hull(k, poly([[x, by - 0.45], [x + barrel, by - 0.35], [x + barrel, by + 0.35], [x, by + 0.45]]), { metal: DARK, plates: false });
  }
  const cmds = up
    ? [['M', x - r, y], ['Q', x - r, y - r * 1.1, x + r * 0.2, y - r], ['Q', x + r * 1.1, y - r * 0.8, x + r, y], ['Z']]
    : [['M', x - r, y], ['Q', x - r, y + r * 1.1, x + r * 0.2, y + r], ['Q', x + r * 1.1, y + r * 0.8, x + r, y], ['Z']];
  hull(k, cmds, { plates: false, tone: -0.05 });
  lines(k, [[x - r * 0.6, y + dir * r * 0.35, x + r * 0.6, y + dir * r * 0.35]]);
}

/** Antenna / sensor mast with a blinking tip. */
function mast(k, x, y, h, tip = '#ff5d5d') {
  const { ctx, s } = k;
  lines(k, [[x, y, x, y - h]], 'rgba(30, 36, 52, 0.95)', 0.5);
  ctx.fillStyle = tip;
  ctx.beginPath();
  ctx.arc(x * s, (y - h) * s, 0.7 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(tip, 0.3);
  ctx.beginPath();
  ctx.arc(x * s, (y - h) * s, 1.8 * s, 0, Math.PI * 2);
  ctx.fill();
}

/** Small RCS thruster blocks / greebles along an edge. */
function greebles(k, x0, x1, y, n, h = 1.4) {
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
    const w = 1.5 + k.rnd() * 2;
    hull(k, poly([[x, y - h / 2], [x + w, y - h / 2], [x + w, y + h / 2], [x, y + h / 2]]), { plates: false, metal: DARK });
  }
}

/** Painted hull number. */
function hullNumber(k, x, y, size, within) {
  const { ctx, s, detail } = k;
  if (detail < 0.45) return;
  ctx.save();
  if (within) ctx.clip(within);
  ctx.font = `800 ${size * s}px "Inter", system-ui, sans-serif`;
  ctx.fillStyle = rgba('#0b0f1c', 0.55);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(k.code, x * s, y * s);
  ctx.restore();
}

// ---------------------------------------------------------------- designs

const DESIGNS = {
  /** Small single-seat dart: swept wings, wingtip guns, bubble canopy. */
  fighter(k) {
    engine(k, 20, 30, 3.2, 16);
    const wing = poly([[46, 26], [30, 9], [24, 9], [32, 27]]);
    hull(k, wing, { tone: -0.08, plateW: 5 });
    hull(k, mirror(wing), { tone: -0.12, plateW: 5 });
    paint(k, poly([[30, 9], [24, 9], [26.5, 13], [33.5, 13]]));
    paint(k, mirror(poly([[30, 9], [24, 9], [26.5, 13], [33.5, 13]])));
    for (const y of [10.5, 49.5]) hull(k, poly([[27, y - 0.9], [42, y - 0.6], [42, y + 0.6], [27, y + 0.9]]), { metal: DARK, plates: false });
    const body = hull(k, [['M', 20, 26.5], ['L', 40, 24], ['Q', 68, 22.5, 94, 30], ['Q', 68, 37.5, 40, 36], ['L', 20, 33.5], ['Z']], { plateW: 6 });
    paint(k, poly([[40, 31.6], [80, 31.4], [84, 33], [40, 34]]), k.P, body);
    canopy(k, [['M', 58, 26.4], ['Q', 66, 22.6, 78, 26.6], ['Q', 70, 28.4, 58, 28.2], ['Z']]);
    lines(k, [[44, 25, 44, 35], [33, 25.5, 33, 34.5]]);
  },

  /** Fast needle with forward-swept wings, twin engine pods and an ion emitter. */
  interceptor(k) {
    for (const y of [23.5, 36.5]) engine(k, 13, y, 2.8, 20);
    for (const [y0, y1] of [[25.5, 28.5], [31.5, 34.5]]) hull(k, poly([[20, y0], [30, y0], [30, y1], [20, y1]]), { metal: DARK, plates: false });
    for (const y of [23.5, 36.5]) {
      hull(k, [['M', 13, y - 3], ['L', 34, y - 2.6], ['Q', 38, y, 34, y + 2.6], ['L', 13, y + 3], ['Z']], { tone: -0.1, plateW: 5 });
    }
    const wing = poly([[38, 27], [56, 5], [63, 5], [52, 27]]);
    hull(k, wing, { tone: -0.06 });
    hull(k, mirror(wing), { tone: -0.12 });
    paint(k, poly([[56, 5], [63, 5], [61, 9], [52.7, 9]]));
    paint(k, mirror(poly([[56, 5], [63, 5], [61, 9], [52.7, 9]])));
    const body = hull(k, [['M', 16, 27.4], ['L', 60, 25.8], ['L', 99, 30], ['L', 60, 34.2], ['L', 16, 32.6], ['Z']], { plateW: 8, plateH: 3 });
    paint(k, poly([[24, 29.2], [86, 29.5], [86, 30.5], [24, 30.8]]), k.P, body);
    canopy(k, [['M', 62, 27.6], ['Q', 70, 24.8, 80, 28.4], ['Q', 71, 29.5, 62, 29.2], ['Z']]);
    const { ctx, s } = k;
    const g = ctx.createRadialGradient(95 * s, 30 * s, 0, 95 * s, 30 * s, 6 * s);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    g.addColorStop(0.35, 'rgba(197, 140, 255, 0.85)');
    g.addColorStop(1, 'rgba(155, 92, 230, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(95 * s, 30 * s, 6 * s, 0, Math.PI * 2);
    ctx.fill();
  },

  /** Missile corvette: slim hull with dorsal and ventral vertical launch blocks. */
  corvette(k) {
    engine(k, 12, 30, 3.6, 16);
    for (const [y0, y1] of [[20.5, 24], [36, 39.5]]) {
      for (const x of [36, 54]) hull(k, poly([[x, y0], [x + 4, y0], [x + 4, y1], [x, y1]]), { metal: DARK, plates: false });
    }
    for (const up of [true, false]) {
      const y0 = up ? 14 : 39;
      const block = hull(k, poly([[28, y0], [64, y0], [67, y0 + 3.5], [64, y0 + 7], [28, y0 + 7]]), { tone: -0.04, plates: false });
      // Launch hatches with warheads.
      for (let i = 0; i < 6; i++) {
        const x = 31 + i * 5.4;
        hull(k, poly([[x, y0 + 1.4], [x + 4, y0 + 1.4], [x + 4, y0 + 5.6], [x, y0 + 5.6]]), { metal: DARK, plates: false });
        k.ctx.fillStyle = i % 2 ? '#ff6b5e' : '#ffd166';
        k.ctx.beginPath();
        k.ctx.arc((x + 2) * k.s, (y0 + 3.5) * k.s, 0.9 * k.s, 0, Math.PI * 2);
        k.ctx.fill();
      }
      paint(k, poly([[28, up ? y0 : y0 + 6], [64, up ? y0 : y0 + 6], [64, up ? y0 + 1 : y0 + 7], [28, up ? y0 + 1 : y0 + 7]]), k.P, block);
    }
    const fin = poly([[14, 26], [10, 18], [16, 18], [24, 26]]);
    hull(k, fin, { tone: -0.1 });
    hull(k, mirror(fin), { tone: -0.15 });
    const body = hull(k, [['M', 12, 24.5], ['L', 70, 22.5], ['Q', 88, 25, 96, 30], ['Q', 88, 35, 70, 37.5], ['L', 12, 35.5], ['Z']]);
    paint(k, poly([[18, 29], [76, 28.6], [82, 30], [76, 31.4], [18, 31]]), k.P, body);
    windows(k, 70, 84, 27, 5);
    canopy(k, [['M', 82, 27.2], ['Q', 88, 26.2, 93, 29], ['Q', 88, 29.2, 82, 28.8], ['Z']]);
    hullNumber(k, 46, 33.6, 4.2, body);
  },

  /** Industrial hauler: engine block, open truss spine, stacked containers, bridge. */
  freighter(k) {
    engine(k, 8, 24, 3.6, 13, { bell: 3.4 });
    engine(k, 8, 36, 3.6, 13, { bell: 3.4 });
    hull(k, poly([[11, 17], [22, 18], [22, 42], [11, 43]]), { metal: DARK, plateH: 4 });
    greebles(k, 12, 21, 16.2, 3);
    // Truss spine.
    hull(k, poly([[21, 28], [76, 28], [76, 32], [21, 32]]), { metal: DARK, plates: false });
    const tr = [];
    for (let x = 22; x < 75; x += 4) tr.push([x, 28.3, x + 4, 31.7], [x, 31.7, x + 4, 28.3]);
    lines(k, tr, 'rgba(150, 160, 180, 0.55)', 0.35);
    // Cargo containers in assorted paint.
    const colors = [k.P, '#c77d34', '#7f8a9e', '#3e8c86', lighten(k.P, 0.2), '#9a4a3a'];
    let i = 0;
    for (const [y0, y1] of [[17.5, 27.5], [32.5, 42.5]]) {
      for (let x = 24; x < 72; x += 12) {
        const box = poly([[x, y0], [x + 11, y0], [x + 11, y1], [x, y1]]);
        const c = colors[(i += 1) % colors.length];
        hull(k, box, { metal: { top: lighten(c, 0.45), hi: lighten(c, 0.15), mid: c, low: darken(c, 0.3), bottom: darken(c, 0.6) }, plates: false });
        lines(k, [[x + 2.7, y0 + 0.8, x + 2.7, y1 - 0.8], [x + 5.5, y0 + 0.8, x + 5.5, y1 - 0.8], [x + 8.3, y0 + 0.8, x + 8.3, y1 - 0.8]], 'rgba(0,0,0,0.3)', 0.35);
      }
    }
    // Bridge module.
    const bridge = hull(k, [['M', 74, 19], ['L', 86, 20], ['Q', 97, 24, 98, 30], ['Q', 97, 36, 86, 40], ['L', 74, 41], ['Z']], { plateW: 5 });
    paint(k, poly([[74, 35.5], [92, 35.5], [94.5, 37], [86, 40], [74, 41]]), k.P, bridge);
    windows(k, 81, 92, 25.2, 5, { color: '#bfefff' });
    windows(k, 78, 90, 29.6, 5);
    mast(k, 80, 19.4, 5, '#ffd166');
  },

  /** Blockade runner: dark, smooth smuggler hull, oversized engines, chevrons. */
  runner(k) {
    engine(k, 10, 26, 3.4, 20);
    engine(k, 10, 34, 3.4, 20);
    const fin = [['M', 30, 22], ['Q', 38, 10, 52, 9], ['L', 50, 21], ['Z']];
    hull(k, fin, { metal: DARK, tone: 0.06 });
    paint(k, [['M', 40, 13.5], ['Q', 46, 10, 52, 9], ['L', 51.4, 13], ['Z']]);
    const body = hull(k, [['M', 12, 23], ['Q', 40, 17, 68, 21], ['Q', 92, 25, 99, 30], ['Q', 92, 35, 68, 39], ['Q', 40, 43, 12, 37], ['Z']], { metal: DARK, tone: 0.08, plateW: 9 });
    for (const x of [30, 38, 46]) paint(k, poly([[x, 28.6], [x + 5, 30], [x, 31.4], [x - 2.4, 31.4], [x + 2.6, 30], [x - 2.4, 28.6]]), k.P, body);
    canopy(k, [['M', 74, 26.6], ['Q', 84, 24.4, 93, 28.6], ['Q', 84, 28.8, 74, 28.4], ['Z']]);
    hull(k, poly([[24, 38.5], [62, 38], [60, 41.5], [26, 42]]), { tone: -0.1, plates: false });
    windows(k, 64, 72, 33, 3, { color: '#bfefff', size: 0.8 });
  },

  /** Frigate: angular warship, dorsal superstructure, twin turret, ventral fin. */
  frigate(k) {
    engine(k, 9, 25.5, 3.4, 15);
    engine(k, 9, 34.5, 3.4, 15);
    hull(k, poly([[36, 42], [50, 42], [46, 51], [40, 51]]), { tone: -0.12 });
    const body = hull(k, poly([[10, 21.5], [30, 18], [76, 21], [99, 30], [76, 39], [30, 42], [10, 38.5]]), { plateW: 7 });
    hull(k, poly([[38, 18.6], [44, 13], [64, 13.4], [68, 19.6]]), { tone: 0.04, plateW: 5 });
    windows(k, 47, 63, 15.6, 6, { color: '#bfefff' });
    paint(k, poly([[18, 28.8], [80, 28.6], [88, 30], [80, 31.4], [18, 31.2]]), k.P, body);
    turret(k, 30, 19.2, 3.6, 12);
    windows(k, 30, 76, 34.2, 9);
    mast(k, 58, 13.4, 6);
    hullNumber(k, 58, 26.2, 4.4, body);
    lines(k, [[30, 18.5, 30, 41.5], [52, 19.6, 52, 40.4]]);
  },

  /** Destroyer: long armoured hull, stepped bridge tower, three twin turrets. */
  destroyer(k) {
    for (const y of [23, 30, 37]) engine(k, 5, y, 3.2, 15, { bell: 3.6 });
    const body = hull(k, poly([[6, 18], [22, 13.5], [80, 15.5], [99, 30], [80, 44.5], [22, 46.5], [6, 42]]), { plateW: 8, plateH: 5 });
    // Armour belt.
    hull(k, poly([[16, 27], [86, 26.6], [92, 30], [86, 33.4], [16, 33]]), { tone: -0.08, plateW: 6, plateH: 3 });
    paint(k, poly([[16, 29.2], [88, 29], [91, 30], [88, 31], [16, 30.8]]), k.P, body);
    // Stepped bridge tower.
    hull(k, poly([[42, 15], [46, 9], [66, 9], [70, 15.6]]), { tone: 0.02, plateW: 5 });
    hull(k, poly([[49, 9.2], [52, 4.5], [62, 4.5], [64, 9.2]]), { tone: 0.06, plates: false });
    windows(k, 53, 61, 6.6, 5, { color: '#bfefff' });
    windows(k, 48, 66, 11.6, 8);
    mast(k, 57, 4.6, 4.5);
    turret(k, 28, 15.2, 4.2, 14);
    turret(k, 76, 16.6, 3.8, 12);
    turret(k, 52, 45.6, 4, 13, false);
    windows(k, 20, 84, 38.6, 14);
    greebles(k, 24, 74, 42.6, 6, 1.2);
    hullNumber(k, 36, 22.4, 5, body);
    lines(k, [[22, 14, 22, 46], [42, 15, 42, 45.5], [70, 15.6, 70, 44.6]]);
  },

  /** Carrier: massive slab hull, angled flight deck, island tower, lit hangar mouth. */
  carrier(k) {
    for (const y of [20, 26.7, 33.3, 40]) engine(k, 3, y, 2.8, 12, { bell: 3 });
    const body = hull(k, poly([[3, 15], [84, 15], [99, 23], [99, 37], [84, 45], [3, 45]]), { plateW: 9, plateH: 5 });
    // Flight deck.
    const deck = pathOf(poly([[8, 24.5], [90, 24.5], [96, 27], [96, 33], [90, 35.5], [8, 35.5]]), k.s);
    k.ctx.fillStyle = '#20252f';
    k.ctx.fill(deck);
    k.ctx.save();
    k.ctx.setLineDash([2.4 * k.s, 2 * k.s]);
    lines(k, [[12, 30, 88, 30]], 'rgba(240, 244, 255, 0.85)', 0.45);
    k.ctx.restore();
    for (let x = 14; x < 88; x += 8) {
      k.ctx.fillStyle = '#ffd166';
      k.ctx.fillRect((x - 0.4) * k.s, 25.6 * k.s, 0.8 * k.s, 0.8 * k.s);
      k.ctx.fillRect((x - 0.4) * k.s, 33.6 * k.s, 0.8 * k.s, 0.8 * k.s);
    }
    paint(k, poly([[8, 17], [82, 17], [82, 19.5], [8, 19.5]]), k.P, body);
    paint(k, poly([[8, 40.5], [82, 40.5], [82, 43], [8, 43]]), k.P, body);
    // Hangar mouth glow.
    const g = k.ctx.createLinearGradient(90 * k.s, 0, 99 * k.s, 0);
    g.addColorStop(0, 'rgba(255, 209, 102, 0.95)');
    g.addColorStop(1, 'rgba(255, 140, 66, 0)');
    k.ctx.fillStyle = g;
    k.ctx.fillRect(89 * k.s, 27.5 * k.s, 9 * k.s, 5 * k.s);
    // Island tower.
    hull(k, poly([[54, 15.2], [57, 6], [72, 6], [76, 15.2]]), { tone: 0.04, plateW: 5 });
    windows(k, 59, 70, 9.2, 6, { color: '#bfefff' });
    mast(k, 64, 6, 4.5);
    mast(k, 70, 6, 3, '#6dffa8');
    windows(k, 10, 80, 22, 16);
    windows(k, 10, 80, 38.4, 16);
    hullNumber(k, 30, 21.8, 3.6, body);
  },

  /** Pirate raider: patched, rust-stained hull, mismatched engines, spikes and a ram. */
  pirate(k) {
    engine(k, 10, 25, 4, 18);
    engine(k, 12, 36, 2.6, 12, { bell: 3 });
    for (const sp of [poly([[28, 20], [32, 6], [38, 19]]), poly([[48, 19], [55, 8], [59, 20]])]) {
      hull(k, sp, { metal: RUST, plates: false, rust: 2 });
      hull(k, mirror(sp), { metal: RUST, plates: false, rust: 2 });
    }
    const body = hull(k, poly([[10, 21], [26, 17.5], [44, 19], [62, 16.5], [80, 21], [92, 26], [99, 30], [92, 34.5], [78, 40], [58, 43], [40, 41.5], [24, 43], [10, 39]]), { metal: RUST, rust: 9, plateW: 6 });
    // Welded-on armour patches in mismatched metal.
    for (const [x, y, w, hh, m] of [[32, 22, 12, 6, STEEL], [56, 31, 10, 7, DARK], [70, 22.5, 9, 5, STEEL], [18, 31, 8, 6, DARK]]) {
      k.ctx.save();
      k.ctx.clip(body);
      hull(k, poly([[x, y], [x + w, y + 0.6], [x + w - 0.6, y + hh], [x + 0.4, y + hh - 0.4]]), { metal: m, tone: -0.18, plates: false, rust: 2 });
      k.ctx.restore();
      const rivets = [];
      for (let i = 0; i <= 3; i++) rivets.push([x + (w * i) / 3, y + 0.8, x + (w * i) / 3 + 0.3, y + 0.8]);
      lines(k, rivets, 'rgba(230, 210, 190, 0.55)', 0.5);
    }
    // Ram and red raider markings.
    hull(k, poly([[92, 27.5], [100, 30], [92, 32.5]]), { metal: DARK, plates: false });
    paint(k, poly([[40, 27.6], [52, 26.2], [50, 30], [52, 33.8], [40, 32.4], [43, 30]]), k.P, body);
    turret(k, 46, 19.4, 3.6, 12);
    canopy(k, [['M', 76, 26.6], ['Q', 83, 24.8, 89, 28.2], ['Q', 82, 28.6, 76, 28.4], ['Z']]);
    windows(k, 60, 74, 36.4, 4, { color: '#ff8a7a', size: 0.8 });
  },
};

export const SHIP_DESIGNS = Object.keys(DESIGNS);

/** Steel with a coat of the player's colour, so fleets read at a glance. */
function tinted(color) {
  const t = (c, a) => mix(c, color, a);
  return { top: t(STEEL.top, 0.1), hi: t(STEEL.hi, 0.2), mid: t(STEEL.mid, 0.3), low: t(STEEL.low, 0.28), bottom: t(STEEL.bottom, 0.2) };
}

/**
 * @param {number} width   device pixels
 * @param {string} type    ship type (or 'pirate')
 * @param {string} color   player colour for markings
 * @param {number} frame   engine flicker frame
 * @param {{ flash?: boolean }} opts  white silhouette for hit flashes
 */
export function renderShip(width, type, color, frame = 0, { flash = false } = {}) {
  const W = Math.max(8, Math.round(width));
  const Hh = Math.round(W * SHIP_ASPECT);
  const c = makeCanvas(W, Hh);
  const ctx = c.getContext('2d');
  const design = DESIGNS[type] ?? DESIGNS.frigate;
  const size = SIZE[type] ?? 0.9;
  const s = (W / 100) * size;
  // Centre the (scaled) 100 × 60 drawing in the box.
  ctx.translate((W - 100 * s) / 2, (Hh - 60 * s) / 2);
  const pirate = type === 'pirate';
  const k = {
    ctx,
    s,
    P: color,
    metal: pirate || flash ? STEEL : tinted(color),
    rnd: seeded(`${type}|ship`),
    detail: Math.min(1, W / 220), // fewer fine details on small sprites
    flicker: [1, 0.86, 1.1, 0.94][frame % 4],
    flame: pirate ? ['#fff3d6', '#ff8c42', '#e5484d'] : ['#ffffff', '#8fe3ff', '#3b9eff'],
    glass: pirate ? ['#ffd0c8', '#ff4d4d', '#4a0b0b'] : ['#f0fdff', '#4fc6ea', '#0b3a55'],
    code: { fighter: 'F', interceptor: 'I', corvette: 'C-2', freighter: 'T', runner: 'R', frigate: 'F-4', destroyer: 'D-7', carrier: 'CV-1', pirate: '' }[type] ?? '',
  };
  design(k);
  if (flash) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillRect(0, 0, W, Hh);
  }
  return c;
}
