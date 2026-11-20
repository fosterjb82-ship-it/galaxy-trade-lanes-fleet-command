// Battle close-up: a short side-on scene replaying one combat exchange.
//
// The attacker sits on the left, the target on the right. Each shot flies
// across (laser beam, cannon slug, missile, ion arc), shields shimmer when
// they soak damage, hull bars drain, and destroyed ships explode. A reaction
// card flips in before the shots when the defender played one.
//
// The scene is built from what the action produced (state.fx and
// state.lastCombat), so it always shows exactly what the rules resolved.

import { art, PLAYER_COLORS, PIRATE_COLOR, SHIP_ASPECT, CARD_ART_ASPECT } from '../render/sprites.js';
import { SHIPS, PIRATE, shipSprite } from '../game/ships.js';
import { CARDS } from '../game/cards.js';
import { sound } from '../audio/sound.js';
import { h } from './dom.js';

const SHOT_MS = { laser: 520, cannon: 620, missile: 820, ion: 600 };
const ENTER_MS = 520;
const CARD_MS = 1100;
const END_HOLD_MS = 650;

const colorOf = (owner) => (owner === 'pirate' ? PIRATE_COLOR : PLAYER_COLORS[owner]);
const ease = (t) => 1 - (1 - t) ** 3;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

/**
 * Work out what happened in a combat action.
 * @returns battle description, or null if there is nothing to show
 */
export function buildBattle(prev, next, result, events) {
  if (!result) return null;
  const snap = (id) => prev.ships.find((s) => s.id === id) ?? next.ships.find((s) => s.id === id);
  const a = snap(result.attacker);
  const t = snap(result.target);
  if (!a || !t) return null;
  const side = (id) => (id === a.id ? 'L' : 'R');
  const shots = events.filter((e) => e.kind === 'shot' && (e.shooter === a.id || e.shooter === t.id))
    .map((e) => ({ from: side(e.shooter), weapon: e.weapon, damage: e.damage, ion: e.ion, blocked: (e.shields ?? 0) + (e.armor ?? 0) + (e.evasive ?? 0), evasive: e.evasive ?? 0, raw: e.raw ?? e.damage }));
  const exploded = new Set(events.filter((e) => e.kind === 'explode').map((e) => e.ship));
  const retreat = result.reactionDef === 'retreat' || events.some((e) => e.kind === 'move' && e.ship === t.id && !shots.length);
  const pointDefense = result.events.some((e) => e.startsWith('Point defense'));
  const weapon = (s) => (s.owner === 'pirate' ? PIRATE.weapon : SHIPS[s.type].weapon)?.type ?? 'laser';
  const fighter = (s, sideKey) => ({
    side: sideKey,
    owner: s.owner,
    sprite: shipSprite(s),
    name: s.owner === 'pirate' ? 'Pirate fleet' : SHIPS[s.type].name,
    who: s.owner === 'pirate' ? 'Pirates' : next.players[s.owner].name,
    hull: s.hull,
    max: s.owner === 'pirate' ? PIRATE.hull : SHIPS[s.type].hull,
    destroyed: exploded.has(s.id),
  });
  return {
    left: fighter(a, 'L'),
    right: fighter(t, 'R'),
    reaction: result.reactionDef ? { def: result.reactionDef, owner: result.ambush ? a.owner : t.owner, name: CARDS[result.reactionDef]?.name ?? result.reaction } : null,
    ambush: Boolean(result.ambush),
    shots,
    retreat,
    pointDefense: pointDefense ? weapon(a) : null,
    destroyed: exploded.has(a.id) || exploded.has(t.id),
    lines: result.events,
  };
}

/**
 * Show the close-up in `host` (an overlay). Calls onDone when the player
 * continues. Returns { skip }.
 */
