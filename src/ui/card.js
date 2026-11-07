// Card face for the hand. Pixel-art icon; all text crisp HTML.

import { CARDS, CARD_TYPE } from '../game/cards.js';
import { SHIPS } from '../game/ships.js';
import { h, spriteIcon } from './dom.js';

const TYPE_NAME = {
  [CARD_TYPE.SHIP]: 'Ship',
  [CARD_TYPE.COMMAND]: 'Command',
  [CARD_TYPE.CREDIT]: 'Credit',
  [CARD_TYPE.UPGRADE]: 'Upgrade',
  [CARD_TYPE.REACTION]: 'Reaction',
  [CARD_TYPE.UTILITY]: 'Utility',
};

function weaponText(w) {
  if (!w) return '—';
  if (w.type === 'ion') return 'Ion';
  return `${w.type[0].toUpperCase()}${w.type.slice(1)} ${w.damage}${w.range ? ` · r${w.range}` : ''}`;
}

/**
 * @param {string} defId
 * @param {{ owner?: number, state?: 'playable'|'locked'|'blocked'|'selected', note?: string, onClick?: Function }} o
 */
export function cardFace(defId, o = {}) {
  const def = CARDS[defId];
  const ship = def.ship ? SHIPS[def.ship] : null;
  const iconKey = ship ? `ship:${def.ship}:${o.owner ?? 0}` : def.icon;
  return h(`button.card.type-${def.type}.${o.state ?? 'playable'}`, {
    type: 'button',
    title: o.note ?? def.text,
    onclick: o.onClick,
    'aria-pressed': o.state === 'selected' ? 'true' : 'false',
  },
  h('div.card-top', h('span.card-name', def.name), def.cost > 0 && h('span.card-cost', { title: 'Cost to buy' }, def.cost)),
  h('div.card-art', spriteIcon(iconKey, 44)),
  h('div.card-type', TYPE_NAME[def.type]),
  ship
    ? h('div.card-stats',
      h('span', h('b', ship.speed), 'SPD'),
      h('span', h('b', weaponText(ship.weapon)), 'WPN'),
      h('span', h('b', ship.hull), 'HULL'),
      h('span', h('b', ship.cp), 'CP'))
    : h('div.card-text', def.text),
  o.note && o.state !== 'playable' && o.state !== 'selected' && h('div.card-note', o.note));
}
