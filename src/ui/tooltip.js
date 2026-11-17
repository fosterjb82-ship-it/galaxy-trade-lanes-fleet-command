// Hover tooltips: rest the pointer on a card, mission, tile or ship for two
// seconds to see a magnified picture with its details and the rules behind it.
//
// DOM elements opt in with data-tip="kind:arg:arg"; the board (a canvas)
// calls tips.hover(key, build, event) itself. Moving off, clicking, scrolling
// or pressing a key hides the tip.

import { CARDS } from '../game/cards.js';
import { SHIPS, PIRATE } from '../game/ships.js';
import { MISSIONS } from '../game/missions.js';
import { CANNON_PIERCE, EVASIVE_REDUCTION, EMERGENCY_SHIELDS } from '../game/combat.js';
import { h, spriteIcon } from './dom.js';
import { TYPE_LABEL, TYPE_EFFECT, CP_VALUE, tilePreview, tileTitle } from './details.js';

export const TIP_DELAY = 2000;

// ---------------------------------------------------------------- rules text

const TYPE_RULES = {
  ship: [
    'Play it to deploy the ship at a tile you control, or at your carrier\'s tile.',
    'While on the board it uses Command Points; you can\'t deploy past your capacity.',
    'If it is destroyed, the card (and any upgrades) go back to your discard pile, and the attacker scores 1 VP.',
  ],
  credit: ['Adds credits for this turn only. Unspent credits are lost at the end of your turn.'],
  command: [],
  upgrade: [
    'Play it on one of your ships anywhere on the board.',
    'It uses one upgrade slot. A ship can\'t carry two of the same upgrade.',
    'It stays until the ship is destroyed, then returns to your discard pile.',
  ],
  reaction: [
    'Keep it at the end of your turn: kept cards are held face down, and opponents only see how many.',
    'Play it on an opponent\'s turn, after an attack on one of your ships is declared and before damage. Only one reaction per attack.',
  ],
  utility: [],
};

const CARD_RULES = {
  credits: ['Always for sale in the Shipyard for 2, so the economy never stalls.'],
  'smugglers-cache': ['After the credits, you must discard another card from your hand (if you have one).'],
  move: [
    'Move one of your ships up to its speed. Each tile costs 1 movement; asteroid fields cost 2; void rifts can\'t be entered.',
    'A ship must stop when it enters a tile with enemy ships or pirates.',
    'Each nebula entered deals 1 damage. Ending on a hidden tile reveals it.',
  ],
  'full-burn': ['Works like Move, with 1 extra point of speed.'],
  attack: [
    'One of your armed ships fires one weapon at a target in range: the same tile, or an adjacent tile for missiles.',
    `Damage = weapon + card bonus − shields − armor. Lasers suffer shields in full; cannons ignore ${CANNON_PIERCE} shield points; ion deals no damage but disables.`,
    'Each ship fires at most once per turn. A kill scores 1 VP.',
  ],
  'focused-strike': ['An Attack with +2 damage. All the usual attack rules apply.'],
  repair: ['Restores hull on any of your ships, wherever it is, up to its maximum.'],
  'field-repairs': ['Restores hull on any of your ships, wherever it is, up to its maximum.'],
  'refit-dock': ['The scrapped card is removed from the game for good: a way to thin out weak cards like basic Credits.'],
  'return-fire': ['Your ship must survive the hit and have a weapon that can reach the attacker. Its return shot can\'t be answered.'],
  evasive: [`Reduces the incoming damage by ${EVASIVE_REDUCTION}. Only fighters and frigates can evade.`],
  'point-defense': ['Cancels the attack completely, but only if it is a missile attack.'],
  'emergency-shields': [`Adds ${EMERGENCY_SHIELDS} shields against this one attack. Cannons still ignore ${CANNON_PIERCE} shield points.`],
  retreat: ['You choose a neighbouring open tile; the ship moves there and the attack misses. Entering a nebula still deals 1 damage.'],
  ambush: ['Triggers when an enemy ship moves onto a tile where you have an armed ship. One of your ships there hits it before it can act.'],
  'laser-battery': ['Needs a laser weapon. Every laser on the ship deals +1.'],
  'heavy-cannon': ['Frigates and destroyers only. The main weapon becomes Cannon 3 (a destroyer keeps its Cannon 4).'],
  'missile-rack': ['Adds a second weapon: Missile 2 with range 1. Choose which weapon to fire with each Attack.'],
  'ion-emitter': ['Adds an ion weapon: no damage, but the target can\'t move or attack on its owner\'s next turn.'],
  'deflector-shields': [`+2 shields on every attack. Cannons ignore ${CANNON_PIERCE} of them.`],
  'armor-plating': ['+1 armor: every hit is reduced by 1, whatever the weapon.'],
  'pd-grid': ['Missile attacks against this ship always do nothing.'],
  afterburners: ['+1 speed on every move.'],
  'cargo-pod': ['Freighters and blockade runners only. A trade route run by this ship pays +1 credit.'],
  'cloaking-device': ['Enemies must be on the same tile to attack it: missiles from adjacent tiles can\'t reach it.'],
  'targeting-computer': ['When this ship fires, it ignores 1 point of the target\'s shields (or armor).'],
  'repair-drones': ['At the start of each of your turns, the ship repairs 1 hull.'],
};

