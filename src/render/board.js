// Canvas hex-board renderer.
//
// Board coordinates are "board units": a tile is 28 wide and 32 tall, and
// `scale` is device pixels per board unit. All art is rendered by ./sprites.js
// at the exact device-pixel size it is drawn at, so tiles, planets and ships
// stay sharp at every zoom step and on high-DPI screens. Text, numbers and
// outlines are drawn as vectors at native resolution.

import { art, tileSpriteKey, featureSpriteKey, featureSize, ART_SIZE, PLAYER_COLORS } from './sprites.js';
import { hexPath } from './art/core.js';
import { TILE_W, TILE_H, fromPixel, key } from '../map/hex.js';
import { Rng } from '../rng.js';

const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif';
const MIN_SCALE = 0.8;
const MAX_SCALE = 18;
const ZOOM_STEP = 1.2;
const TICK_MS = 125; // ambient animation steps 8 times a second

/** Animations are on unless the viewer asked for reduced motion (or turned them off). */
export function animationsEnabled() {
  try {
    const saved = localStorage.getItem('fleetcommand.animations');
    if (saved !== null) return saved === 'on';
  } catch { /* storage unavailable */ }
  return !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export function setAnimationsEnabled(on) {
  try { localStorage.setItem('fleetcommand.animations', on ? 'on' : 'off'); } catch { /* ignore */ }
}

export class Board {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = null;
    this.options = { revealHidden: false, showLabels: true };
    this.hover = null; // tile id
    this.selected = null; // tile id
    this.decorators = []; // fn(board) drawing extra layers on top
    this.listeners = { hover: [], click: [], zoom: [] };
    this.scale = 3; // device pixels per art pixel
    this.center = { x: 0, y: 0 }; // board point shown at the canvas centre
    this.dirty = true;
    this.stars = [];
    this.index = new Map();
    this.animate = animationsEnabled();
    this.tick = 0; // ambient frame counter
    this.now = performance.now();
    this.busy = []; // fn(now) -> true while an effect needs full-rate frames
    this.shake = { until: 0, power: 0 };

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.bindInput();
    const loop = (now) => {
      this.now = now;
      if (this.animate) {
        const tick = Math.floor(now / TICK_MS);
        if (tick !== this.tick) {
          this.tick = tick;
          this.dirty = true;
        }
        if (this.busy.some((fn) => fn(now)) || now < this.shake.until) this.dirty = true;
      }
      if (this.dirty) {
        this.dirty = false;
        this.draw();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  on(event, fn) {
    this.listeners[event].push(fn);
  }

  emit(event, ...args) {
    for (const fn of this.listeners[event]) fn(...args);
  }

  setMap(map, { keepView = false } = {}) {
    this.map = map;
    this.index = new Map(map.nodes.map((n) => [key(n.q, n.r), n.id]));
    this.hover = null;
    if (!keepView) {
      this.selected = null;
      this.fit();
    }
    const rng = new Rng(`stars|${map.seed}`);
    this.stars = Array.from({ length: 320 }, () => ({
      x: rng.next(),
      y: rng.next(),
      size: rng.chance(0.12) ? 2 : 1,
      tone: rng.pick(['#2a3356', '#3a4466', '#56628c', '#8b97c2']),
      twinkle: rng.chance(0.18) ? rng.int(1, 22) : 0,
    }));
    this.invalidate();
  }

  setOptions(opts) {
    Object.assign(this.options, opts);
    this.invalidate();
  }

  select(id) {
    this.selected = id;
    this.invalidate();
  }

  invalidate() {
    this.dirty = true;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    if (this.map && !this.userView) this.fit();
    this.invalidate();
  }

  // ------------------------------------------------------------ view

  /** Scale at which the whole board fits the canvas. */
  fitScale() {
    if (!this.map) return 3;
    const b = this.map.bounds;
    const w = b.maxX - b.minX + TILE_W * 0.6;
    const h = b.maxY - b.minY + TILE_H * 0.6;
    return Math.max(MIN_SCALE, Math.min(this.canvas.width / w, this.canvas.height / h) * 0.97);
  }

  fit() {
    if (!this.map) return;
    const b = this.map.bounds;
    this.scale = this.fitScale();
    this.center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    this.userView = false; // keep refitting on resize until the user zooms or pans
    this.emit('zoom', this.scale);
    this.invalidate();
  }

  /** Board origin on screen, snapped to whole device pixels. */
  origin() {
    let sx = 0;
    let sy = 0;
    if (this.animate && this.now < this.shake.until) {
      const p = this.shake.power * this.scale * 0.8;
      sx = Math.round((Math.random() * 2 - 1) * p);
      sy = Math.round((Math.random() * 2 - 1) * p);
    }
    return {
      x: Math.round(this.canvas.width / 2 - this.center.x * this.scale) + sx,
      y: Math.round(this.canvas.height / 2 - this.center.y * this.scale) + sy,
    };
  }

  /** Brief screen shake, `power` in board units. */
  shakeFor(ms, power = 1) {
    if (!this.animate) return;
    this.shake = { until: this.now + ms, power };
    this.invalidate();
  }

  /** Ambient frame counter (0 when animations are off). */
  frame() {
    return this.animate ? this.tick : 0;
  }

  setAnimate(on) {
    this.animate = on;
    this.invalidate();
  }

  toScreen(x, y) {
    const o = this.origin();
    return { x: o.x + x * this.scale, y: o.y + y * this.scale };
  }

  toBoard(sx, sy) {
    const o = this.origin();
    return { x: (sx - o.x) / this.scale, y: (sy - o.y) / this.scale };
  }

  /** Zoom one step in (+1) or out (-1), keeping `anchor` fixed. */
  zoomBy(step, anchor = null) {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * ZOOM_STEP ** step));
    if (Math.abs(next - this.scale) < 1e-6) return;
    this.userView = true;
    const a = anchor ?? { x: this.canvas.width / 2, y: this.canvas.height / 2 };
    const before = this.toBoard(a.x, a.y);
    this.scale = next;
    const after = this.toBoard(a.x, a.y);
    this.center.x += before.x - after.x;
    this.center.y += before.y - after.y;
    this.emit('zoom', this.scale);
    this.invalidate();
  }

  /** CSS-pixel size -> device pixels, for text and line widths. */
  px(n) {
    return n * this.dpr;
  }

  // ------------------------------------------------------------ input

  bindInput() {
    const c = this.canvas;
    let drag = null;
    let wheelAccum = 0;
    const devicePos = (e) => {
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) * this.dpr, y: (e.clientY - r.top) * this.dpr };
    };
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      wheelAccum += e.deltaY;
      if (Math.abs(wheelAccum) < 60) return; // trackpads send many small deltas
      this.zoomBy(wheelAccum < 0 ? 1 : -1, devicePos(e));
      wheelAccum = 0;
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      drag = { start: devicePos(e), center: { ...this.center }, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) this.emit('click', this.tileAt(devicePos(e)), e);
      drag = null;
    });
    c.addEventListener('pointermove', (e) => {
      const p = devicePos(e);
      if (drag) {
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        if (Math.hypot(dx, dy) > 5 * this.dpr) drag.moved = true;
        if (drag.moved) {
          this.userView = true;
          this.center = { x: drag.center.x - dx / this.scale, y: drag.center.y - dy / this.scale };
          this.invalidate();
        }
      }
      const id = drag?.moved ? this.hover : this.tileAt(p);
      if (id !== this.hover) {
        this.hover = id;
        c.style.cursor = id === null ? 'grab' : 'pointer';
        this.emit('hover', id, e);
        this.invalidate();
      }
    });
    c.addEventListener('pointerleave', () => {
      if (this.hover !== null) {
        this.hover = null;
        this.emit('hover', null);
        this.invalidate();
      }
    });
  }

  tileAt(p) {
    if (!this.map) return null;
    const b = this.toBoard(p.x, p.y);
    const cell = fromPixel(b.x, b.y);
    return this.index.get(key(cell.q, cell.r)) ?? null;
  }

  // ------------------------------------------------------------ drawing helpers

  /** Draw a device-sized image centred on a board point. */
  blitCentered(img, bx, by, { flip = false, alpha = 1 } = {}) {
    const p = this.toScreen(bx, by);
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = alpha;
    const x = Math.round(p.x - img.width / 2);
    const y = Math.round(p.y - img.height / 2);
    if (flip) {
      ctx.translate(x + img.width, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
    } else {
      ctx.drawImage(img, x, y);
    }
    ctx.restore();
  }

  /** Draw art by key, `units` board units wide, centred on a board point. */
  drawArt(key, bx, by, units, opts) {
    this.blitCentered(art(key, units * this.scale), bx, by, opts);
  }

  /** Vector hex outline around a tile. width in CSS px; inset in board units. */
  strokeHex(n, color, width = 2, { alpha = 1, glow = 0, inset = 0.8, dash = null } = {}) {
    const ctx = this.ctx;
    const c = this.toScreen(n.x, n.y);
    const r = (TILE_W / Math.sqrt(3) - inset) * this.scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    hexPath(ctx, c.x, c.y, r);
    ctx.lineJoin = 'round';
    ctx.lineWidth = this.px(width);
    ctx.strokeStyle = color;
    if (dash) ctx.setLineDash(dash.map((d) => this.px(d)));
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = this.px(glow);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Crisp text at device resolution. size is in CSS pixels. */
  drawText(text, sx, sy, { size = 12, weight = 500, color = '#e6ebff', align = 'center', baseline = 'middle', shadow = true } = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${weight} ${this.px(size)}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    if (shadow) {
      ctx.lineWidth = this.px(3);
      ctx.strokeStyle = 'rgba(5, 7, 15, 0.9)';
      ctx.lineJoin = 'round';
      ctx.strokeText(text, sx, sy);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, sx, sy);
    ctx.restore();
  }

  /** Small rounded badge with a number or short text in it. */
  drawBadge(text, sx, sy, { bg = '#11162a', fg = '#ffffff', border = '#5a6585', size = 11 } = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `700 ${this.px(size)}px ${FONT}`;
    const w = Math.max(ctx.measureText(text).width + this.px(8), this.px(size + 6));
    const h = this.px(size + 6);
    ctx.beginPath();
    ctx.roundRect(sx - w / 2, sy - h / 2, w, h, h / 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = this.px(1.25);
    ctx.strokeStyle = border;
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, sx, sy + this.px(0.5));
    ctx.restore();
  }

  /** Vector ring at native resolution (selection markers). */
  ring(sx, sy, r, color, width = 2) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.lineWidth = this.px(width);
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------ main draw

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#04050c';
    ctx.fillRect(0, 0, W, H);
    if (!this.map) return;
    const S = this.scale;
    const map = this.map;

    // Distant starfield (screen space).
    for (const st of this.stars) {
      const tw = st.twinkle && this.animate ? (this.frame() + st.twinkle) % 23 : 99;
      ctx.fillStyle = tw < 2 ? '#ffffff' : st.tone;
      ctx.beginPath();
      ctx.arc(st.x * W, st.y * H, (st.size * 0.6 + (tw < 2 ? 0.6 : 0)) * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tiles.
    const visible = (n) => {
      const p = this.toScreen(n.x, n.y);
      return p.x > -TILE_W * S && p.x < W + TILE_W * S && p.y > -TILE_H * S && p.y < H + TILE_H * S;
    };
    const shown = map.nodes.filter(visible);
    const tick = this.frame();
    for (const n of shown) this.drawArt(tileSpriteKey(n, tick), n.x, n.y, TILE_W);

    // Home sectors and the galactic core get a coloured rim.
    for (const n of shown) {
      if (n.type === 'home') this.strokeHex(n, PLAYER_COLORS[n.homeOf].main, 2.5, { glow: 8 });
      else if (n.core) this.strokeHex(n, '#e8b84a', 2, { glow: 6, alpha: 0.9 });
    }

    // Features.
    const lift = this.options.showLabels && (TILE_W * S) / this.dpr >= 64 ? 2 : 0;
    for (const n of shown) {
      const k = featureSpriteKey(n, { revealHidden: this.options.revealHidden, tick });
      if (k) this.drawArt(k, n.x, n.y - (n.name ? lift : 0), featureSize(k));
    }

    // Pirates (Map Lab preview; games draw ships in their own layer).
    for (const pirate of map.pirates ?? []) {
      const n = map.nodes[pirate.node];
      if (!visible(n)) continue;
      this.drawArt('ship:pirate:pirate', n.x, n.y + 4, ART_SIZE.ship, { flip: true });
      const p = this.toScreen(n.x + 7, n.y - 4);
      this.drawBadge(String(pirate.hull), p.x, p.y, { bg: '#3a0d0d', border: '#d23c3c', size: S >= 3 ? 11 : 9 });
    }

    // Hover and selection outlines.
    if (this.hover !== null && this.hover !== this.selected) {
      this.strokeHex(map.nodes[this.hover], '#ffffff', 2, { alpha: 0.5 });
    }
    if (this.selected !== null) {
      this.strokeHex(map.nodes[this.selected], '#ffffff', 3, { glow: 10 });
    }

    // Text layer (native resolution).
    const cssTile = (TILE_W * S) / this.dpr; // tile width in CSS px
    for (const n of shown) {
      const c = this.toScreen(n.x, n.y);
      if (n.hidden && !this.options.revealHidden) {
        this.drawText('?', c.x, c.y - this.px(1), { size: Math.min(16, Math.max(10, cssTile / 5)), weight: 800 });
      }
      if (this.options.showLabels && n.name && cssTile >= 64 && (!this.options.labelFilter || this.options.labelFilter(n))) {
        const color = n.type === 'home' ? PLAYER_COLORS[n.homeOf].light : n.type === 'key' ? '#ffe7a8' : '#c3cbe6';
        this.drawText(n.name, c.x, c.y + (TILE_H / 2 - 5) * S, {
          size: Math.min(12, cssTile / 7), weight: n.type === 'home' || n.type === 'key' ? 650 : 500, color,
        });
      }
    }

    for (const fn of this.decorators) fn(this);
  }
}
