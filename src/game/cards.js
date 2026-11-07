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
    name: 'Attack', type: CARD_TYPE.COMMAND, cost: 0, icon: 'card:attack', bonus: 0,
    text: 'One ship fires its weapons.',
  },

  // Reactions: kept at end of turn, played on an opponent's turn.
  'return-fire': {
    name: 'Return Fire', type: CARD_TYPE.REACTION, cost: 3, icon: 'card:react', reaction: 'returnFire',
    text: 'After damage, if your ship survives, it hits back with its weapon.',
  },
  evasive: {
    name: 'Evasive Maneuvers', type: CARD_TYPE.REACTION, cost: 2, icon: 'card:react', reaction: 'evasive',
    text: 'Reduce incoming damage by 2. Fighters and frigates only.',
  },
  'point-defense': {
    name: 'Point Defense', type: CARD_TYPE.REACTION, cost: 2, icon: 'card:shield', reaction: 'pointDefense',
    text: 'Cancel one missile attack.',
  },
  'emergency-shields': {
    name: 'Emergency Shields', type: CARD_TYPE.REACTION, cost: 3, icon: 'card:shield', reaction: 'shields',
    text: '+3 shields for this attack only.',
  },
  retreat: {
    name: 'Retreat', type: CARD_TYPE.REACTION, cost: 2, icon: 'card:react', reaction: 'retreat',
    text: 'Move the targeted ship 1 tile away; the attack misses.',
  },
  ambush: {
    name: 'Ambush', type: CARD_TYPE.REACTION, cost: 4, icon: 'card:react', reaction: 'ambush', rare: true,
    text: 'When an enemy moves onto your tile, one of your ships there hits it first.',
  },

  // Utility
  repair: {
    name: 'Repair', type: CARD_TYPE.UTILITY, cost: 2, icon: 'card:repair', repair: 2,
    text: 'Repair 2 hull on one of your ships, anywhere.',
  },
  'field-repairs': {
    name: 'Field Repairs', type: CARD_TYPE.UTILITY, cost: 4, icon: 'card:repair', repair: 4,
    text: 'Repair 4 hull on one of your ships, anywhere.',
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
