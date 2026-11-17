// Effects player: replays the visual events an action produced (state.fx)
// as a short timeline on the board.
//
// Effects (projectiles, explosions, warp rings, sparkles) are smooth glowing
// vector shapes drawn at native resolution; floating numbers are crisp text. While a ship is mid-flight its sprite is drawn at an interpolated
// position, and ships destroyed by the action linger as "ghosts" until their
// explosion plays.

import { art, PLAYER_COLORS, PIRATE_COLOR, ART_SIZE } from './sprites.js';
import { slotOffset } from './units.js';

const STEP_MS = 150; // per tile of movement
const SHOT_MS = { laser: 170, cannon: 280, missile: 420, ion: 240 };

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class FxPlayer {
  /** @param {import('./board.js').Board} board */
  constructor(board) {
    this.board = board;
    this.items = []; // { start, end, draw(now, t) }
    this.positions = new Map(); // shipId -> fn(now) => {x,y} | null
    this.hiddenUntil = new Map(); // shipId -> time
    this.flashes = new Map(); // shipId -> { from, to }
    this.ghosts = []; // { ship, tile, until, x, y }
    this.endAt = 0;
    this.waiters = [];
    board.busy.push((now) => this.isBusy(now));
    board.decorators.push((b) => this.draw(b));
  }

  isBusy(now = this.board.now) {
    const busy = now < this.endAt;
    if (!busy && this.waiters.length) {
      const w = this.waiters.splice(0);
      queueMicrotask(() => w.forEach((fn) => fn()));
    }
    return busy;
  }

  /** Run `fn` once the current effects have finished (immediately if none). */
  whenIdle(fn) {
    if (!this.isBusy(performance.now())) fn();
    else this.waiters.push(fn);
  }

  // ---------------------------------------------------------- positions

  /** Board position for a ship sprite, or null to use its normal slot. */
  position(shipId, now) {
    const f = this.positions.get(shipId);
    return f ? f(now) : null;
  }

  hidden(shipId, now) {
    return (this.hiddenUntil.get(shipId) ?? 0) > now;
  }

  flashing(shipId, now) {
    const f = this.flashes.get(shipId);
    return Boolean(f && now >= f.from && now < f.to);
  }

  // ---------------------------------------------------------- timeline

  /**
   * @param {object[]} events  state.fx from the action
   * @param {object} prev      state before the action (for positions of ships that died)
   * @param {object} next      state after the action
   */
  play(events, prev, next) {
    if (!this.board.animate || !events?.length) return;
    const now = performance.now();
    let t = Math.max(now, this.endAt) + 40;
    const map = next.map;
    const center = (tile) => ({ x: map.nodes[tile].x, y: map.nodes[tile].y });
    // Where a ship sits: its slot in the next state, else in the previous one.
    const slotPos = (shipId, tile) => {
      for (const st of [next, prev]) {
        const sh = st.ships.find((s) => s.id === shipId);
        if (sh && (tile === undefined || sh.tile === tile)) {
          const [ox, oy] = slotOffset(st, sh);
          return { x: map.nodes[sh.tile].x + ox, y: map.nodes[sh.tile].y + oy };
        }
      }
      const c = center(tile);
      return { x: c.x, y: c.y + 6 };
    };
    const snapshot = (id) => prev.ships.find((s) => s.id === id) ?? next.ships.find((s) => s.id === id);

    // Ships that die in this action linger as ghosts until their explosion.
    for (const e of events) {
      if (e.kind !== 'explode') continue;
      const ship = snapshot(e.ship) ?? { id: e.ship, type: e.type, owner: e.owner, tile: e.tile };
      const pos = slotPos(e.ship, e.tile);
      this.ghosts.push({ ship: { ...ship, tile: e.tile }, x: pos.x, y: pos.y, until: Infinity, id: e.ship });
    }

    for (const e of events) {
      const start = t;
      if (e.kind === 'move') {
        const steps = e.path.length - 1;
        const dur = Math.max(200, steps * STEP_MS);
        const pts = e.path.map((tile) => {
          const c = center(tile);
          return { x: c.x, y: c.y + 4 };
        });
        const endPos = slotPos(e.ship);
        pts[pts.length - 1] = endPos;
        const startPos = slotPos(e.ship, e.path[0]);
        pts[0] = prev.ships.some((s) => s.id === e.ship) ? startPos : pts[0];
        this.positions.set(e.ship, (n) => {
          if (n >= start + dur) return null;
          const k = easeInOut(clamp01((n - start) / dur)) * steps;
          const i = Math.min(steps - 1, Math.floor(k));
          const f = k - i;
          return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f, moving: true, dx: pts[i + 1].x - pts[i].x };
        });
        for (const step of e.nebulas ?? []) {
          const at = start + (dur * step) / steps;
          this.text(at, pts[step], '−1', '#ff9a7a');
          this.flash(e.ship, at);
        }
        // Ghost of a ship that dies on the way follows the same path.
        const g = this.ghosts.find((x) => x.id === e.ship);
        if (g) g.follow = (n) => this.position(e.ship, n);
        t += dur;
      } else if (e.kind === 'shot') {
        const dur = SHOT_MS[e.weapon] ?? 200;
        const from = slotPos(e.shooter, e.from);
        const to = slotPos(e.target, e.to);
        const color = e.shooterOwner === 'pirate' ? PIRATE_COLOR.light : PLAYER_COLORS[e.shooterOwner].light;
        const seed = (start | 0) ^ 0x9e37;
        this.add(start, start + dur, (b, n, k) => this.drawShot(b, e.weapon, from, to, k, color, seed));
        const hit = start + dur;
        this.add(hit, hit + 260, (b, n, k) => this.drawImpact(b, to, k, e.weapon));
        this.flash(e.target, hit);
        if (e.ion) this.text(hit, to, 'ION', '#d6b3ff');
        else this.text(hit, to, e.damage > 0 ? `−${e.damage}` : '0', e.damage > 0 ? '#ff6b5e' : '#aeb8d8');
        this.at(hit, () => this.board.shakeFor(e.weapon === 'cannon' ? 170 : 90, e.weapon === 'cannon' ? 1 : 0.6));
        t = hit + 140;
      } else if (e.kind === 'explode') {
        const g = this.ghosts.find((x) => x.id === e.ship && x.until === Infinity);
        const pos = g ? (g.follow?.(start) ?? { x: g.x, y: g.y }) : slotPos(e.ship, e.tile);
        if (g) g.until = start + 90;
        const seed = (start | 0) ^ 0x51ed;
        this.add(start, start + 700, (b, n, k) => this.drawExplosion(b, pos, k, seed));
        this.at(start, () => this.board.shakeFor(220, 1.5));
        t = start + 380;
      } else if (e.kind === 'deploy') {
        const pos = slotPos(e.ship);
        this.hiddenUntil.set(e.ship, start + 230);
        this.add(start, start + 520, (b, n, k) => this.drawWarp(b, pos, k, PLAYER_COLORS[e.owner].light));
        t = start + 260;
      } else if (e.kind === 'repair') {
        const pos = slotPos(e.ship);
        this.add(start, start + 800, (b, n, k) => this.drawRepair(b, pos, k, start | 0));
        this.text(start, pos, `+${e.amount}`, '#6dffa8');
        t = start + 180;
      } else if (e.kind === 'reveal') {
        const c = center(e.tile);
        if (e.spawned) this.hiddenUntil.set(e.spawned, start + 300);
        this.add(start, start + 700, (b, n, k) => this.drawReveal(b, c, k, start | 0));
        t = start + 320;
      } else if (e.kind === 'income') {
        const c = center(e.tile);
        this.text(start, { x: c.x, y: c.y - 4 }, `+${e.amount} cr`, '#ffd166', 1300);
      }
    }
    this.endAt = Math.max(this.endAt, t + 200, ...this.items.map((i) => i.end));
    this.board.invalidate();
  }

  add(start, end, draw) {
    this.items.push({ start, end, draw });
  }

  at(time, fn) {
    this.items.push({ start: time, end: time + 1, once: fn, draw: () => {} });
  }

  flash(shipId, at) {
    this.flashes.set(shipId, { from: at, to: at + 130 });
  }

  text(at, pos, label, color, dur = 950) {
    this.add(at, at + dur, (b, n, k) => {
      const p = b.toScreen(pos.x, pos.y - 8 - k * 9);
      b.ctx.save();
      b.ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const pop = k < 0.12 ? 1 + (0.12 - k) * 3 : 1; // quick pop in
      b.drawText(label, p.x, p.y, { size: 15 * pop, weight: 800, color });
      b.ctx.restore();
    });
  }

  // ---------------------------------------------------------- drawing

  draw(b) {
    const now = b.now;
    // Ghosts (ships destroyed by this action, before their explosion).
    this.ghosts = this.ghosts.filter((g) => g.until > now);
    for (const g of this.ghosts) {
      const pos = g.follow?.(now) ?? { x: g.x, y: g.y };
      const owner = g.ship.owner === 'pirate' ? 'pirate' : g.ship.owner;
      const type = g.ship.owner === 'pirate' ? 'frigate' : g.ship.type;
      const size = ART_SIZE.ship * 0.9 * b.scale;
      b.blitCentered(art(`ship:${type}:${owner}`, size, b.frame() % 4), pos.x, pos.y, { flip: pos.x > 0 });
      if (this.flashing(g.id, now)) b.blitCentered(art(`flash:${owner === 'pirate' ? 'pirate' : type}`, size), pos.x, pos.y, { flip: pos.x > 0 });
    }
    // Timeline items.
    for (const it of this.items) {
      if (now < it.start) continue;
      if (it.once) {
        it.once();
        it.once = null;
      }
      if (now >= it.end) continue;
      it.draw(b, now, clamp01((now - it.start) / (it.end - it.start)));
    }
    this.items = this.items.filter((it) => now < it.end || it.once);
    for (const [id, f] of this.flashes) if (now >= f.to) this.flashes.delete(id);
    for (const [id, until] of this.hiddenUntil) if (now >= until) this.hiddenUntil.delete(id);
    for (const [id] of this.positions) if (!this.position(id, now)) this.positions.delete(id);
  }

  /** A soft glowing dot at board coordinates; size in board units. */
  px(b, x, y, color, size = 1, alpha = 1) {
    const p = b.toScreen(x + size / 2, y + size / 2);
    const r = Math.max(0.8 * b.dpr, size * 0.55 * b.scale);
    const ctx = b.ctx;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.shadowColor = color;
    ctx.shadowBlur = r * 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** A glowing beam between two board points. */
  line(b, a, c, color, width = 0.7) {
    const p0 = b.toScreen(a.x, a.y);
    const p1 = b.toScreen(c.x, c.y);
    const ctx = b.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = width * b.scale * 3;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.2 * b.dpr, width * b.scale);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(0.6 * b.dpr, width * b.scale * 0.35);
    ctx.stroke();
    ctx.restore();
  }

  /** Radial glow (fireballs, flashes); radius in board units. */
  glow(b, at, radius, inner, outer, alpha = 1) {
    const p = b.toScreen(at.x, at.y);
    const r = Math.max(1, radius * b.scale);
    const ctx = b.ctx;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, inner);
    g.addColorStop(0.4, outer);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawShot(b, weapon, from, to, k, color, seed) {
    // Shots within one tile still need a visible flight: offset the muzzle.
    if (Math.hypot(to.x - from.x, to.y - from.y) < 4) from = { x: from.x - 10, y: from.y - 6 };
    const lerp = (q) => ({ x: from.x + (to.x - from.x) * q, y: from.y + (to.y - from.y) * q });
    if (weapon === 'laser') {
      // Beam that snaps on, flickers and fades.
      if (k > 0.85) return;
      this.line(b, from, to, color, 0.9 * (1 - k * 0.6));
      this.glow(b, from, 3, 'rgba(255,255,255,0.9)', color, 1 - k);
    } else if (weapon === 'cannon') {
      const p = lerp(easeInOut(k));
      for (let i = 1; i <= 3; i++) {
        const q = lerp(Math.max(0, easeInOut(k) - i * 0.06));
        this.px(b, q.x, q.y, i === 1 ? '#ffd166' : '#ff8c42', 1, 1 - i * 0.25);
      }
      this.glow(b, p, 3, 'rgba(255,255,255,1)', 'rgba(255,209,102,0.8)');
    } else if (weapon === 'missile') {
      // Arcing missile with a smoke trail.
      const nx = -(to.y - from.y);
      const ny = to.x - from.x;
      const len = Math.hypot(nx, ny) || 1;
      const bulge = 10;
      const at = (q) => {
        const base = lerp(q);
        const h = Math.sin(q * Math.PI) * bulge;
        return { x: base.x + (nx / len) * h, y: base.y + (ny / len) * h };
      };
      for (let i = 8; i >= 1; i--) {
        const q = Math.max(0, k - i * 0.035);
        const p = at(q);
        this.px(b, p.x, p.y, i < 3 ? '#ffd166' : '#8f9bc2', 1, 1 - i / 9);
      }
      const head = at(k);
      this.px(b, head.x, head.y, '#ffffff');
    } else if (weapon === 'ion') {
      // Jagged lightning, re-rolled each frame.
      const rnd = seeded(seed + Math.floor(k * 12));
      let prev = from;
      const n = 6;
      for (let i = 1; i <= n; i++) {
        const base = lerp(i / n);
        const j = i === n ? 0 : (rnd() - 0.5) * 8;
        const next = { x: base.x + j, y: base.y + (rnd() - 0.5) * 6 };
        this.line(b, prev, next, rnd() < 0.3 ? '#f3e6ff' : '#b07cff', 0.55);
        prev = next;
      }
    }
  }

  drawImpact(b, at, k, weapon) {
    this.glow(b, at, (weapon === 'cannon' ? 6 : 4) * (0.6 + k), weapon === 'ion' ? 'rgba(240,220,255,0.9)' : 'rgba(255,255,255,0.95)', weapon === 'ion' ? 'rgba(155,92,230,0.6)' : 'rgba(255,170,80,0.6)', 1 - k);
    const r = 2 + k * (weapon === 'cannon' ? 7 : 5);
    const color = weapon === 'ion' ? '#c58cff' : k < 0.4 ? '#ffffff' : '#ffd166';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.px(b, at.x + Math.cos(a) * r, at.y + Math.sin(a) * r, color, 1, 1 - k);
    }
  }

  drawExplosion(b, at, k, seed) {
    const rnd = seeded(seed);
    // Core flash.
    // Fireball: white core blooming into orange, then smoke.
    this.glow(b, at, 4 + k * 14, 'rgba(255,255,240,1)', 'rgba(255,140,50,0.75)', 1 - k * 1.3);
    if (k > 0.3) this.glow(b, { x: at.x, y: at.y - k * 4 }, 8 + k * 10, 'rgba(90,90,110,0.35)', 'rgba(40,40,55,0.2)', 1 - k);
    // Debris.
    const colors = ['#ffffff', '#ffd166', '#ff8c42', '#e5484d', '#5a6278'];
    for (let i = 0; i < 22; i++) {
      const a = rnd() * Math.PI * 2;
      const speed = 6 + rnd() * 14;
      const life = 0.55 + rnd() * 0.45;
      const q = k / life;
      if (q >= 1) continue;
      const d = speed * (1 - (1 - q) ** 2);
      const col = colors[Math.min(colors.length - 1, Math.floor(q * colors.length))];
      this.px(b, at.x + Math.cos(a) * d, at.y + Math.sin(a) * d + q * q * 3, col, q < 0.35 ? 2 : 1);
    }
  }

  drawWarp(b, at, k, color) {
    // Two rings closing in on the arrival point, then a flash.
    const ctx = b.ctx;
    const p = b.toScreen(at.x, at.y);
    for (const [delay, c] of [[0, color], [0.15, '#ffffff']]) {
      const q = Math.max(0, Math.min(1, (k - delay) / 0.6));
      if (q <= 0 || q >= 1) continue;
      ctx.save();
      ctx.globalAlpha = 1 - q * 0.5;
      ctx.strokeStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = 10 * b.dpr;
      ctx.lineWidth = Math.max(1.5 * b.dpr, 0.6 * b.scale);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (14 * (1 - q)) * b.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (k > 0.5 && k < 0.85) this.glow(b, at, 7, 'rgba(255,255,255,1)', 'rgba(140,220,255,0.6)', 1 - (k - 0.5) * 3);
  }

  drawRepair(b, at, k, seed) {
    const rnd = seeded(seed);
    for (let i = 0; i < 5; i++) {
      const ox = (rnd() - 0.5) * 16;
      const delay = rnd() * 0.4;
      const q = clamp01((k - delay) / 0.6);
      if (q <= 0 || q >= 1) continue;
      const x = at.x + ox;
      const y = at.y + 2 - q * 14;
      const col = q < 0.5 ? '#6dffa8' : '#3ddc84';
      this.px(b, x, y - 1, col, 1, 1 - q);
      this.px(b, x - 1, y, col, 1, 1 - q);
      this.px(b, x, y, col, 1, 1 - q);
      this.px(b, x + 1, y, col, 1, 1 - q);
      this.px(b, x, y + 1, col, 1, 1 - q);
    }
  }

  drawReveal(b, at, k, seed) {
    const rnd = seeded(seed);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 3 + k * (8 + rnd() * 8);
      const col = rnd() < 0.4 ? '#ffffff' : '#c58cff';
      this.px(b, at.x + Math.cos(a) * d, at.y + Math.sin(a) * d - k * 4, col, 1, 1 - k);
    }
  }
}
