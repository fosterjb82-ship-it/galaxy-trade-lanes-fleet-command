// Art facade: one place to ask for any image in the game at a given size.
//
// All artwork is drawn procedurally at the exact device-pixel width it will
// be shown at (see ./art/), so it stays sharp at every zoom level and on
// high-DPI screens. Rendered images are cached by key, size and frame.

import { ArtCache } from './art/core.js';
import { renderPlanet, KEY_LOOKS } from './art/planets.js';
import { renderShip, SHIP_ASPECT, SHIP_DESIGNS } from './art/ships.js';
import {
  renderTile, renderStation, renderGate, renderTrade, renderAnomaly, renderIcon, TILE_BOX,
} from './art/tiles.js';

export const PLAYER_COLORS = [
  { name: 'Crimson', main: '#e5484d', dark: '#8e1f24', light: '#ff9592' },
  { name: 'Azure', main: '#3b9eff', dark: '#1a4f8c', light: '#9ccbff' },
  { name: 'Viridian', main: '#30c26b', dark: '#176b3a', light: '#8fe6b0' },
  { name: 'Amber', main: '#f5a524', dark: '#8a5a0a', light: '#ffd58a' },
  { name: 'Violet', main: '#9b6cff', dark: '#4e2f99', light: '#cdb8ff' },
  { name: 'Teal', main: '#20c5c5', dark: '#0d6a6a', light: '#8cecec' },
];

export const PIRATE_COLOR = { name: 'Pirates', main: '#d23c3c', dark: '#5a1212', light: '#ff8a7a' };

export { TILE_BOX, SHIP_ASPECT };
export const SHIP_TYPES = SHIP_DESIGNS;

/** Size of each kind of art on the board, in board units (a tile is 28 wide). */
export const ART_SIZE = {
  ship: 17,
  home: 27,
  core: 30,
  key: 20,
  station: 17,
  intersection: 17,
  trade: 18,
  hidden: 16,
};

/** One full planet turn in ambient ticks (8 ticks a second → 40 s). */
export const PLANET_FRAMES = 320;

const cache = new ArtCache(700);
const animated = new Map(); // `${key}|${w}` -> { frame, canvas } (planets turn every tick)

function shipColor(owner) {
  return owner === 'pirate' ? PIRATE_COLOR.main : PLAYER_COLORS[Number(owner)].main;
}

function build(kind, parts, w, frame) {
  switch (kind) {
    case 'tile': {
      const [, k, v, tint] = parts;
      return renderTile(w, k, Number(v), tint ? `#${tint}` : null, frame);
    }
    case 'home':
      return renderPlanet(w, 'terran', frame / PLANET_FRAMES, { ring: PLAYER_COLORS[Number(parts[1])].main });
    case 'core':
      return renderPlanet(w, 'gas', frame / PLANET_FRAMES, { ring: '#f2e2b8' });
    case 'key':
      return renderPlanet(w, KEY_LOOKS[Number(parts[1]) % KEY_LOOKS.length], frame / PLANET_FRAMES);
    case 'station':
      return renderStation(w, frame);
    case 'intersection':
      return renderGate(w, frame);
    case 'trade':
      return renderTrade(w, frame);
    case 'hidden':
      return renderAnomaly(w, frame);
    case 'ship': {
      const [, type, owner] = parts;
      return renderShip(w, owner === 'pirate' ? 'pirate' : type, shipColor(owner), frame);
    }
    case 'flash':
      return renderShip(w, parts[1], '#ffffff', 0, { flash: true });
    case 'card':
      return renderIcon(w, parts[1]);
    case 'empty':
      return renderTile(w, 'empty', 0);
    default:
      throw new Error(`Unknown art ${kind}`);
  }
}

/**
 * Get an image for `key` drawn `width` device pixels wide.
 * Keys: tile:<kind>:<variant>[:<tint>], home:<player>, core, key:<look>,
 * station, intersection, trade, hidden, ship:<type>:<owner|pirate>,
 * flash:<type>, card:<icon>. An optional "@<frame>" suffix animates.
 */
export function art(fullKey, width, frameArg) {
  const [key, frameStr] = fullKey.split('@');
  const frame = frameArg ?? (Number(frameStr) || 0);
  const w = Math.max(4, Math.round(width));
  const parts = key.split(':');
  const kind = parts[0];
  if (kind === 'home' || kind === 'core' || kind === 'key') {
    // Planets change every tick: keep only the latest frame per planet and size.
    const id = `${key}|${w}`;
    const hit = animated.get(id);
    if (hit && hit.frame === frame) return hit.canvas;
    const canvas = build(kind, parts, w, frame);
    animated.set(id, { frame, canvas });
    if (animated.size > 60) animated.delete(animated.keys().next().value);
    return canvas;
  }
  return cache.get(`${key}|${w}|${frame}`, () => build(kind, parts, w, frame));
}

/** Older name: an image for a key at a given width. */
export const sprite = (key, width = 64) => art(key, width);

const TERRAIN = new Set(['empty', 'void', 'asteroid', 'nebula']);
const offset = (node) => (node.q * 5 + node.r * 3 + 64) % 16; // de-sync neighbours

/** Art key for a tile's background (with an animation frame where it moves). */
export function tileSpriteKey(node, tick = 0) {
  const variant = (node.q * 7 + node.r * 13 + 100) % 4;
  if (node.type === 'home') return `tile:feature:${variant}:${PLAYER_COLORS[node.homeOf].dark.slice(1)}`;
  if (node.type === 'nebula') return `tile:nebula:${variant}@${Math.floor((tick + offset(node)) / 3) % 16}`;
  if (node.type === 'void') return `tile:void:${variant}@${Math.floor((tick + offset(node)) / 3) % 16}`;
  if (TERRAIN.has(node.type)) return `tile:${node.type}:${variant}`;
  return `tile:feature:${variant}`;
}

/** Art key for the feature on a tile, or null for plain terrain. */
export function featureSpriteKey(node, { revealHidden = false, tick = 0 } = {}) {
  const t = tick + offset(node) * 7;
  if (node.type === 'home') return `home:${node.homeOf}@${t % PLANET_FRAMES}`;
  if (node.core) return `core@${Math.floor(t * 0.7) % PLANET_FRAMES}`;
  if (node.type === 'key') return `key:${(node.q * 3 + node.r * 5 + 40) % 4}@${t % PLANET_FRAMES}`;
  if (node.hidden) return revealHidden ? null : `hidden@${Math.floor(t / 2) % 18}`;
  if (node.type === 'station') return `station@${Math.floor(t / 2) % 4}`;
  if (node.type === 'intersection') return `intersection@${t % 64}`;
  if (node.type === 'trade') return `trade@${Math.floor(t / 4) % 2}`;
  if (TERRAIN.has(node.type)) return null;
  return node.type;
}

/** Board-unit width of a feature key. */
export function featureSize(key) {
  const kind = key.split(/[:@]/)[0];
  return ART_SIZE[kind] ?? 18;
}
