// Canvas board renderer. Images (sprites, stars) are pixel art drawn at whole
// number scale with smoothing off; lanes, rings and all text are drawn at
// native device resolution so they stay sharp on high-DPI screens.

import { sprite, nodeSpriteKey, PLAYER_COLORS } from './sprites.js';
import { Rng } from '../rng.js';

const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif';

export class Board {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = null;
    this.options = { revealHidden: false, showLabels: true };
    this.hover = null; // node id
    this.selected = null; // node id
    this.highlight = new Map(); // node id -> css colour
    this.decorators = []; // fn(board) drawing extra layers on top of nodes
    this.listeners = { hover: [], click: [] };
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.dirty = true;
    this.stars = [];

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.bindInput();
    const loop = () => {
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

  setMap(map) {
    this.map = map;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.hover = null;
    this.selected = null;
    const rng = new Rng(`stars|${map.seed}`);
    this.stars = Array.from({ length: 260 }, () => ({
      x: rng.range(-200, map.width + 200),
      y: rng.range(-200, map.height + 200),
      size: rng.chance(0.12) ? 2 : 1,
      tone: rng.pick(['#3a4466', '#56628c', '#8b97c2', '#c9d2f2']),
    }));
    this.invalidate();
  }

  setOptions(opts) {
    Object.assign(this.options, opts);
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
    this.invalidate();
  }

  // ------------------------------------------------------------ view maths

  /** World units -> device pixels scale, plus offsets. */
  view() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const mw = (this.map?.width ?? 1600) + 160;
    const mh = (this.map?.height ?? 1100) + 140;
    const fit = Math.min(W / mw, H / mh);
    const scale = fit * this.zoom;
    const ox = W / 2 - ((this.map?.width ?? 1600) / 2) * scale + this.pan.x;
    const oy = H / 2 - ((this.map?.height ?? 1100) / 2) * scale + this.pan.y;
    return { scale, ox, oy };
  }

  toScreen(x, y) {
    const v = this.view();
    return { x: v.ox + x * v.scale, y: v.oy + y * v.scale };
  }