function weaponText(w) {
  if (!w) return 'Unarmed';
  if (w.type === 'ion') return 'Ion (disables)';
  return `${w.type[0].toUpperCase()}${w.type.slice(1)} ${w.damage}${w.range ? `, range ${w.range}` : ''}`;
}

const stat = (label, value) => h('div.tip-stat', h('span', label), h('b', value));
const rules = (list) => list.length > 0 && h('ul.tip-rules', list.map((r) => h('li', r)));

// ---------------------------------------------------------------- content

/** A card: magnified illustration, stats and how it works. */
export function cardTip(defId, owner = '', { price = null } = {}) {
  const def = CARDS[defId];
  if (!def) return null;
  const ship = def.ship ? SHIPS[def.ship] : null;
  const kind = def.upgradeKind ? `${def.upgradeKind} upgrade` : def.type[0].toUpperCase() + def.type.slice(1);
  const restrictions = [];
  if (def.only) restrictions.push(`Fits ${def.only.map((t) => `${SHIPS[t].name.toLowerCase()}s`).join(' and ')} only.`);
  if (def.needs === 'laser') restrictions.push('Needs a laser weapon.');
  return [
    spriteIcon(`cardart:${defId}:${owner}`, 300),
    h('div.tip-head', h('b.tip-title', def.name), def.cost > 0 && h('span.tip-cost', price ?? def.cost)),
    h('div.tip-kind', kind),
    h('p.tip-text', def.text),
    ship && h('div.tip-stats',
      stat('Speed', ship.speed), stat('Weapon', weaponText(ship.weapon)), stat('Hull', ship.hull),
      stat('Command Points', ship.cp), stat('Upgrade slots', ship.slots), ship.armor > 0 && stat('Armor', ship.armor)),
    ship?.special && h('p.tip-note', ship.special),
    rules([...restrictions, ...(CARD_RULES[defId] ?? []), ...(TYPE_RULES[def.type] ?? [])]),
  ];
}

/** A secret mission. */
export function missionTip(id, progress = null, state = null) {
  const m = MISSIONS[id];
  if (!m) return null;
  return [
    spriteIcon(`mission:${id}`, 300),
    h('div.tip-head', h('b.tip-title', m.name), h('span.tip-cost.vp', `${m.vp} VP`)),
    h('div.tip-kind', `${m.kind} mission · ${m.timing === 'immediate' ? 'immediate' : 'end of game'}`),
    h('p.tip-text', m.text),
    progress && h('div.tip-stats', stat('Your progress', progress), state && stat('Status', state)),
    rules([
      m.timing === 'immediate'
        ? 'Scores the moment you complete it: it is revealed to everyone and the VP are added at once.'
        : 'Checked at final scoring: revealed then, and scores only if the condition holds at the end.',
      'Missions stay secret until they are scored. Each player keeps 2 of the 3 they are dealt.',
      m.minPlayers && `Left out of games with fewer than ${m.minPlayers} players.`,
    ].filter(Boolean)),
  ];
}

const TILE_RULES = {
  home: [
    'Home defences: any enemy ship (or pirate) that ends a move here takes 2 damage, so a lone fighter can\'t raid it.',
    'An enemy that survives and has the upper hand here takes control, and its 6 CP, until you take it back.',
  ],
  key: [
    'Claim it by having the only ships here, or the most total hull. It stays yours after your ships leave.',
    'An enemy takes it only by having the upper hand here; a tie leaves it with the current holder.',
  ],
  station: [
    'Held like a planet: it stays yours after you leave, until an enemy takes it.',
    'Ships starting your turn here repair fully. Control any station to buy ship cards for 1 less.',
  ],
  trade: [
    'Held like a planet once claimed.',
    'A freighter or blockade runner here can set up a trade route to another trade node within 8 jumps.',
  ],
  intersection: [
    'Held like a planet once claimed.',
    'Many shortest paths run through here, so ships stopping on enemy tiles can block traffic.',
  ],
  empty: ['Open space is only controlled while your ships are on it.'],
  asteroid: ['Ships may stop here; it simply costs more to enter.'],
  nebula: ['The damage applies every time a ship enters, including mid-move and on a Retreat.'],
  void: ['Blocks movement, so it shapes the routes around it.'],
};

/**
 * A map tile.
 * @param {object} map
 * @param {number} id
 * @param {{ controller?: string, ships?: string[], reveal?: boolean, revealed?: string }} extra
 */
