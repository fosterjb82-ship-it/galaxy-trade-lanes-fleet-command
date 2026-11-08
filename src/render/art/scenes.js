// Illustrations for cards and missions. Each is a small scene composed from
// the game's own high-res art (ships, planets, stations) plus glowing effects,
// on a background tinted by the card type or mission category.

import { makeCanvas, rgba, rng, lighten } from './core.js';
import { renderShip } from './ships.js';
import { renderPlanet } from './planets.js';
import { renderStation, renderGate, renderTrade, renderIcon } from './tiles.js';

export const CARD_ART_ASPECT = 0.62; // height / width
export const MISSION_ART_ASPECT = 0.5;

const TYPE_BG = {
  ship: ['#173a7a', '#060d24'],
  command: ['#0f4a52', '#04161a'],
  credit: ['#5a420e', '#140c02'],
  upgrade: ['#2c3650', '#0a0e18'],
  reaction: ['#3f2378', '#0e0620'],
  utility: ['#145a38', '#04150c'],
};

const KIND_BG = {
  Combat: ['#6a1c22', '#12050a'],
  Territory: ['#6a5212', '#120d02'],
  Economy: ['#11583a', '#03120a'],
  Wildcard: ['#45247a', '#0d0620'],
};

// ---------------------------------------------------------------- helpers

function backdrop(ctx, W, H, [inner, outer], seed) {
  const g = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const rnd = rng(seed);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rgba('#e6ecff', 0.2 + rnd() * 0.6);
    ctx.beginPath();
    ctx.arc(rnd() * W, rnd() * H, (rnd() < 0.1 ? 1.1 : 0.5) * (W / 200), 0, Math.PI * 2);
    ctx.fill();
  }
}

function put(ctx, img, cx, cy, { flip = false, alpha = 1, rot = 0 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  if (rot) ctx.rotate(rot);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
}

function beam(ctx, x0, y0, x1, y1, color, w) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = w * 4;
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = w * 0.35;
  ctx.stroke();
  ctx.restore();
}

function glow(ctx, x, y, r, inner, outer) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function bubble(ctx, x, y, rx, ry, color) {
  const g = ctx.createRadialGradient(x, y, Math.min(rx, ry) * 0.6, x, y, Math.max(rx, ry));
  g.addColorStop(0, rgba(color, 0.05));
  g.addColorStop(0.85, rgba(color, 0.35));
  g.addColorStop(1, rgba(color, 0.8));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(lighten(color, 0.4), 0.9);
  ctx.lineWidth = Math.max(1, rx * 0.03);
  ctx.stroke();
}

function coin(ctx, x, y, r) {
  put(ctx, renderIcon(r * 2.3, 'credit'), x, y);
}

function arrow(ctx, x0, y0, x1, y1, color, w) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = w * 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - Math.cos(a) * w * 2, y1 - Math.sin(a) * w * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - Math.cos(a - 0.5) * w * 4, y1 - Math.sin(a - 0.5) * w * 4);
  ctx.lineTo(x1 - Math.cos(a + 0.5) * w * 4, y1 - Math.sin(a + 0.5) * w * 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function crosshair(ctx, x, y, r, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 0.3;
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    ctx.moveTo(x + dx * r * 0.45, y + dy * r * 0.45);
    ctx.lineTo(x + dx * r * 1.35, y + dy * r * 1.35);
  }
  ctx.stroke();
  ctx.restore();
}

function lightning(ctx, x0, y0, x1, y1, color, w, seed) {
  const rnd = rng(seed);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = w * 5;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let i = 1; i < 7; i++) {
    const t = i / 7;
    ctx.lineTo(x0 + (x1 - x0) * t + (rnd() - 0.5) * w * 8, y0 + (y1 - y0) * t + (rnd() - 0.5) * w * 8);
  }
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

function link(ctx, x0, y0, x1, y1, color, w, dash = null) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.shadowColor = color;
  ctx.shadowBlur = w * 3;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

const BLUE = '#3b9eff';
const RED = '#e5484d';
const GREEN = '#30c26b';
const ship = (type, w, color = BLUE, frame = 0) => renderShip(w, type, color, frame);

// ---------------------------------------------------------------- card scenes