  toWorld(sx, sy) {
    const v = this.view();
    return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale };
  }

  /** Device pixels per sprite pixel: always a whole number. */
  pixelScale() {
    return Math.max(1, Math.round(this.view().scale * 2.6));
  }

  /** CSS-pixel size -> device pixels, for text and line widths. */
  px(n) {
    return n * this.dpr;
  }

  // ------------------------------------------------------------ input

  bindInput() {
    const c = this.canvas;
    let drag = null;
    const devicePos = (e) => {
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) * this.dpr, y: (e.clientY - r.top) * this.dpr };
    };
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = devicePos(e);
      const before = this.toWorld(p.x, p.y);
      this.zoom = Math.min(3, Math.max(0.6, this.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const after = this.toScreen(before.x, before.y);
      this.pan.x += p.x - after.x;
      this.pan.y += p.y - after.y;
      this.invalidate();
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      drag = { start: devicePos(e), pan: { ...this.pan }, moved: false };
    });
    window.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved && e.target === c) {
        const id = this.nodeAt(devicePos(e));
        this.emit('click', id, e);
      }
      drag = null;
    });
    c.addEventListener('pointermove', (e) => {
      const p = devicePos(e);
      if (drag) {
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        if (Math.hypot(dx, dy) > 6 * this.dpr) drag.moved = true;
        if (drag.moved) {
          this.pan = { x: drag.pan.x + dx, y: drag.pan.y + dy };
          this.invalidate();
        }
      }
      const id = this.nodeAt(p);
      if (id !== this.hover) {
        this.hover = id;
        c.style.cursor = id === null ? 'default' : 'pointer';
        this.emit('hover', id, e);
        this.invalidate();
      } else if (id !== null) {
        this.emit('hover', id, e);
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

  nodeAt(p) {
    if (!this.map) return null;
    const hitR = 13 * this.pixelScale();
    let best = null;
    for (const n of this.map.nodes) {
      const s = this.toScreen(n.x, n.y);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < hitR && (!best || d < best.d)) best = { id: n.id, d };
    }
    return best ? best.id : null;
  }

  // ------------------------------------------------------------ drawing helpers

  /** Draw a sprite centred at a screen point, snapped to whole pixels. */
  drawSprite(img, sx, sy, { scale = this.pixelScale(), flip = false, alpha = 1 } = {}) {
    const ctx = this.ctx;
    const w = img.width * scale;
    const h = img.height * scale;
    const x = Math.round(sx - w / 2);
    const y = Math.round(sy - h / 2);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = alpha;
    if (flip) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, w, h);
    } else {
      ctx.drawImage(img, x, y, w, h);
    }
    ctx.restore();
    return { w, h };
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
      ctx.strokeStyle = 'rgba(5, 7, 15, 0.85)';
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
    const x = sx - w / 2;
    const y = sy - h / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
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

  ring(sx, sy, r, color, width = 2, dash = null) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.lineWidth = this.px(width);
    ctx.strokeStyle = color;
    if (dash) ctx.setLineDash(dash.map((d) => this.px(d)));
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------ main draw

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, W, H);
    if (!this.map) return;
    const S = this.pixelScale();
    const map = this.map;

    // Starfield (pixel art).
    for (const st of this.stars) {
      const p = this.toScreen(st.x, st.y);
      const size = st.size * Math.max(1, Math.round(S / 2));
      ctx.fillStyle = st.tone;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), size, size);
    }

    // Lanes (vector, native resolution).
    for (const lane of map.lanes) {
      const a = this.toScreen(map.nodes[lane.a].x, map.nodes[lane.a].y);
      const b = this.toScreen(map.nodes[lane.b].x, map.nodes[lane.b].y);
      ctx.save();
      ctx.lineCap = 'round';
      if (lane.hazard === 'nebula') {
        ctx.strokeStyle = 'rgba(155, 92, 230, 0.35)';
        ctx.lineWidth = this.px(9);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.strokeStyle = lane.hazard === 'asteroid' ? '#b8875a' : lane.hazard === 'nebula' ? '#b48cff' : '#3c4a72';
      ctx.lineWidth = this.px(lane.hazard ? 2 : 2.5);
      if (lane.hazard === 'asteroid') ctx.setLineDash([this.px(6), this.px(5)]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
      if (lane.hazard === 'asteroid') {
        // Pixel rocks at the midpoint.
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        ctx.fillStyle = '#8a6a48';
        ctx.fillRect(Math.round(mx - S * 2), Math.round(my - S), S * 2, S * 2);
        ctx.fillStyle = '#b8875a';
        ctx.fillRect(Math.round(mx + S * 0.5), Math.round(my - S * 1.5), S, S);
        ctx.fillRect(Math.round(mx - S), Math.round(my + S), S, S);
      }
    }

    // Node highlights (behind sprites).
    for (const [id, color] of this.highlight) {
      const n = map.nodes[id];
      const p = this.toScreen(n.x, n.y);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13 * S, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    }

    // Nodes.
    for (const n of map.nodes) {
      const p = this.toScreen(n.x, n.y);
      if (n.type === 'home') {
        const pc = PLAYER_COLORS[n.homeOf];
        this.ring(p.x, p.y, 14 * S, pc.main, 2, [5, 4]);
      }
      if (n.core) this.ring(p.x, p.y, 14 * S, '#ffe08a', 1.5, [2, 4]);
      const img = sprite(nodeSpriteKey(n, { revealHidden: this.options.revealHidden }));
      this.drawSprite(img, p.x, p.y, { scale: S });
      if (n.hidden) {
        if (!this.options.revealHidden) this.drawText('?', p.x, p.y, { size: 13, weight: 800, color: '#ffffff' });
        else this.ring(p.x, p.y, 9 * S, 'rgba(197,140,255,0.8)', 1.5, [3, 3]);
      }
      if (this.options.showLabels && (n.type !== 'empty' || n.hidden)) {
        const r = (img.height * S) / 2;
        this.drawText(n.name, p.x, p.y + r + this.px(9), {
          size: 11, weight: n.type === 'home' || n.type === 'key' ? 650 : 500,
          color: n.type === 'home' ? PLAYER_COLORS[n.homeOf].light : n.type === 'key' ? '#ffe7a8' : '#aeb8d8',
        });
      }
      if (n.id === this.selected) this.ring(p.x, p.y, 15 * S, '#ffffff', 2.5);
      else if (n.id === this.hover) this.ring(p.x, p.y, 15 * S, 'rgba(255,255,255,0.6)', 2);
    }

    // Pirates on the map (stage 1 shows starting positions).
    for (const pirate of map.pirates ?? []) {
      if (this.options.hidePiratesFromMap) break;
      const n = map.nodes[pirate.node];
      const p = this.toScreen(n.x, n.y);
      const img = sprite('ship:frigate:pirate');
      const off = 11 * S;
      this.drawSprite(img, p.x + off, p.y - off * 0.7, { scale: S, flip: true });
      this.drawBadge(String(pirate.hull), p.x + off + 7 * S, p.y - off * 0.7 - 6 * S, { bg: '#3a0d0d', border: '#d23c3c' });
    }

    for (const fn of this.decorators) fn(this);
  }
}
