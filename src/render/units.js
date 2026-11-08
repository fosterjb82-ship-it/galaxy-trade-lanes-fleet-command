// Board layer for a running game: control outlines, deploy targets and the
// ships on each tile. Ships are pixel-art sprites; hull numbers are crisp text.

import { sprite, PLAYER_COLORS } from './sprites.js';
import { TILE_W, TILE_H } from '../map/hex.js';
import { shipDef, shipSprite } from '../game/ships.js';
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
      board.blit(sprite(`outline:${PLAYER_COLORS[owner].main.slice(1)}:1`), n.x - TILE_W / 2, n.y - TILE_H / 2,
        { alpha: n.type === 'empty' ? 0.6 : 1 });
    }

    // Deploy / placement targets.
    for (const tile of targets ?? []) {
      const n = map.nodes[tile];
      board.blit(sprite('outline:6dffa8:1'), n.x - TILE_W / 2, n.y - TILE_H / 2);
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

    // Ships, grouped by tile.
    const byTile = new Map();
    for (const s of state.ships) {
      if (!byTile.has(s.tile)) byTile.set(s.tile, []);
      byTile.get(s.tile).push(s);
    }
    for (const [tile, ships] of byTile) {
      const n = map.nodes[tile];
      const shown = ships.length > SLOTS.length ? ships.slice(0, SLOTS.length - 1) : ships;
      shown.forEach((ship, i) => {
        if (fx?.hidden(ship.id, now)) return; // still warping in
        let [ox, oy] = ships.length === 1 ? [0, 6] : SLOTS[i];
        const owner = ship.owner === 'pirate' ? 'pirate' : ship.owner;
        // Engine flicker, and a gentle 1-pixel hover out of step between ships.
        const img = sprite(`ship:${shipSprite(ship)}:${owner}@${(tick + idNum(ship.id)) % 2}`);
        let flip = n.x > 0; // face toward the centre of the board
        const moving = fx?.position(ship.id, now);
        if (moving) {
          // In flight: drawn at the effect's position, facing its heading.
          const mx = Math.round(moving.x);
          const my = Math.round(moving.y);
          if (moving.dx) flip = moving.dx < 0;
          board.blitCentered(img, mx, my, { flip });
          if (fx.flashing(ship.id, now)) board.blitCentered(sprite(`flash:${shipSprite(ship)}`), mx, my, { flip });
          return;
        }
        if (Math.floor((tick + idNum(ship.id) * 3) / 8) % 2) oy -= 1;
        board.blitCentered(img, n.x + ox, n.y + oy, { flip });
        if (fx?.flashing(ship.id, now)) board.blitCentered(sprite(`flash:${shipSprite(ship)}`), n.x + ox, n.y + oy, { flip });
        if (ship.id === selectedShip) {
          const p = board.toScreen(n.x + ox, n.y + oy);
          board.ring(p.x, p.y, 8 * S, '#ffffff', 1.5);
        }
        if (ship.disabled !== undefined) {
          const p = board.toScreen(n.x + ox - 5, n.y + oy - 6);
          board.drawBadge('ION', p.x, p.y, { size: 8, bg: '#2a1650', border: '#c58cff', fg: '#e8d6ff' });
        }
        if (cssTile >= 56) {
          const max = shipDef(ship).hull;
          const frac = ship.hull / max;
          const p = board.toScreen(n.x + ox + 5, n.y + oy + 5);
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
    // Target labels (e.g. movement cost) on top.
    for (const [tile, text] of labels ?? []) {
      const n = map.nodes[tile];
      const p = board.toScreen(n.x, n.y - 11);
      board.drawBadge(text, p.x, p.y, { bg: '#10331f', border: '#6dffa8', fg: '#d9ffe8', size: cssTile >= 80 ? 11 : 9 });
    }
  };
}
