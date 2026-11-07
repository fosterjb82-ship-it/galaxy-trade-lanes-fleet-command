// Card definitions. Card *instances* live in state.cards keyed by uid and
// reference a definition id here.

import { SHIPS } from './ships.js';

export const CARD_TYPE = {
  SHIP: 'ship',
  COMMAND: 'command',
  CREDIT: 'credit',
  UPGRADE: 'upgrade',
  REACTION: 'reaction',
  UTILITY: 'utility',
};

export const CARDS = {
  credits: {
    name: 'Credits', type: CARD_TYPE.CREDIT, cost: 0, credits: 1, icon: 'card:credit',
    text: '+1 credit.',
  },
  move: {
    name: 'Move', type: CARD_TYPE.COMMAND, cost: 0, icon: 'card:move',
    text: 'Move one ship up to its speed.',
  },
  attack: {
    name: 'Attack', type: CARD_TYPE.COMMAND, cost: 0, icon: 'card:attack',
    text: 'One ship fires its weapons.',
  },
};

// One Ship card per ship type.
for (const [id, s] of Object.entries(SHIPS)) {
  CARDS[`ship-${id}`] = {
    name: s.name, type: CARD_TYPE.SHIP, cost: s.cost, ship: id, icon: `ship:${id}`,
    text: `Deploy a ${s.name.toLowerCase()} at a tile you control.`,
  };
}

/** The 10-card starting deck every player gets. */
export const STARTING_DECK = [
  ['ship-fighter', 1],
  ['credits', 4],
  ['move', 3],
  ['attack', 2],
];

export function cardDef(card) {
  return CARDS[card.def];
}
