// Board layer for a running game: control outlines, deploy targets and the
// ships on each tile. Ships are high-res art; hull numbers are crisp text.

import { art, PLAYER_COLORS, ART_SIZE } from './sprites.js';
import { TILE_W, TILE_H } from '../map/hex.js';
import { shipDef, shipSprite } from '../game/ships.js';
import { PIRATE_COLOR } from './sprites.js';
import { controlMap } from '../game/state.js';

// Ship slots on a tile, in art pixels from the tile centre.
const SLOTS = [[-7, -6], [7, -6], [-7, 7], [7, 7]];

/** Where a ship sits on its tile (art-pixel offset from the tile centre). */
export function slotOffset(state, ship) {
  const here = state.ships.filter((s) => s.tile === ship.tile);
  if (here.length === 1) return [0, 6];
  const i = Math.min(here.indexOf(ship), SLOTS.length - 1);
  return SLOTS[Math.max(0, i)];
}

const idNum = (id) => Number(String(id).replace(/\D/g, '')) || 0;

export function unitLayer(getView) {
  return (board) => {
    const view = getView();
    if (!view?.state) return;
    const { state, targets, selectedShip, labels, path, fx } = view;
    const now = board.now;
    const tick = board.frame();
    const map = state.map;
    const S = board.scale;
    const cssTile = (TILE_W * S) / board.dpr;

    // Control outlines (home tiles already carry their owner's colour).
    for (const [tile, owner] of controlMap(state)) {
      const n = map.nodes[tile];
      if (n.type === 'home' && n.homeOf === owner) continue;
      board.strokeHex(n, PLAYER_COLORS[owner].main, n.type === 'empty' ? 1.5 : 2.2, { alpha: n.type === 'empty' ? 0.55 : 0.95, glow: 5, inset: 1.2 });
    }

    // Pirate warning: tiles where pirates are about to warp in pulse red.
    for (const tile of view.warnings ?? []) {
      const n = map.nodes[tile];
      const pulse = board.animate ? 0.55 + 0.45 * Math.sin(now / 260) : 1;
      board.strokeHex(n, '#ff4d4d', 2.4, { alpha: pulse, glow: 10, inset: 1.4 });
      const p = board.toScreen(n.x, n.y - 10);
      board.drawBadge('☠ PIRATES', p.x, p.y, { size: cssTile >= 80 ? 10 : 8, bg: '#3a0d0d', border: '#ff4d4d', fg: '#ffd6d6' });
    }

    // Deploy / placement targets. Tiles with ships you don't control are a hard stop.
    const stops = new Set(view.blockers ?? []);
    for (const tile of targets ?? []) {
      const n = map.nodes[tile];
      if (stops.has(tile)) board.strokeHex(n, '#ffb347', 2.5, { glow: 9, inset: 1.6, dash: [5, 4] });
      else board.strokeHex(n, '#6dffa8', 2.5, { glow: 9, inset: 1.6 });
    }

    // Trade routes: dashed lines in the owner's colour (red-tinted if blockaded).
    for (const r of view.routes ?? []) {
      const ctx = board.ctx;
      ctx.save();
      ctx.strokeStyle = r.blockaded ? 'rgba(255, 93, 93, 0.85)' : PLAYER_COLORS[r.owner].light;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = board.px(2.5);
      ctx.setLineDash([board.px(2), board.px(5)]);
      ctx.lineCap = 'round';
      ctx.beginPath();
      r.path.forEach((t, i) => {
        const p = board.toScreen(map.nodes[t].x, map.nodes[t].y + 9);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.restore();
    }

    // Planned route (vector, native resolution) under the ships.
    if (path && path.length > 1) {
      const ctx = board.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(109, 255, 168, 0.9)';
      ctx.lineWidth = board.px(3);
      ctx.setLineDash([board.px(6), board.px(5)]);
      ctx.lineCap = 'round';
      ctx.beginPath();
      path.forEach((t, i) => {
        const p = board.toScreen(map.nodes[t].x, map.nodes[t].y);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.restore();
    }

    // Ships, grouped by tile. Remember where each is drawn (board units).
    const shipAt = new Map();
    const byTile = new Map();
    for (const s of state.ships) {
      if (!byTile.has(s.tile)) byTile.set(s.tile, []);
      byTile.get(s.tile).push(s);
    }
    for (const [tile, ships] of byTile) {
      const n = map.nodes[tile];
      const shown = ships.length > SLOTS.length ? ships.slice(0, SLOTS.length - 1) : ships;
      const size = (ships.length === 1 ? ART_SIZE.ship : ART_SIZE.ship * 0.82) * S;
      shown.forEach((ship, i) => {
        if (fx?.hidden(ship.id, now)) return; // still warping in
        let [ox, oy] = ships.length === 1 ? [0, 6] : SLOTS[i];
        const owner = ship.owner === 'pirate' ? 'pirate' : ship.owner;
        const kind = ship.owner === 'pirate' ? 'pirate' : shipSprite(ship);
        // Engine flicker, and a gentle hover out of step between ships.
        const img = art(`ship:${shipSprite(ship)}:${owner}`, size, (tick + idNum(ship.id)) % 4);
        const flashImg = () => art(`flash:${kind}`, size);
        let flip = n.x > 0; // face toward the centre of the board
        const moving = fx?.position(ship.id, now);
        if (moving) {
          // In flight: drawn at the effect's position, facing its heading.
          const mx = moving.x;
          const my = moving.y;
          if (moving.dx) flip = moving.dx < 0;
          board.blitCentered(img, mx, my, { flip });
          if (fx.flashing(ship.id, now)) board.blitCentered(flashImg(), mx, my, { flip });
          return;
        }
        if (board.animate) oy += Math.sin(tick / 5 + idNum(ship.id)) * 0.45;
        shipAt.set(ship.id, { x: n.x + ox, y: n.y + oy, ship });
        const max = shipDef(ship).hull;
        if (ship.hull / max <= 0.5 && cssTile >= 30) smoke(board, n.x + ox, n.y + oy, ship, now);
        board.blitCentered(img, n.x + ox, n.y + oy, { flip });
        if (fx?.flashing(ship.id, now)) board.blitCentered(flashImg(), n.x + ox, n.y + oy, { flip });
        if (ship.id === selectedShip) {
          const p = board.toScreen(n.x + ox, n.y + oy);
          board.ring(p.x, p.y, 8 * S, '#ffffff', 1.5);
        }
        if (ship.disabled !== undefined) {
          const p = board.toScreen(n.x + ox - 5, n.y + oy - 6);
          board.drawBadge('ION', p.x, p.y, { size: 8, bg: '#2a1650', border: '#c58cff', fg: '#e8d6ff' });
        }
        if (cssTile >= 34) hullBar(board, n.x + ox, n.y + oy + (ships.length === 1 ? 6.5 : 5.2), ship, max, ships.length === 1 ? 12 : 10);
        if (cssTile >= 110) {
          const frac = ship.hull / max;
          const p = board.toScreen(n.x + ox + 6, n.y + oy + 3);
          board.drawBadge(String(ship.hull), p.x, p.y, {
            size: cssTile >= 110 ? 11 : 9,
            bg: ship.owner === 'pirate' ? '#3a0d0d' : '#0b1020',
            border: ship.owner === 'pirate' ? '#d23c3c' : PLAYER_COLORS[ship.owner].main,
            fg: frac > 0.66 ? '#ffffff' : frac > 0.33 ? '#ffd166' : '#ff7a7a',
          });
        }
      });
      if (ships.length > SLOTS.length) {
        const [ox, oy] = SLOTS[SLOTS.length - 1];
        const p = board.toScreen(n.x + ox, n.y + oy);
        board.drawBadge(`+${ships.length - shown.length}`, p.x, p.y, { size: 10 });
      }
    }
    if (view.attack) drawTargeting(board, view.attack, shipAt, now, cssTile);

    // Target labels (e.g. movement cost) on top.
    for (const [tile, text] of labels ?? []) {
      const n = map.nodes[tile];
      const p = board.toScreen(n.x, n.y - 11);
      board.drawBadge(text, p.x, p.y, { bg: '#10331f', border: '#6dffa8', fg: '#d9ffe8', size: cssTile >= 80 ? 11 : 9 });
    }
  };
}

/** Segmented hull bar under a ship (board units). */
function hullBar(board, bx, by, ship, max, width) {
  const ctx = board.ctx;
  const p = board.toScreen(bx - width / 2, by);
  const w = width * board.scale;
  const hgt = Math.max(board.px(3), 1.1 * board.scale);
  const gap = Math.max(1, board.px(1));
  const seg = (w - gap * (max - 1)) / max;
  const frac = ship.hull / max;
  const color = ship.owner === 'pirate' ? PIRATE_COLOR.main : frac > 0.66 ? PLAYER_COLORS[ship.owner].main : frac > 0.33 ? '#ffd166' : '#ff5d5d';
  ctx.save();
  ctx.fillStyle = 'rgba(5, 8, 20, 0.85)';
  ctx.fillRect(p.x - gap, p.y - gap, w + gap * 2, hgt + gap * 2);
  for (let i = 0; i < max; i++) {
    ctx.fillStyle = i < ship.hull ? color : 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(p.x + i * (seg + gap), p.y, seg, hgt);
  }
  ctx.restore();
}

/** Drifting smoke over a badly damaged ship. */
function smoke(board, bx, by, ship, now) {
  const ctx = board.ctx;
  const seed = idNum(ship.id);
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const k = (((board.animate ? now / 1600 : 0.4) + i / 3 + seed * 0.13) % 1);
    const p = board.toScreen(bx - 3 + i * 2.5 + Math.sin(seed + i) * 1.5, by - 2 - k * 7);
    const r = (1.2 + k * 2.6) * board.scale;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, `rgba(150, 150, 160, ${0.45 * (1 - k)})`);
    g.addColorStop(1, 'rgba(90, 90, 100, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Attack targeting: red reticles on every ship in range with the damage it
 * would take, an aim line to the hovered one, and a kill marker.
 * attack = { shooter, targets: Map<shipId, option>, hover }
 */
function drawTargeting(board, attack, shipAt, now, cssTile) {
  const ctx = board.ctx;
  const S = board.scale;
  const from = shipAt.get(attack.shooter);
  const hov = attack.hover ? shipAt.get(attack.hover) : null;
  if (from && hov) {
    const a = board.toScreen(from.x, from.y);
    const b = board.toScreen(hov.x, hov.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 90, 90, 0.95)';
    ctx.shadowColor = '#ff3b3b';
    ctx.shadowBlur = board.px(8);
    ctx.lineWidth = board.px(2.5);
    ctx.setLineDash([board.px(7), board.px(5)]);
    ctx.lineDashOffset = -now / 30;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
  for (const [id, opt] of attack.targets) {
    const at = shipAt.get(id);
    if (!at) continue;
    const p = board.toScreen(at.x, at.y);
    const hot = id === attack.hover;
    const lethal = !opt.preview.ion && opt.preview.damage >= at.ship.hull;
    const crowded = [...shipAt.values()].filter((o) => o.ship.tile === at.ship.tile).length > 1;
    const r = (crowded ? (hot ? 7.5 : 6.5) : (hot ? 10 : 9)) * S + (board.animate ? Math.sin(now / 180) * 0.5 * S : 0);
    const spin = board.animate ? now / 900 : 0;
    ctx.save();
    ctx.strokeStyle = lethal ? '#ff3b3b' : '#ff7a5c';
    ctx.globalAlpha = hot ? 1 : 0.75;
    ctx.shadowColor = '#ff2a2a';
    ctx.shadowBlur = board.px(hot ? 10 : 5);
    ctx.lineWidth = board.px(hot ? 3 : 2.2);
    for (let i = 0; i < 4; i++) {
      const a0 = spin + i * Math.PI / 2 - 0.42;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, a0, a0 + 0.84);
      ctx.stroke();
      // Inward tick marks.
      const am = a0 + 0.42;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(am) * r, p.y + Math.sin(am) * r);
      ctx.lineTo(p.x + Math.cos(am) * (r - 2.2 * S), p.y + Math.sin(am) * (r - 2.2 * S));
      ctx.stroke();
    }
    ctx.restore();
    // Damage label: always on a lone target; on a crowded tile only while aimed at.
    if (crowded && !hot) continue;
    const text = opt.preview.ion ? 'ION' : lethal ? `☠ −${opt.preview.damage}` : `−${opt.preview.damage}`;
    const q = board.toScreen(at.x, at.y - (crowded ? 7.5 : 9.5));
    board.drawBadge(text, q.x, q.y, {
      size: cssTile >= 80 ? 11 : 9,
      bg: lethal ? '#5a0d0d' : '#2a1010',
      border: lethal ? '#ff3b3b' : '#ff7a5c',
      fg: lethal ? '#ffffff' : '#ffd6cc',
    });
  }
}