const CARD_SCENES = {
  credits: (ctx, W, H) => coin(ctx, W / 2, H / 2, H * 0.3),
  'trade-contract': (ctx, W, H) => {
    coin(ctx, W * 0.4, H * 0.55, H * 0.26);
    coin(ctx, W * 0.6, H * 0.45, H * 0.26);
  },
  'smugglers-cache': (ctx, W, H) => {
    // Chest overflowing with coins.
    const x = W * 0.5;
    const y = H * 0.62;
    const w = W * 0.42;
    const h = H * 0.3;
    ctx.fillStyle = '#5a3412';
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = '#c9971f';
    ctx.fillRect(x - w / 2, y - h * 0.12, w, h * 0.12);
    ctx.fillRect(x - w * 0.05, y - h / 2, w * 0.1, h);
    ctx.strokeStyle = '#1a0d04';
    ctx.lineWidth = W * 0.01;
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    for (let i = 0; i < 5; i++) coin(ctx, x - w * 0.36 + i * w * 0.18, y - h * 0.62 - (i % 2) * h * 0.18, H * 0.11);
    glow(ctx, x, y - h * 0.5, W * 0.3, 'rgba(255,220,120,0.5)', 'rgba(255,180,60,0.15)');
  },
  move: (ctx, W, H) => {
    put(ctx, ship('fighter', W * 0.42), W * 0.56, H * 0.5);
    for (let i = 0; i < 4; i++) link(ctx, W * 0.08, H * (0.32 + i * 0.12), W * 0.3, H * (0.32 + i * 0.12), 'rgba(140,220,255,0.6)', H * 0.015);
  },
  'full-burn': (ctx, W, H) => {
    glow(ctx, W * 0.32, H * 0.5, W * 0.3, 'rgba(255,255,255,0.9)', 'rgba(80,180,255,0.6)');
    put(ctx, ship('interceptor', W * 0.5, BLUE, 1), W * 0.6, H * 0.5);
    for (let i = 0; i < 5; i++) link(ctx, W * 0.02, H * (0.24 + i * 0.13), W * 0.28, H * (0.24 + i * 0.13), 'rgba(160,230,255,0.7)', H * 0.015);
  },
  attack: (ctx, W, H) => {
    put(ctx, ship('frigate', W * 0.34), W * 0.22, H * 0.62);
    put(ctx, ship('pirate', W * 0.3, '#d23c3c'), W * 0.78, H * 0.36, { flip: true });
    beam(ctx, W * 0.36, H * 0.58, W * 0.7, H * 0.38, '#ff6b6b', H * 0.03);
    glow(ctx, W * 0.72, H * 0.37, W * 0.12, 'rgba(255,255,255,1)', 'rgba(255,140,60,0.6)');
  },
  'focused-strike': (ctx, W, H) => {
    put(ctx, ship('destroyer', W * 0.4, '#e5484d'), W * 0.66, H * 0.52, { flip: true });
    crosshair(ctx, W * 0.66, H * 0.52, H * 0.26, '#ff5d5d');
    beam(ctx, W * 0.02, H * 0.3, W * 0.62, H * 0.5, '#ffd166', H * 0.04);
  },
  repair: (ctx, W, H) => {
    put(ctx, ship('frigate', W * 0.46), W * 0.5, H * 0.55);
    put(ctx, renderIcon(H * 0.4, 'repair'), W * 0.78, H * 0.3);
  },
  'field-repairs': (ctx, W, H) => {
    put(ctx, ship('destroyer', W * 0.5), W * 0.45, H * 0.58);
    for (const [x, y] of [[0.75, 0.25], [0.86, 0.45], [0.66, 0.15]]) put(ctx, renderIcon(H * 0.22, 'repair'), W * x, H * y);
  },
  'refit-dock': (ctx, W, H) => {
    put(ctx, renderStation(H * 0.8, 1), W * 0.36, H * 0.5);
    put(ctx, renderIcon(H * 0.42, 'upgrade'), W * 0.74, H * 0.5);
    arrow(ctx, W * 0.52, H * 0.5, W * 0.62, H * 0.5, '#ffd166', H * 0.03);
  },
  // Reactions
  'return-fire': (ctx, W, H) => {
    put(ctx, ship('frigate', W * 0.32), W * 0.2, H * 0.55);
    put(ctx, ship('pirate', W * 0.3, '#d23c3c'), W * 0.8, H * 0.45, { flip: true });
    beam(ctx, W * 0.7, H * 0.44, W * 0.34, H * 0.52, '#ff6b6b', H * 0.025);
    beam(ctx, W * 0.34, H * 0.58, W * 0.68, H * 0.5, '#8fe3ff', H * 0.03);
  },
  evasive: (ctx, W, H) => {
    ctx.save();
    ctx.strokeStyle = 'rgba(140,220,255,0.7)';
    ctx.lineWidth = H * 0.025;
    ctx.setLineDash([H * 0.05, H * 0.04]);
    ctx.beginPath();
    ctx.moveTo(W * 0.05, H * 0.75);
    ctx.lineTo(W * 0.2, H * 0.3);
    ctx.lineTo(W * 0.35, H * 0.7);
    ctx.lineTo(W * 0.5, H * 0.35);
    ctx.stroke();
    ctx.restore();
    put(ctx, ship('fighter', W * 0.36), W * 0.68, H * 0.38, { rot: -0.25 });
    beam(ctx, W * 0.95, H * 0.85, W * 0.62, H * 0.62, '#ff6b6b', H * 0.02);
  },
  'point-defense': (ctx, W, H) => {
    put(ctx, ship('frigate', W * 0.4), W * 0.3, H * 0.55);
    for (const [x, y] of [[0.68, 0.3], [0.8, 0.55], [0.66, 0.72]]) {
      link(ctx, W * 0.44, H * 0.5, W * x, H * y, 'rgba(255,209,102,0.85)', H * 0.012, [H * 0.03, H * 0.02]);
      glow(ctx, W * x, H * y, H * 0.12, 'rgba(255,255,255,1)', 'rgba(255,140,60,0.7)');
    }
  },
  'emergency-shields': (ctx, W, H) => {
    put(ctx, ship('frigate', W * 0.44), W * 0.5, H * 0.52);
    bubble(ctx, W * 0.5, H * 0.52, W * 0.3, H * 0.36, '#6fe3ff');
    beam(ctx, W * 0.98, H * 0.15, W * 0.74, H * 0.32, '#ff6b6b', H * 0.025);
    glow(ctx, W * 0.75, H * 0.33, H * 0.12, 'rgba(255,255,255,0.9)', 'rgba(110,220,255,0.6)');
  },
  retreat: (ctx, W, H) => {
    put(ctx, ship('frigate', W * 0.36), W * 0.32, H * 0.5, { flip: true });
    arrow(ctx, W * 0.58, H * 0.5, W * 0.1, H * 0.5, 'rgba(140,220,255,0.8)', H * 0.035);
    beam(ctx, W * 0.98, H * 0.5, W * 0.6, H * 0.5, '#ff6b6b', H * 0.025);
  },
  ambush: (ctx, W, H) => {
    put(ctx, ship('frigate', W * 0.3), W * 0.25, H * 0.65, { alpha: 0.8 });
    // Asteroid cover.
    ctx.fillStyle = '#6b4e36';
    ctx.beginPath();
    ctx.ellipse(W * 0.32, H * 0.42, W * 0.14, H * 0.18, 0.3, 0, Math.PI * 2);
    ctx.fill();
    put(ctx, ship('runner', W * 0.3, '#d23c3c'), W * 0.78, H * 0.45, { flip: true });
    beam(ctx, W * 0.38, H * 0.62, W * 0.7, H * 0.48, '#ff6b6b', H * 0.03);
  },
  // Upgrades
  'laser-battery': (ctx, W, H) => {
    put(ctx, ship('frigate', W * 0.4), W * 0.3, H * 0.5);
    beam(ctx, W * 0.48, H * 0.44, W * 0.98, H * 0.36, '#ff6b6b', H * 0.025);
    beam(ctx, W * 0.48, H * 0.54, W * 0.98, H * 0.6, '#ff6b6b', H * 0.025);
  },
  'heavy-cannon': (ctx, W, H) => {
    put(ctx, ship('destroyer', W * 0.5), W * 0.38, H * 0.55);
    glow(ctx, W * 0.66, H * 0.42, H * 0.25, 'rgba(255,255,230,1)', 'rgba(255,170,60,0.7)');
    glow(ctx, W * 0.9, H * 0.38, H * 0.08, 'rgba(255,255,255,1)', 'rgba(255,200,100,0.6)');
  },
  'missile-rack': (ctx, W, H) => {
    put(ctx, ship('corvette', W * 0.44), W * 0.3, H * 0.55);
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.strokeStyle = 'rgba(200,210,230,0.5)';
      ctx.lineWidth = H * 0.03;
      ctx.beginPath();
      ctx.moveTo(W * 0.52, H * (0.4 + i * 0.1));
      ctx.quadraticCurveTo(W * 0.7, H * (0.15 + i * 0.1), W * (0.88 + i * 0.03), H * (0.25 + i * 0.15));
      ctx.stroke();
      ctx.restore();
      glow(ctx, W * (0.88 + i * 0.03), H * (0.25 + i * 0.15), H * 0.06, 'rgba(255,255,255,1)', 'rgba(255,200,100,0.7)');
    }
  },
  'ion-emitter': (ctx, W, H) => {
    put(ctx, ship('interceptor', W * 0.46), W * 0.32, H * 0.5);
    lightning(ctx, W * 0.55, H * 0.5, W * 0.96, H * 0.42, '#c58cff', H * 0.025, 7);
    lightning(ctx, W * 0.55, H * 0.5, W * 0.94, H * 0.66, '#d6b3ff', H * 0.018, 11);
  },
  'deflector-shields': (ctx, W, H) => {
    put(ctx, ship('frigate', W * 0.44), W * 0.5, H * 0.52);
    bubble(ctx, W * 0.5, H * 0.52, W * 0.3, H * 0.34, '#3b9eff');
  },
  'armor-plating': (ctx, W, H) => {
    put(ctx, ship('destroyer', W * 0.52), W * 0.5, H * 0.55);
    ctx.save();
    ctx.strokeStyle = 'rgba(220,230,255,0.75)';
    ctx.lineWidth = H * 0.012;
    for (let i = 0; i < 6; i++) {
      const x = W * (0.3 + i * 0.07);
      ctx.strokeRect(x, H * 0.43, W * 0.06, H * 0.22);
    }
    ctx.restore();
  },
  'pd-grid': (ctx, W, H) => {
    put(ctx, ship('frigate', W * 0.4), W * 0.4, H * 0.55);
    ctx.save();
    ctx.strokeStyle = 'rgba(111,227,255,0.45)';
    ctx.lineWidth = H * 0.01;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(W * 0.4, H * 0.55, H * (0.2 + Math.abs(i) * 0.06), -1.2, 1.2);
      ctx.stroke();
    }
    ctx.restore();
    glow(ctx, W * 0.82, H * 0.3, H * 0.12, 'rgba(255,255,255,1)', 'rgba(255,140,60,0.7)');
  },
  afterburners: (ctx, W, H) => {
    glow(ctx, W * 0.24, H * 0.5, W * 0.3, 'rgba(255,255,255,0.9)', 'rgba(255,160,60,0.6)');
    put(ctx, ship('fighter', W * 0.46, BLUE, 2), W * 0.58, H * 0.5);
  },
  'cargo-pod': (ctx, W, H) => put(ctx, ship('freighter', W * 0.6, GREEN), W * 0.5, H * 0.52),
  'cloaking-device': (ctx, W, H) => {
    put(ctx, ship('runner', W * 0.5), W * 0.5, H * 0.52, { alpha: 0.28 });
    ctx.save();
    ctx.strokeStyle = 'rgba(160,220,255,0.35)';
    ctx.lineWidth = H * 0.01;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(W * 0.22, H * (0.32 + i * 0.07));
      ctx.bezierCurveTo(W * 0.4, H * (0.28 + i * 0.07), W * 0.6, H * (0.36 + i * 0.07), W * 0.8, H * (0.32 + i * 0.07));
      ctx.stroke();
    }
    ctx.restore();
  },
  'targeting-computer': (ctx, W, H) => {
    put(ctx, ship('destroyer', W * 0.44, RED), W * 0.62, H * 0.52, { flip: true });
    crosshair(ctx, W * 0.6, H * 0.52, H * 0.18, '#6dffa8');
    ctx.save();
    ctx.strokeStyle = 'rgba(109,255,168,0.6)';
    ctx.lineWidth = H * 0.012;
    ctx.strokeRect(W * 0.32, H * 0.2, W * 0.56, H * 0.62);
    ctx.restore();
  },
  'repair-drones': (ctx, W, H) => {
    put(ctx, ship('frigate', W * 0.46), W * 0.45, H * 0.58);
    for (const [x, y] of [[0.22, 0.25], [0.5, 0.18], [0.78, 0.3]]) {
      glow(ctx, W * x, H * y, H * 0.1, 'rgba(255,255,255,1)', 'rgba(110,255,170,0.7)');
      link(ctx, W * x, H * y, W * 0.45, H * 0.52, 'rgba(110,255,170,0.5)', H * 0.008, [H * 0.02, H * 0.02]);
    }
  },
};