export function playBattle(host, battle, { onDone, animate = true }) {
  const canvas = h('canvas.battle-canvas');
  const caption = h('div.battle-caption');
  const lines = h('ul.combat-log.battle-lines', battle.lines.map((e) => h('li', e)));
  const cont = h('button.primary.big', { onclick: () => finish() }, 'Continue');
  const skipBtn = h('button.big', { onclick: () => skip() }, 'Skip');
  const L = battle.left;
  const R = battle.right;
  const title = battle.ambush
    ? `${L.who}'s ${L.name.toLowerCase()} ambushes ${R.who}'s ${R.name.toLowerCase()}`
    : `${L.who}'s ${L.name.toLowerCase()} attacks ${R.who === 'Pirates' ? 'a pirate fleet' : `${R.who}'s ${R.name.toLowerCase()}`}`;
  host.replaceChildren(
    h('div.battle',
      h('div.kicker', battle.destroyed ? 'Battle · ship destroyed' : 'Battle'),
      h('h2', title),
      h('div.battle-stage', canvas, caption),
      lines,
      h('div.dialog-actions', skipBtn, cont)),
  );
  lines.classList.add('hidden');
  cont.classList.add('hidden');

  // ---------------------------------------------------------- timeline
  // Each step: { at, dur, kind, ... }. Hull values change at impact time.
  const steps = [];
  let t = ENTER_MS;
  if (battle.reaction) {
    steps.push({ at: t, dur: CARD_MS, kind: 'card' });
    t += CARD_MS;
  }
  const hull = { L: L.hull, R: R.hull };
  if (battle.pointDefense) {
    steps.push({ at: t, dur: SHOT_MS.missile, kind: 'intercept', from: 'L' });
    t += SHOT_MS.missile + 250;
  }
  if (battle.retreat) {
    steps.push({ at: t, dur: 700, kind: 'retreat' });
    t += 800;
  }
  for (const s of battle.shots) {
    const dur = SHOT_MS[s.weapon] ?? 520;
    const to = s.from === 'L' ? 'R' : 'L';
    const before = hull[to];
    hull[to] = Math.max(0, before - s.damage);
    steps.push({ at: t, dur, kind: 'shot', shot: s, to, before, after: hull[to] });
    t += dur + 380;
    if (hull[to] === 0 && (to === 'L' ? L.destroyed : R.destroyed)) {
      steps.push({ at: t - 200, dur: 1100, kind: 'explode', side: to });
      t += 900;
    }
  }
  // The last shot at each ship keeps its result on screen at the end.
  for (const sideKey of ['L', 'R']) {
    const last = steps.filter((st) => st.kind === 'shot' && st.to === sideKey).at(-1);
    if (last) last.last = true;
  }
  const total = t + END_HOLD_MS;

  // ---------------------------------------------------------- drawing
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = Math.min(760, Math.max(420, (host.clientWidth || 760) - 48));
  const cssH = Math.round(cssW * 0.4);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const shipW = Math.round(W * 0.27);
  const pos = { L: { x: W * 0.23, y: H * 0.5 }, R: { x: W * 0.77, y: H * 0.5 } };
  const stars = Array.from({ length: 140 }, (_, i) => ({ x: ((i * 7919) % 1000) / 1000, y: ((i * 4339) % 1000) / 1000, r: ((i * 31) % 10) / 10, s: 0.2 + ((i * 17) % 10) / 12 }));

  let start = performance.now();
  let raf = 0;
  let done = false;
  let muted = !animate;
  const fired = new Set();
  const sfx = (name) => { if (!muted) sound.sfx(name); };

  function background(now) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#060a1c');
    g.addColorStop(1, '#0b0820');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const neb = ctx.createRadialGradient(W * 0.5, H * 0.55, 0, W * 0.5, H * 0.55, W * 0.55);
    neb.addColorStop(0, 'rgba(70, 60, 160, 0.28)');
    neb.addColorStop(0.6, 'rgba(30, 40, 110, 0.12)');
    neb.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, W, H);
    for (const s of stars) {
      const x = ((s.x * W - (now * 0.012 * s.s * dpr)) % W + W) % W;
      ctx.globalAlpha = 0.35 + s.r * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, s.y * H, (0.6 + s.r) * dpr, (0.6 + s.r) * dpr);
    }
    ctx.globalAlpha = 1;
  }

  function glow(x, y, r, inner, outer = 'rgba(0,0,0,0)', alpha = 1) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function hullBar(f, value, x, y) {
    const segs = f.max;
    const w = shipW * 0.8;
    const gap = 3 * dpr;
    const sw = (w - gap * (segs - 1)) / segs;
    const c = colorOf(f.owner);
    for (let i = 0; i < segs; i++) {
      const filled = clamp01(value - i);
      const sx = x - w / 2 + i * (sw + gap);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(sx, y, sw, 7 * dpr);
      if (filled > 0) {
        const frac = value / segs;
        ctx.fillStyle = frac > 0.66 ? c.main : frac > 0.33 ? '#ffd166' : '#ff5d5d';
        ctx.fillRect(sx, y, sw * filled, 7 * dpr);
      }
    }
    ctx.font = `700 ${12 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e6ebff';
    ctx.fillText(`${Math.ceil(value)} / ${segs}`, x, y + 22 * dpr);
  }

  function label(f, x, y) {
    const c = colorOf(f.owner);
    ctx.textAlign = 'center';
    ctx.font = `700 ${13 * dpr}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = c.light;
    ctx.fillText(f.who.toUpperCase(), x, y);
    ctx.font = `600 ${12 * dpr}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = '#aeb8d8';
    ctx.fillText(f.name, x, y + 16 * dpr);
  }

  function floatText(text, x, y, k, color, size = 26) {
    ctx.save();
    ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    ctx.font = `800 ${size * dpr * (k < 0.1 ? 1 + (0.1 - k) * 4 : 1)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4 * dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, x, y - k * 30 * dpr);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y - k * 30 * dpr);
    ctx.restore();
  }

  function drawProjectile(s, from, to, k, seed) {
    const c = colorOf(s.from === 'L' ? L.owner : R.owner);
    if (s.weapon === 'laser') {
      // Two quick bolts.
      for (const off of [0, 0.22]) {
        const kk = clamp01((k - off) / 0.7);
        if (kk <= 0 || kk >= 1) continue;
        const x = from.x + (to.x - from.x) * kk;
        const y = from.y + (to.y - from.y) * kk;
        const len = W * 0.07 * (from.x < to.x ? 1 : -1);
        ctx.strokeStyle = c.light;
        ctx.lineWidth = 4 * dpr;
        ctx.lineCap = 'round';
        ctx.shadowColor = c.main;
        ctx.shadowBlur = 14 * dpr;
        ctx.beginPath();
        ctx.moveTo(x - len, y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    } else if (s.weapon === 'cannon') {
      const kk = ease(k);
      const x = from.x + (to.x - from.x) * kk;
      const y = from.y + (to.y - from.y) * kk;
      glow(x, y, 22 * dpr, 'rgba(255, 220, 140, 1)', 'rgba(255, 120, 30, 0)');
      ctx.strokeStyle = 'rgba(255, 170, 80, 0.5)';
      ctx.lineWidth = 6 * dpr;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (k < 0.2) glow(from.x, from.y, 40 * dpr, 'rgba(255, 230, 170, 0.9)', 'rgba(255, 140, 40, 0)', 1 - k / 0.2);
    } else if (s.weapon === 'missile') {
      for (let m = 0; m < 3; m++) {
        const kk = clamp01((k - m * 0.08) / 0.84);
        if (kk <= 0 || kk >= 1) continue;
        const arc = Math.sin(kk * Math.PI) * H * (0.18 + m * 0.07) * (m % 2 ? 1 : -1);
        const x = from.x + (to.x - from.x) * kk;
        const y = from.y + (to.y - from.y) * kk + arc;
        for (let tr = 1; tr <= 6; tr++) {
          const tk = Math.max(0, kk - tr * 0.03);
          const tx = from.x + (to.x - from.x) * tk;
          const ty = from.y + (to.y - from.y) * tk + Math.sin(tk * Math.PI) * H * (0.18 + m * 0.07) * (m % 2 ? 1 : -1);
          glow(tx, ty, (6 + tr * 2) * dpr, 'rgba(200, 200, 220, 0.35)', 'rgba(120, 120, 140, 0)', 1 - tr / 7);
        }
        glow(x, y, 9 * dpr, 'rgba(255, 240, 200, 1)', 'rgba(255, 140, 60, 0)');
      }
    } else if (s.weapon === 'ion') {
      ctx.strokeStyle = 'rgba(214, 179, 255, 0.95)';
      ctx.shadowColor = '#b26bff';
      ctx.shadowBlur = 16 * dpr;
      ctx.lineWidth = 3 * dpr;
      const reach = clamp01(k / 0.6);
      ctx.beginPath();
      const steps = 14;
      for (let i = 0; i <= steps * reach; i++) {
        const f = i / steps;
        const jitter = (Math.sin(seed + i * 12.9 + k * 40) * 0.5) * H * 0.08 * Math.sin(f * Math.PI);
        const x = from.x + (to.x - from.x) * f;
        const y = from.y + (to.y - from.y) * f + jitter;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  function shield(p, k, strength) {
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.9;
    ctx.strokeStyle = '#7fd8ff';
    ctx.lineWidth = (3 + strength) * dpr;
    ctx.shadowColor = '#4fc3ff';
    ctx.shadowBlur = 18 * dpr;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, shipW * 0.6, shipW * SHIP_ASPECT * 0.85, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = (1 - k) * 0.18;
    ctx.fillStyle = '#7fd8ff';
    ctx.fill();
    ctx.restore();
  }

  function explosion(p, k, seed) {
    glow(p.x, p.y, shipW * (0.3 + k * 0.6), `rgba(255, 240, 200, ${1 - k})`, 'rgba(255, 90, 20, 0)');
    glow(p.x, p.y, shipW * (0.15 + k * 0.9), `rgba(255, 150, 60, ${0.8 * (1 - k)})`, 'rgba(120, 20, 10, 0)');
    for (let i = 0; i < 18; i++) {
      const a = seed + i * 2.399;
      const d = shipW * (0.1 + k * (0.5 + ((i * 37) % 10) / 15));
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = i % 3 ? '#ffb070' : '#ffffff';
      ctx.fillRect(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 3 * dpr, 3 * dpr);
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    const el = now - start;
    background(now);
    let shake = 0;
    // Hull shown for each side at this moment, and visibility.
    const shown = { L: L.hull, R: R.hull };
    const alpha = { L: 1, R: 1 };
    const offset = { L: 0, R: 0 };
    const flash = { L: false, R: false };
    for (const st of steps) {
      if (el < st.at) continue;
      const k = clamp01((el - st.at) / st.dur);
      if (st.kind === 'shot') {
        const impact = st.at + st.dur * 0.85;
        if (el >= impact) {
          const kk = clamp01((el - impact) / 320);
          shown[st.to] = st.before + (st.after - st.before) * ease(kk);
          if (el < impact + 120) { flash[st.to] = st.shot.damage > 0; shake = st.shot.weapon === 'cannon' ? 8 : 4; }
        } else {
          shown[st.to] = st.before;
        }
      }
      if (st.kind === 'explode') {
        alpha[st.side] = 1 - clamp01((el - st.at) / 250);
        if (el < st.at + 200) shake = 12;
      }
      if (st.kind === 'retreat') {
        offset.R = ease(k) * W * 0.4;
        alpha.R = 1 - k;
      }
    }
    // Ships slide in.
    const enter = ease(clamp01(el / ENTER_MS));
    const sx = (Math.random() - 0.5) * shake * dpr;
    const sy = (Math.random() - 0.5) * shake * dpr;
    ctx.save();
    ctx.translate(sx, sy);
    for (const f of [L, R]) {
      const p = pos[f.side];
      const x = p.x + (1 - enter) * (f.side === 'L' ? -W * 0.35 : W * 0.35) + offset[f.side];
      const bob = Math.sin(now / 420 + (f.side === 'L' ? 0 : 2)) * 3 * dpr;
      const frameNo = Math.floor(now / 125) % 4;
      const img = art(`ship:${f.sprite}:${f.owner === 'pirate' ? 'pirate' : f.owner}`, shipW, frameNo);
      // Engine glow behind the ship.
      glow(x + (f.side === 'L' ? -shipW * 0.45 : shipW * 0.45), p.y + bob, shipW * 0.22, `${colorOf(f.owner).light}88`, 'rgba(0,0,0,0)', alpha[f.side]);
      ctx.save();
      ctx.globalAlpha = alpha[f.side];
      ctx.translate(x, p.y + bob);
      if (f.side === 'R') ctx.scale(-1, 1);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      if (flash[f.side]) {
        const fl = art(`flash:${f.owner === 'pirate' ? 'pirate' : f.sprite}`, shipW);
        ctx.drawImage(fl, -fl.width / 2, -fl.height / 2);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      label(f, x, H * 0.12);
      hullBar(f, shown[f.side], x, H * 0.8);
    }
    ctx.restore();

    // Effects on top.
    for (const st of steps) {
      if (el < st.at || (el > st.at + st.dur + 900 && !(st.last && st.kind === 'shot'))) continue;
      const k = clamp01((el - st.at) / st.dur);
      if (st.kind === 'shot') {
        const s = st.shot;
        const from = { x: pos[s.from].x + (s.from === 'L' ? shipW * 0.4 : -shipW * 0.4), y: pos[s.from].y };
        const to = pos[st.to];
        const key = `${st.at}`;
        if (!fired.has(key)) { fired.add(key); sfx(s.weapon); }
        if (k < 0.85) drawProjectile(s, from, to, k / 0.85, st.at);
        const impact = st.at + st.dur * 0.85;
        if (el >= impact) {
          const kk = st.last ? Math.min(0.6, clamp01((el - impact) / 700)) : clamp01((el - impact) / 700);
          const fx = clamp01((el - impact) / 700); // impact effects fade fully
          if (!fired.has(`${key}hit`)) { fired.add(`${key}hit`); sfx(s.damage > 0 || s.ion ? 'impact' : 'shield'); }
          if (s.blocked > 0 && !s.ion && fx < 1) shield(to, fx, s.blocked);
          if (s.damage > 0 && fx < 1) glow(to.x, to.y, shipW * 0.25 * (1 + fx), `rgba(255, 220, 160, ${1 - fx})`, 'rgba(255,100,40,0)');
          if (st.after === 0 && (st.to === 'L' ? L.destroyed : R.destroyed)) continue; // DESTROYED says it
          const text = s.ion ? 'ION — DISABLED' : s.damage > 0 ? `−${s.damage}` : s.evasive >= s.raw ? 'EVADED' : 'BLOCKED';
          const color = s.ion ? '#d6b3ff' : s.damage > 0 ? '#ff6b5e' : '#9fe0ff';
          floatText(text, to.x, to.y - shipW * 0.28, kk, color, s.damage > 0 ? 30 : 22);
          if (s.blocked > 0 && !s.ion && s.damage > 0) floatText(`${s.blocked} absorbed`, to.x, to.y + shipW * 0.36, kk, '#9fe0ff', 14);
        }
      } else if (st.kind === 'explode') {
        const p = pos[st.side];
        if (!fired.has(`x${st.at}`)) { fired.add(`x${st.at}`); sfx('explode'); }
        explosion(p, k, st.at);
        if (k > 0.2) floatText('DESTROYED', p.x, p.y + 6 * dpr, clamp01((k - 0.2) / 0.8) * 0.6, '#ff8a7a', 30);
      } else if (st.kind === 'card') {
        const r = battle.reaction;
        if (!fired.has(`c${st.at}`)) { fired.add(`c${st.at}`); sfx('card'); }
        const cw = W * 0.2;
        const img = art(`cardart:${r.def}:${r.owner}`, cw);
        const flip = clamp01(k / 0.25);
        const sxs = Math.abs(Math.cos((1 - flip) * Math.PI / 2));
        ctx.save();
        ctx.globalAlpha = k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
        ctx.translate(W / 2, H * 0.44);
        ctx.scale(sxs, 1);
        ctx.fillStyle = '#0d1222';
        ctx.strokeStyle = colorOf(r.owner).main;
        ctx.lineWidth = 3 * dpr;
        const ch = cw * CARD_ART_ASPECT;
        ctx.fillRect(-cw / 2 - 6 * dpr, -ch / 2 - 6 * dpr, cw + 12 * dpr, ch + 34 * dpr);
        ctx.strokeRect(-cw / 2 - 6 * dpr, -ch / 2 - 6 * dpr, cw + 12 * dpr, ch + 34 * dpr);
        ctx.drawImage(img, -img.width / 2, -ch / 2);
        ctx.font = `800 ${13 * dpr}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(r.name.toUpperCase(), 0, ch / 2 + 18 * dpr);
        ctx.restore();
      } else if (st.kind === 'intercept') {
        const from = { x: pos.L.x + shipW * 0.4, y: pos.L.y };
        const mid = { x: W * 0.62, y: pos.R.y };
        if (!fired.has(`i${st.at}`)) { fired.add(`i${st.at}`); sfx('missile'); }
        if (k < 0.7) drawProjectile({ weapon: 'missile', from: 'L' }, from, mid, k / 0.7, st.at);
        else {
          const kk = clamp01((k - 0.7) / 0.3);
          if (!fired.has(`i${st.at}pop`)) { fired.add(`i${st.at}pop`); sfx('shield'); }
          glow(mid.x, mid.y, 30 * dpr * (1 + kk), `rgba(255, 230, 170, ${1 - kk})`, 'rgba(255,120,40,0)');
        }
        if (k > 0.7) floatText('SHOT DOWN', mid.x, mid.y - 30 * dpr, clamp01((k - 0.7) / 0.3) * 0.6, '#9fe0ff', 22);
      } else if (st.kind === 'retreat') {
        if (k > 0.3) floatText('RETREATS', pos.R.x, pos.R.y, clamp01((k - 0.3) / 0.7) * 0.6, '#9fe0ff', 26);
      }
    }

    if (el < total) raf = requestAnimationFrame(frame);
    else end();
  }

  function end() {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    skipBtn.classList.add('hidden');
    cont.classList.remove('hidden');
    lines.classList.remove('hidden');
    caption.textContent = '';
    cont.focus();
  }

  function skip() {
    if (done) return;
    muted = true;
    start = performance.now() - total; // jump to the final frame
    cancelAnimationFrame(raf);
    frame(performance.now());
  }

  function finish() {
    end();
    window.removeEventListener('keydown', onKey, true);
    onDone?.();
  }

  function onKey(e) {
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (done) finish();
      else skip();
    }
  }
  window.addEventListener('keydown', onKey, true);
  canvas.addEventListener('click', () => (done ? null : skip()));

  if (animate) raf = requestAnimationFrame(frame);
  else {
    start = performance.now() - total;
    frame(performance.now());
  }
  return { skip };
}