export function tileTip(map, id, extra = {}) {
  const node = map.nodes[id];
  let kind = TYPE_LABEL[node.type];
  if (node.core) kind = 'Key planet · galactic core';
  else if (node.central) kind = 'Key planet · contested center';
  const cost = node.type === 'void' ? 'Impassable' : node.type === 'asteroid' ? '2' : '1';
  return [
    h('div.tip-tile', tilePreview(node, Boolean(extra.reveal), 150)),
    h('div.tip-head', h('b.tip-title', tileTitle(node))),
    h('div.tip-kind', kind),
    h('p.tip-text', TYPE_EFFECT[node.type]),
    node.hidden && !node.revealed && h('p.tip-note', 'Hidden: something is out here. A ship ending its move on this tile reveals it (salvage credits, a card, or a pirate nest).'),
    extra.revealed && h('p.tip-note', extra.revealed),
    h('div.tip-stats',
      stat('Movement to enter', cost),
      CP_VALUE[node.type] && stat('Command Points', `+${CP_VALUE[node.type]}`),
      node.type === 'key' && stat('Victory points', '2 per round'),
      extra.controller && stat('Controlled by', extra.controller),
      extra.ships?.length > 0 && stat('Ships here', extra.ships.join(', '))),
    rules([...(TILE_RULES[node.type] ?? []), node.core && 'The Galactic Core mission scores 4 VP for holding it at the end.'].filter(Boolean)),
    h('p.tip-hint', 'Click the tile for full details.'),
  ];
}

/**
 * A ship on the board.
 * @param {object} ship
 * @param {object} o  { ownerName, stats (from shipStats), upgrades: [{name, text}], status: [] }
 */
export function shipTip(ship, o) {
  const pirate = ship.owner === 'pirate';
  const def = pirate ? PIRATE : SHIPS[ship.type];
  const st = o.stats;
  return [
    spriteIcon(`ship:${pirate ? 'frigate' : ship.type}:${pirate ? 'pirate' : ship.owner}`, 280),
    h('div.tip-head', h('b.tip-title', def.name), h('span.tip-cost.hull', `${ship.hull}/${def.hull}`)),
    h('div.tip-kind', o.ownerName),
    def.special && h('p.tip-text', def.special),
    h('div.tip-stats',
      stat('Speed', st.speed),
      stat('Weapons', st.weapons.length ? st.weapons.map(weaponText).join(', ') : 'Unarmed'),
      stat('Shields', st.shields || '—'),
      stat('Armor', st.armor || '—'),
      !pirate && stat('Command Points', def.cp),
      !pirate && stat('Upgrades', `${ship.upgrades.length} of ${def.slots} slots`)),
    o.upgrades.length > 0 && h('ul.tip-rules', o.upgrades.map((u) => h('li', h('b', u.name), ` · ${u.text}`))),
    o.status.length > 0 && h('p.tip-note', o.status.join(' ')),
    rules(pirate
      ? ['Neutral. Pirates hold still in rounds 1–2. From round 3, at the end of each round it moves 1 tile toward the nearest freighter or blockade runner, then attacks a ship on its tile.', 'Destroying it scores 1 VP. Home defences fire on pirates too.']
      : ['Damage stays until repaired: Repair cards, a station you control (full), or your carrier\'s tile (+2) at the start of your turn.']),
    h('p.tip-hint', 'Click the ship for full details and upgrade slots.'),
  ];
}

// ---------------------------------------------------------------- engine

/**
 * Install the tooltip layer.
 * @param {(kind: string, args: string[]) => (Node[]|null)} resolve  builds content for data-tip values
 */
export function installTooltips(resolve) {
  const tip = h('div.tip', { role: 'tooltip', 'aria-hidden': 'true' });
  document.body.append(tip);
  let timer = null;
  let key = null;
  let pos = { x: 0, y: 0 };
  let shown = false;

  const place = () => {
    const pad = 18;
    const r = tip.getBoundingClientRect();
    let x = pos.x + pad;
    let y = pos.y + pad;
    if (x + r.width > innerWidth - 8) x = pos.x - r.width - pad;
    if (y + r.height > innerHeight - 8) y = Math.max(8, innerHeight - r.height - 8);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  };

  const hide = () => {
    clearTimeout(timer);
    timer = null;
    key = null;
    if (shown) {
      tip.classList.remove('show');
      tip.setAttribute('aria-hidden', 'true');
      shown = false;
    }
  };

  /** Start (or keep) the countdown for `k`; build() runs when it fires. */
  const hover = (k, build, e) => {
    if (e) pos = { x: e.clientX, y: e.clientY };
    if (k === key) return;
    hide();
    if (!k) return;
    key = k;
    timer = setTimeout(() => {
      const content = build();
      if (!content) return;
      tip.replaceChildren(...[].concat(content).filter(Boolean));
      tip.classList.add('show');
      tip.setAttribute('aria-hidden', 'false');
      shown = true;
      place();
    }, TIP_DELAY);
  };

  document.addEventListener('pointermove', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (el) {
      const value = el.dataset.tip;
      hover(`dom:${value}`, () => {
        const [kind, ...args] = value.split(':');
        return resolve(kind, args);
      }, e);
    } else if (key?.startsWith('dom:')) {
      hide();
    }
  }, { passive: true });
  for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, hide, { passive: true, capture: true });
  document.addEventListener('scroll', hide, { passive: true, capture: true });
  window.addEventListener('blur', hide);

  return { hover, hide };
}