function shipCard(type) {
  return (ctx, W, H, color) => {
    glow(ctx, W * 0.5, H * 0.52, W * 0.42, 'rgba(120,180,255,0.25)', 'rgba(60,120,255,0.08)');
    put(ctx, ship(type, W * (type === 'carrier' || type === 'destroyer' ? 0.78 : 0.68), color), W * 0.5, H * 0.52);
  };
}
for (const t of ['fighter', 'freighter', 'frigate', 'destroyer', 'corvette', 'interceptor', 'runner', 'carrier']) CARD_SCENES[`ship-${t}`] = shipCard(t);

/**
 * Card illustration `width` px wide.
 * @param {string} defId  card definition id
 * @param {string} type   card type (for the background tint)
 * @param {string} color  trim colour for ships (the owner's colour)
 */
export function renderCardArt(width, defId, type, color = BLUE) {
  const W = Math.max(16, Math.round(width));
  const H = Math.round(W * CARD_ART_ASPECT);
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  backdrop(ctx, W, H, TYPE_BG[type] ?? TYPE_BG.ship, defId.length * 131);
  (CARD_SCENES[defId] ?? ((x) => x))(ctx, W, H, color);
  return c;
}

// ---------------------------------------------------------------- missions

const MISSION_SCENES = {
  'ace-squadron': (ctx, W, H) => {
    for (const [x, y] of [[0.62, 0.3], [0.45, 0.5], [0.62, 0.7]]) put(ctx, ship('fighter', W * 0.26, RED), W * x, H * y);
    for (const [x, y] of [[0.9, 0.3], [0.92, 0.72]]) glow(ctx, W * x, H * y, H * 0.14, 'rgba(255,255,255,1)', 'rgba(255,140,60,0.7)');
  },
  'big-game-hunter': (ctx, W, H) => {
    put(ctx, ship('carrier', W * 0.5, BLUE), W * 0.55, H * 0.52, { flip: true });
    crosshair(ctx, W * 0.55, H * 0.52, H * 0.32, '#ff5d5d');
  },
  'pirate-purge': (ctx, W, H) => {
    put(ctx, ship('pirate', W * 0.3, '#d23c3c'), W * 0.35, H * 0.5, { flip: true });
    put(ctx, ship('pirate', W * 0.3, '#d23c3c'), W * 0.68, H * 0.45, { flip: true, alpha: 0.85 });
    glow(ctx, W * 0.68, H * 0.45, H * 0.3, 'rgba(255,255,230,1)', 'rgba(255,120,40,0.7)');
  },
  'freighter-raider': (ctx, W, H) => {
    put(ctx, ship('freighter', W * 0.36, GREEN), W * 0.65, H * 0.5, { flip: true });
    put(ctx, ship('interceptor', W * 0.28, RED), W * 0.2, H * 0.4);
    lightning(ctx, W * 0.33, H * 0.4, W * 0.55, H * 0.5, '#c58cff', H * 0.025, 3);
  },
  'unbroken-line': (ctx, W, H) => {
    for (let i = 0; i < 4; i++) put(ctx, ship(i % 2 ? 'frigate' : 'destroyer', W * 0.22), W * (0.18 + i * 0.21), H * 0.52);
    bubble(ctx, W * 0.5, H * 0.52, W * 0.46, H * 0.3, '#3b9eff');
  },
  'galactic-core': (ctx, W, H) => put(ctx, renderPlanet(H * 1.15, 'gas', 0.2, { ring: '#f2e2b8' }), W * 0.5, H * 0.5),
  'twin-worlds': (ctx, W, H) => {
    put(ctx, renderPlanet(H * 0.85, 'jungle', 0.1), W * 0.32, H * 0.5);
    put(ctx, renderPlanet(H * 0.75, 'rust', 0.4), W * 0.7, H * 0.5);
  },
  'crossroads-baron': (ctx, W, H) => {
    for (const [x, y] of [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]) put(ctx, renderGate(H * 0.6, 5), W * x, H * y);
  },
  'station-network': (ctx, W, H) => {
    link(ctx, W * 0.28, H * 0.5, W * 0.72, H * 0.5, 'rgba(255,209,102,0.8)', H * 0.02, [H * 0.05, H * 0.03]);
    put(ctx, renderStation(H * 0.75, 1), W * 0.28, H * 0.5);
    put(ctx, renderStation(H * 0.75, 3), W * 0.72, H * 0.5);
  },
  'deep-strike': (ctx, W, H) => {
    put(ctx, renderPlanet(H * 1.2, 'terran', 0.3, { ring: RED }), W * 0.78, H * 0.55);
    put(ctx, ship('fighter', W * 0.26, BLUE), W * 0.35, H * 0.4, { rot: 0.25 });
    arrow(ctx, W * 0.05, H * 0.15, W * 0.24, H * 0.32, 'rgba(140,220,255,0.7)', H * 0.025);
  },
  'trade-magnate': (ctx, W, H) => {
    const pts = [[0.2, 0.62], [0.5, 0.35], [0.8, 0.62]];
    for (let i = 0; i < 2; i++) link(ctx, W * pts[i][0], H * pts[i][1], W * pts[i + 1][0], H * pts[i + 1][1], 'rgba(255,209,102,0.8)', H * 0.02, [H * 0.04, H * 0.03]);
    for (const [x, y] of pts) put(ctx, renderTrade(H * 0.5, 0), W * x, H * y);
  },
  'long-haul': (ctx, W, H) => {
    link(ctx, W * 0.06, H * 0.75, W * 0.94, H * 0.25, 'rgba(255,209,102,0.7)', H * 0.02, [H * 0.04, H * 0.04]);
    put(ctx, ship('freighter', W * 0.32, GREEN), W * 0.5, H * 0.5, { rot: -0.5 });
  },
  diplomat: (ctx, W, H) => {
    put(ctx, ship('runner', W * 0.3, BLUE), W * 0.22, H * 0.5);
    put(ctx, ship('runner', W * 0.3, '#f5a524'), W * 0.78, H * 0.5, { flip: true });
    link(ctx, W * 0.38, H * 0.5, W * 0.62, H * 0.5, 'rgba(109,255,168,0.9)', H * 0.03);
    glow(ctx, W * 0.5, H * 0.5, H * 0.14, 'rgba(255,255,255,0.9)', 'rgba(109,255,168,0.6)');
  },
  'war-chest': (ctx, W, H) => {
    for (let i = 0; i < 7; i++) coin(ctx, W * (0.25 + (i % 4) * 0.17), H * (0.62 - Math.floor(i / 4) * 0.24), H * 0.16);
  },
  'merchant-fleet': (ctx, W, H) => {
    for (let i = 0; i < 3; i++) put(ctx, ship(i === 1 ? 'runner' : 'freighter', W * 0.3, GREEN), W * (0.22 + i * 0.28), H * (0.4 + (i % 2) * 0.2));
  },
  backstabber: (ctx, W, H) => {
    link(ctx, W * 0.3, H * 0.5, W * 0.45, H * 0.5, 'rgba(109,255,168,0.8)', H * 0.025);
    link(ctx, W * 0.55, H * 0.5, W * 0.7, H * 0.5, 'rgba(109,255,168,0.8)', H * 0.025);
    put(ctx, ship('runner', W * 0.28, '#f5a524'), W * 0.82, H * 0.5);
    put(ctx, ship('frigate', W * 0.28, RED), W * 0.18, H * 0.5);
    beam(ctx, W * 0.3, H * 0.46, W * 0.75, H * 0.48, '#ff6b6b', H * 0.025);
  },
  armada: (ctx, W, H) => {
    const types = ['destroyer', 'frigate', 'carrier', 'corvette', 'fighter', 'interceptor'];
    types.forEach((t, i) => put(ctx, ship(t, W * 0.2, BLUE), W * (0.16 + (i % 3) * 0.33), H * (0.32 + Math.floor(i / 3) * 0.38)));
  },
  'fully-loaded': (ctx, W, H) => {
    put(ctx, ship('destroyer', W * 0.42), W * 0.42, H * 0.52);
    for (const [x, y] of [[0.78, 0.25], [0.86, 0.55], [0.74, 0.8]]) put(ctx, renderIcon(H * 0.26, 'upgrade'), W * x, H * y);
  },
};

export function renderMissionArt(width, id, kind) {
  const W = Math.max(16, Math.round(width));
  const H = Math.round(W * MISSION_ART_ASPECT);
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  backdrop(ctx, W, H, KIND_BG[kind] ?? KIND_BG.Wildcard, id.length * 977);
  (MISSION_SCENES[id] ?? ((x) => x))(ctx, W, H);
  return c;
}
