// High-resolution hex tiles and the features that sit on them (stations,
// jump gates, trade beacons, hidden anomalies) plus card icons.

import { makeCanvas, hexPath, rgba, mix, lighten, darken, rng, poly } from './core.js';

/** Tile art box in board units (matches the hex grid spacing). */
export const TILE_BOX = { w: 28, h: 32 };

const SPACE = { center: '#16245a', edge: '#0a1230', line: '#23336a' };

function base(ctx, W, Hh, r, tint, seed, feature) {
  const cx = W / 2;
  const cy = Hh / 2;
  hexPath(ctx, cx, cy, r);
  const g = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.1, cx, cy, r * 1.05);
  const center = tint ? mix(SPACE.center, tint, 0.45) : feature ? '#1a2b66' : SPACE.center;
  const edge = tint ? mix(SPACE.edge, tint, 0.35) : SPACE.edge;
  g.addColorStop(0, center);
  g.addColorStop(1, edge);
  ctx.fillStyle = g;
  ctx.fill();
  // Starfield speckle.
  ctx.save();
  hexPath(ctx, cx, cy, r);
  ctx.clip();
  const rnd = rng(seed * 7919 + 13);
  const unit = W / 28;
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W;
    const y = rnd() * Hh;
    const big = rnd() < 0.12;
    const rad = (big ? 0.42 : 0.16 + rnd() * 0.16) * unit;
    ctx.fillStyle = rgba(rnd() < 0.3 ? '#ffe9c4' : '#dce6ff', big ? 0.95 : 0.35 + rnd() * 0.45);
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    if (big) {
      ctx.strokeStyle = rgba('#dce6ff', 0.35);
      ctx.lineWidth = unit * 0.12;
      ctx.beginPath();
      ctx.moveTo(x - rad * 3, y);
      ctx.lineTo(x + rad * 3, y);
      ctx.moveTo(x, y - rad * 3);
      ctx.lineTo(x, y + rad * 3);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function bevel(ctx, W, Hh, r, color = SPACE.line) {
  const cx = W / 2;
  const cy = Hh / 2;
  const unit = W / 28;
  hexPath(ctx, cx, cy, r - unit * 0.35);
  ctx.lineWidth = unit * 0.7;
  ctx.strokeStyle = color;
  ctx.stroke();
  // Soft top-left highlight.
  ctx.save();
  hexPath(ctx, cx, cy, r - unit * 0.9);
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, 'rgba(160, 190, 255, 0.18)');
  g.addColorStop(0.5, 'rgba(160, 190, 255, 0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = unit * 0.5;
  ctx.stroke();
  ctx.restore();
}

function nebulaClouds(ctx, W, Hh, r, seed, frame, colors) {
  const cx = W / 2;
  const cy = Hh / 2;
  ctx.save();
  hexPath(ctx, cx, cy, r);
  ctx.clip();
  const rnd = rng(seed * 31 + 7);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2 + frame * 0.12 * (i % 2 ? 1 : -1);
    const d = rnd() * r * 0.55;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const rad = r * (0.35 + rnd() * 0.45);
    const col = colors[i % colors.length];
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, rgba(col, 0.55 + 0.1 * Math.sin(frame * 0.8 + i)));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, Hh);
  }
  ctx.restore();
}

