// Tile details pane content, shared by the Map Lab and the game screen.

import { enterCost } from '../map/generator.js';
import { neighbors, key } from '../map/hex.js';
import { PLAYER_COLORS, tileSpriteKey, featureSpriteKey, featureSize, art, TILE_BOX } from '../render/sprites.js';
import { h, spriteIcon } from './dom.js';

export const TYPE_LABEL = {
  home: 'Home sector',
  key: 'Key planet',
  intersection: 'Lane intersection',
  station: 'Space station',
  trade: 'Trade node',
  empty: 'Open space',
  asteroid: 'Asteroid field',
  nebula: 'Nebula',
  void: 'Void rift',
};

export const TYPE_EFFECT = {
  home: 'Starting point. Deploy ships here.',
  key: 'Worth 2 VP to its controller at the end of every round.',
  intersection: 'A choke point many routes pass through. Controlling it can pay a toll of +1 credit per turn.',
  station: 'Deploy ships here. Ships cost 1 less while you control a station. Ships starting a turn here fully repair.',
  trade: 'Endpoint for trade routes between players.',
  empty: 'Plain space. Nothing here.',
  asteroid: 'Rocky and slow: entering costs 2 movement.',
  nebula: 'Ionised gas: a ship entering takes 1 damage.',
  void: 'Impassable. Ships cannot enter.',
};

export const CP_VALUE = { home: 6, key: 2, station: 2 };
const VP_VALUE = { key: '2 per round' };
const HIDDEN_LABEL = {
  derelict: 'Derelict: salvage credits',
  pirateNest: 'Pirate nest: spawns a pirate fleet',
  bonus: 'Bonus cache: draw extra cards',
};

export function tileTitle(node) {
  return node.name ?? TYPE_LABEL[node.type];
}

/** A DOM canvas showing a whole tile (background + feature) in high resolution. */
export function tilePreview(node, reveal, cssWidth = 84) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(cssWidth * dpr);
  const unit = W / TILE_BOX.w;
  const bg = art(tileSpriteKey(node), W);
  const c = document.createElement('canvas');
  c.className = 'art';
  c.width = bg.width;
  c.height = bg.height;
  c.style.width = `${bg.width / dpr}px`;
  c.style.height = `${bg.height / dpr}px`;
  const ctx = c.getContext('2d');
  ctx.drawImage(bg, 0, 0);
  const fk = featureSpriteKey(node, { revealHidden: reveal });
  if (fk) {
    const f = art(fk, featureSize(fk) * unit);
    ctx.drawImage(f, (bg.width - f.width) / 2, (bg.height - f.height) / 2);
  }
  return c;
}

export const row = (label, value) => h('div.row', h('span', label), h('b', value));

/**
 * Build the details pane children for a tile.
 * @param {object} o
 * @param {object} o.map
 * @param {number} o.id                 tile id
 * @param {number[][]} o.costs          all-pairs movement cost
 * @param {boolean} o.reveal            show hidden contents
 * @param {(id:number)=>void} o.onNavigate
 * @param {()=>void} o.onClose
 * @param {string} [o.controlledBy]     text for the "Controlled by" row
 * @param {Node[]} [o.sections]         extra sections inserted after the tile rows
 * @param {object[]} [o.pirates]        pirate fleets on this tile ({hull,maxHull,weapon})
 * @param {string[]} [o.playerNames]
 */
export function tileDetails(o) {
  const { map, id, costs, reveal } = o;
  const node = map.nodes[id];
  const homes = map.nodes.filter((n) => n.type === 'home').sort((a, b) => a.homeOf - b.homeOf);
  const at = new Map(map.nodes.map((n) => [key(n.q, n.r), n]));
  const adjacent = neighbors(node.q, node.r).map((c) => at.get(key(c.q, c.r))).filter(Boolean);
  const names = o.playerNames ?? homes.map((hm) => `Player ${hm.homeOf + 1}`);

  let typeText = TYPE_LABEL[node.type];
  if (node.core) typeText = 'Key planet · Galactic core';
  else if (node.central) typeText = 'Key planet · contested center';
  if (node.type === 'home') typeText = `Home sector · ${names[node.homeOf]}`;
  const cost = enterCost(node.type);
  const pirates = o.pirates ?? [];

  return [
    h('button.close', { 'aria-label': 'Close details', onclick: o.onClose }, '×'),
    h('div.head',
      tilePreview(node, reveal),
      h('div',
        h('div.title', tileTitle(node)),
        h('div.type', typeText),
        h('div.coords', `Tile ${node.q}, ${node.r}`))),
    h('p.effect', TYPE_EFFECT[node.type]),
    node.core && h('p.effect', 'The Galactic Core mission scores 4 VP for controlling this planet at the end of the game.'),
    node.hidden && h('div.callout',
      h('b', 'Hidden tile'),
      h('span', reveal ? HIDDEN_LABEL[node.hiddenContent] : 'Something is out here. It is revealed when a ship arrives.')),
    pirates.length > 0 && h('div.callout.danger',
      h('b', pirates.length > 1 ? `${pirates.length} neutral pirate fleets` : 'Neutral pirate fleet'),
      h('span', `Hull ${pirates[0].hull} / ${pirates[0].maxHull} · Laser ${pirates[0].weapon}. Moves toward freighters at the end of each round.`)),
    h('h3', 'Tile'),
    row('Movement to enter', cost === Infinity ? 'Impassable' : String(cost)),
    CP_VALUE[node.type] && row('Command Points', `+${CP_VALUE[node.type]} capacity`),
    VP_VALUE[node.type] && row('Victory points', VP_VALUE[node.type]),
    node.type !== 'void' && row('Controlled by', o.controlledBy ?? (node.type === 'home' ? `${names[node.homeOf]} (at start)` : 'No one')),
    ...(o.sections ?? []),
    node.type !== 'void' && h('h3', 'Moves from each home'),
    node.type !== 'void' && h('div.home-dist', homes.map((hm) => h('span.chip', {
      style: { borderColor: PLAYER_COLORS[hm.homeOf].main, color: PLAYER_COLORS[hm.homeOf].light },
      title: names[hm.homeOf],
    }, `${names[hm.homeOf]}: ${costs[hm.id][id] === Infinity ? '—' : costs[hm.id][id]}`))),
    h('h3', 'Neighbouring tiles'),
    h('ul.neighbours', adjacent.map((n) => h('li', { onclick: () => o.onNavigate(n.id), 'data-tip': `tile:${n.id}` },
      spriteIcon(featureSpriteKey(n, { revealHidden: reveal }) ?? tileSpriteKey(n), 18),
      h('span', tileTitle(n)),
      h('span.muted', n.name ? TYPE_LABEL[n.type] : '')))),
  ].filter(Boolean);
}