function asteroids(ctx, W, Hh, r, seed) {
  const rnd = rng(seed * 97 + 3);
  const cx = W / 2;
  const cy = Hh / 2;
  const rocks = [[-0.35, -0.2, 0.22], [0.25, -0.32, 0.14], [0.05, 0.25, 0.27], [0.4, 0.2, 0.12], [-0.42, 0.35, 0.1], [-0.05, -0.45, 0.08]];
  for (const [ox, oy, size] of rocks) {
    const x = cx + ox * r * (0.9 + rnd() * 0.2);
    const y = cy + oy * r * (0.9 + rnd() * 0.2);
    const rad = size * r;
    const n = 9;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = rad * (0.72 + rnd() * 0.4);
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.85]);
    }
    poly(ctx, pts);
    const g = ctx.createRadialGradient(x - rad * 0.4, y - rad * 0.45, rad * 0.1, x, y, rad * 1.1);
    g.addColorStop(0, '#d6b48c');
    g.addColorStop(0.5, '#8f6a4a');
    g.addColorStop(1, '#3f2c1f');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(0.6, r * 0.015);
    ctx.strokeStyle = 'rgba(20, 12, 6, 0.7)';
    ctx.stroke();
    // Craters.
    for (let c = 0; c < 2; c++) {
      const cxr = x + (rnd() - 0.5) * rad * 0.8;
      const cyr = y + (rnd() - 0.5) * rad * 0.6;
      ctx.fillStyle = 'rgba(40, 25, 15, 0.45)';
      ctx.beginPath();
      ctx.ellipse(cxr, cyr, rad * 0.18, rad * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function voidRift(ctx, W, Hh, r, seed, frame) {
  const cx = W / 2;
  const cy = Hh / 2;
  hexPath(ctx, cx, cy, r);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, '#000000');
  g.addColorStop(0.7, '#05030c');
  g.addColorStop(1, '#120a26');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  hexPath(ctx, cx, cy, r);
  ctx.clip();
  const rnd = rng(seed * 53 + 1);
  // Glowing cracks.
  for (let k = 0; k < 2; k++) {
    let x = cx + (rnd() - 0.5) * r;
    let y = cy - r * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i < 7; i++) {
      x += (rnd() - 0.5) * r * 0.45;
      y += r * 0.26;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba('#9b5cff', 0.35 + 0.25 * Math.sin(frame * 0.7 + k * 2));
    ctx.lineWidth = r * 0.05;
    ctx.stroke();
    ctx.strokeStyle = rgba('#e0c8ff', 0.5);
    ctx.lineWidth = r * 0.015;
    ctx.stroke();
  }
  // Faint motes drifting into the dark.
  for (let i = 0; i < 10; i++) {
    const a = rnd() * Math.PI * 2 + frame * 0.05;
    const d = r * (0.2 + rnd() * 0.7);
    ctx.fillStyle = rgba('#c58cff', 0.25 + rnd() * 0.4);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * 0.02, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A hex tile background. kind: empty | feature | asteroid | nebula | void.
 * @param {number} width  device pixels across the tile's flat sides
 */
export function renderTile(width, kind, variant, tint = null, frame = 0) {
  const W = Math.max(8, Math.round(width));
  const Hh = Math.round((W * TILE_BOX.h) / TILE_BOX.w);
  const c = makeCanvas(W, Hh);
  const ctx = c.getContext('2d');
  // Slightly oversized so neighbouring tiles overlap and no seams show.
  const r = (W / Math.sqrt(3)) + 0.6;
  if (kind === 'void') {
    voidRift(ctx, W, Hh, r, variant, frame);
    bevel(ctx, W, Hh, r, '#1b1236');
    return c;
  }
  base(ctx, W, Hh, r, tint, variant + 1, kind === 'feature');
  if (kind === 'nebula') nebulaClouds(ctx, W, Hh, r, variant + 3, frame, ['#7d3fd1', '#c04fbf', '#4f63d6', '#9b5cff']);
  if (kind === 'asteroid') asteroids(ctx, W, Hh, r, variant + 1);
  bevel(ctx, W, Hh, r, tint ? mix(SPACE.line, tint, 0.5) : SPACE.line);
  return c;
}

// ---------------------------------------------------------------- features

function metalGradient(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#f1f4fa');
  g.addColorStop(0.45, '#9aa4ba');
  g.addColorStop(1, '#3a4256');
  return g;
}

/** Ring station with spokes, a glowing hub and chasing lights. */
export function renderStation(size, frame = 0) {
  const S = Math.round(size);
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.33;
  const w = S * 0.1;
  ctx.lineCap = 'round';
  // Docking arms reaching past the ring, with modules at their ends.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const ex = cx + Math.cos(a) * S * 0.47;
    const ey = cy + Math.sin(a) * S * 0.47;
    ctx.strokeStyle = '#0b0f1c';
    ctx.lineWidth = S * 0.06;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.strokeStyle = '#7d879d';
    ctx.lineWidth = S * 0.035;
    ctx.stroke();
    ctx.fillStyle = metalGradient(ctx, ex - S * 0.05, ey - S * 0.05, ex + S * 0.05, ey + S * 0.05);
    ctx.beginPath();
    ctx.arc(ex, ey, S * 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = S * 0.012;
    ctx.strokeStyle = '#0b0f1c';
    ctx.stroke();
  }
  // Ring.
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.lineWidth = w + S * 0.03;
  ctx.strokeStyle = '#0b0f1c';
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = metalGradient(ctx, cx - R, cy - R, cx + R, cy + R);
  ctx.stroke();
  // Habitat window bands.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 209, 102, 0.85)' : 'rgba(111, 227, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, S * 0.009, 0, Math.PI * 2);
    ctx.fill();
  }
  // Hub.
  const hub = ctx.createRadialGradient(cx - S * 0.03, cy - S * 0.03, 0, cx, cy, S * 0.13);
  hub.addColorStop(0, '#fff6d6');
  hub.addColorStop(0.4, '#f0b94a');
  hub.addColorStop(1, '#7a4f0a');
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = S * 0.015;
  ctx.strokeStyle = '#0b0f1c';
  ctx.stroke();
  // Chasing running lights.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const on = i === frame % 4;
    const x = cx + Math.cos(a) * R;
    const y = cy + Math.sin(a) * R;
    const g = ctx.createRadialGradient(x, y, 0, x, y, S * (on ? 0.07 : 0.035));
    g.addColorStop(0, on ? '#ffffff' : '#ffd166');
    g.addColorStop(1, 'rgba(255, 209, 102, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, S * (on ? 0.07 : 0.035), 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Jump gate: turning segmented ring around a pulsing energy core. */
export function renderGate(size, frame = 0) {
  const S = Math.round(size);
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.38;
  const pulse = 0.5 + 0.5 * Math.sin(frame * 0.5);
  const field = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  field.addColorStop(0, rgba('#ffffff', 0.9));
  field.addColorStop(0.25, rgba('#8fe6ff', 0.55 + pulse * 0.3));
  field.addColorStop(0.75, rgba('#2a8fb5', 0.25));
  field.addColorStop(1, rgba('#2a8fb5', 0));
  ctx.fillStyle = field;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  const rot = frame * (Math.PI / 32);
  for (let i = 0; i < 8; i++) {
    const a0 = rot + (i / 8) * Math.PI * 2 + 0.08;
    const a1 = rot + ((i + 1) / 8) * Math.PI * 2 - 0.08;
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0, a1);
    ctx.lineWidth = S * 0.12;
    ctx.strokeStyle = '#0b0f1c';
    ctx.stroke();
    ctx.lineWidth = S * 0.09;
    ctx.strokeStyle = metalGradient(ctx, cx - R, cy - R, cx + R, cy + R);
    ctx.stroke();
    // Emitter node at each segment.
    const am = (a0 + a1) / 2;
    ctx.fillStyle = rgba('#8fe6ff', 0.7 + pulse * 0.3);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(am) * R, cy + Math.sin(am) * R, S * 0.022, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Trade beacon: a hub with two solar wings and a blinking lamp. */
export function renderTrade(size, frame = 0) {
  const S = Math.round(size);
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const cx = S / 2;
  const cy = S / 2;
  const panel = (x0) => {
    const w = S * 0.3;
    const h = S * 0.36;
    const x = x0;
    const y = cy - h / 2;
    ctx.fillStyle = '#0d1d4a';
    ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, 'rgba(120, 170, 255, 0.45)');
    g.addColorStop(1, 'rgba(20, 40, 110, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#d8a93a';
    ctx.lineWidth = S * 0.016;
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = S * 0.007;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(x + (w * i) / 3, y);
      ctx.lineTo(x + (w * i) / 3, y + h);
    }
    for (let j = 1; j < 4; j++) {
      ctx.moveTo(x, y + (h * j) / 4);
      ctx.lineTo(x + w, y + (h * j) / 4);
    }
    ctx.stroke();
  };
  ctx.strokeStyle = '#8a92a8';
  ctx.lineWidth = S * 0.03;
  ctx.beginPath();
  ctx.moveTo(S * 0.1, cy);
  ctx.lineTo(S * 0.9, cy);
  ctx.stroke();
  panel(S * 0.05);
  panel(S * 0.65);
  // Hub (octagon with gold bands).
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    pts.push([cx + Math.cos(a) * S * 0.16, cy + Math.sin(a) * S * 0.16]);
  }
  poly(ctx, pts);
  ctx.fillStyle = metalGradient(ctx, cx - S * 0.16, cy - S * 0.16, cx + S * 0.16, cy + S * 0.16);
  ctx.fill();
  ctx.strokeStyle = '#0b0f1c';
  ctx.lineWidth = S * 0.018;
  ctx.stroke();
  ctx.fillStyle = '#e8b84a';
  ctx.fillRect(cx - S * 0.13, cy - S * 0.025, S * 0.26, S * 0.05);
  // Beacon lamp.
  const on = frame % 2 === 0;
  const lx = cx;
  const ly = cy - S * 0.2;
  const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, S * (on ? 0.12 : 0.05));
  g.addColorStop(0, on ? '#ffffff' : '#ffd166');
  g.addColorStop(0.4, 'rgba(255, 209, 102, 0.8)');
  g.addColorStop(1, 'rgba(255, 209, 102, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(lx, ly, S * (on ? 0.12 : 0.05), 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** Hidden tile: a swirling purple anomaly. */
export function renderAnomaly(size, frame = 0) {
  const S = Math.round(size);
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const cx = S / 2;
  const cy = S / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.45);
  g.addColorStop(0, 'rgba(235, 210, 255, 0.95)');
  g.addColorStop(0.3, 'rgba(160, 100, 240, 0.6)');
  g.addColorStop(1, 'rgba(90, 40, 170, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'round';
  for (let arm = 0; arm < 3; arm++) {
    ctx.beginPath();
    for (let t = 0; t <= 1; t += 0.04) {
      const a = arm * ((Math.PI * 2) / 3) + t * 3.6 + frame * 0.35;
      const d = t * S * 0.4;
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba('#e0c8ff', 0.55);
    ctx.lineWidth = S * 0.035;
    ctx.stroke();
  }
  return c;
}

// ---------------------------------------------------------------- icons

/** Card icons, drawn as clean vector symbols. */
export function renderIcon(size, name) {
  const S = Math.round(size);
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const cx = S / 2;
  const cy = S / 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const outline = (w = 0.05) => {
    ctx.lineWidth = S * w;
    ctx.strokeStyle = '#0b0f1c';
    ctx.stroke();
  };
  if (name === 'credit') {
    const g = ctx.createRadialGradient(cx - S * 0.12, cy - S * 0.14, S * 0.05, cx, cy, S * 0.42);
    g.addColorStop(0, '#fff2b8');
    g.addColorStop(0.5, '#f5c24a');
    g.addColorStop(1, '#a8741a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.4, 0, Math.PI * 2);
    ctx.fill();
    outline();
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.3, 0, Math.PI * 2);
    ctx.lineWidth = S * 0.035;
    ctx.strokeStyle = 'rgba(120, 80, 10, 0.6)';
    ctx.stroke();
    ctx.fillStyle = '#7a4f0a';
    ctx.font = `800 ${S * 0.36}px "Inter", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('¢', cx, cy + S * 0.02);
  } else if (name === 'move') {
    for (const dx of [-0.14, 0.1]) {
      ctx.beginPath();
      ctx.moveTo(cx + (dx - 0.12) * S, cy - S * 0.26);
      ctx.lineTo(cx + (dx + 0.14) * S, cy);
      ctx.lineTo(cx + (dx - 0.12) * S, cy + S * 0.26);
      ctx.lineWidth = S * 0.14;
      ctx.strokeStyle = '#0b0f1c';
      ctx.stroke();
      ctx.lineWidth = S * 0.09;
      const g = ctx.createLinearGradient(0, cy - S * 0.3, 0, cy + S * 0.3);
      g.addColorStop(0, '#c8f4ff');
      g.addColorStop(1, '#2aa3d6');
      ctx.strokeStyle = g;
      ctx.stroke();
    }
  } else if (name === 'attack') {
    ctx.strokeStyle = '#ff5d5d';
    ctx.lineWidth = S * 0.07;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of [[0, -0.44, 0, -0.16], [0, 0.16, 0, 0.44], [-0.44, 0, -0.16, 0], [0.16, 0, 0.44, 0]]) {
      ctx.moveTo(cx + x0 * S, cy + y0 * S);
      ctx.lineTo(cx + x1 * S, cy + y1 * S);
    }
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.06, 0, Math.PI * 2);
    ctx.fill();
  } else if (name === 'shield') {
    ctx.beginPath();
    ctx.moveTo(cx, cy - S * 0.42);
    ctx.lineTo(cx + S * 0.34, cy - S * 0.28);
    ctx.quadraticCurveTo(cx + S * 0.32, cy + S * 0.22, cx, cy + S * 0.44);
    ctx.quadraticCurveTo(cx - S * 0.32, cy + S * 0.22, cx - S * 0.34, cy - S * 0.28);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx - S * 0.3, cy - S * 0.4, cx + S * 0.3, cy + S * 0.4);
    g.addColorStop(0, '#c8f4ff');
    g.addColorStop(0.5, '#3b9eff');
    g.addColorStop(1, '#1a4f8c');
    ctx.fillStyle = g;
    ctx.fill();
    outline();
  } else if (name === 'repair') {
    ctx.beginPath();
    const a = 0.12;
    const b = 0.38;
    poly(ctx, [[-a, -b], [a, -b], [a, -a], [b, -a], [b, a], [a, a], [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a]], S, cx, cy);
    const g = ctx.createLinearGradient(0, cy - S * b, 0, cy + S * b);
    g.addColorStop(0, '#9cffc8');
    g.addColorStop(1, '#1f9a55');
    ctx.fillStyle = g;
    ctx.fill();
    outline();
  } else if (name === 'react') {
    poly(ctx, [[0.08, -0.44], [-0.24, 0.06], [-0.02, 0.06], [-0.1, 0.44], [0.24, -0.08], [0.02, -0.08]], S, cx, cy);
    const g = ctx.createLinearGradient(0, cy - S * 0.44, 0, cy + S * 0.44);
    g.addColorStop(0, '#fff2b8');
    g.addColorStop(1, '#f5a524');
    ctx.fillStyle = g;
    ctx.fill();
    outline();
  } else if (name === 'upgrade') {
    ctx.fillStyle = '#c9971f';
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const p = -0.24 + i * 0.16;
        ctx.fillRect(cx + p * S - S * 0.025, cy + side * S * 0.36 - S * 0.06, S * 0.05, S * 0.12);
        ctx.fillRect(cx + side * S * 0.36 - S * 0.06, cy + p * S - S * 0.025, S * 0.12, S * 0.05);
      }
    }
    const g = ctx.createLinearGradient(cx - S * 0.3, cy - S * 0.3, cx + S * 0.3, cy + S * 0.3);
    g.addColorStop(0, '#5a6278');
    g.addColorStop(1, '#1d2232');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(cx - S * 0.3, cy - S * 0.3, S * 0.6, S * 0.6, S * 0.06);
    ctx.fill();
    outline(0.04);
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.16);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.5, '#6fe3ff');
    core.addColorStop(1, '#1a4f8c');
    ctx.fillStyle = core;
    ctx.fillRect(cx - S * 0.14, cy - S * 0.14, S * 0.28, S * 0.28);
  }
  return c;
}

export { lighten, darken };
