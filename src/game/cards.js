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
    name: 'Move', type: CARD_TYPE.COMMAND, cost: 0, icon: 'card:move', command: 'move', speedBonus: 0,
    text: 'Move one ship up to its speed.',
  },
  attack: {
    name: 'Attack', type: CARD_TYPE.COMMAND, cost: 0, icon: 'card:attack', command: 'attack', bonus: 0,
    text: 'One ship fires its weapons.',
  },

  // Better commands (market)
  'focused-strike': {
    name: 'Focused Strike', type: CARD_TYPE.COMMAND, cost: 3, icon: 'card:attack', command: 'attack', bonus: 2,
    text: 'One ship fires its weapons with +2 damage.',
  },
  'full-burn': {
    name: 'Full Burn', type: CARD_TYPE.COMMAND, cost: 2, icon: 'card:move', command: 'move', speedBonus: 1,
    text: 'Move one ship up to its speed +1.',
  },

  // Better credit cards (market)
  'trade-contract': {
    name: 'Trade Contract', type: CARD_TYPE.CREDIT, cost: 3, credits: 2, icon: 'card:credit',
    text: '+2 credits.',
  },
  'smugglers-cache': {
    name: "Smuggler's Cache", type: CARD_TYPE.CREDIT, cost: 4, credits: 3, discard: true, icon: 'card:credit',
    text: '+3 credits, then discard a card from your hand.',
  },
  'refit-dock': {
    name: 'Refit Dock', type: CARD_TYPE.UTILITY, cost: 2, scrap: true, icon: 'card:upgrade',
    text: 'Scrap 1 card from your hand: remove it from the game.',
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

// Upgrades: attach to one of your ships; each uses a slot, no duplicates.
const UPGRADES = {
  'laser-battery': ['Laser Battery', 3, 'Weapon', '+1 laser damage.', { needs: 'laser' }],
  'heavy-cannon': ['Heavy Cannon', 4, 'Weapon', 'Weapon becomes Cannon 3.', { only: ['frigate', 'destroyer'] }],
  'missile-rack': ['Missile Rack', 4, 'Weapon', 'Adds a Missile 2 (range 1) attack.', {}],
  'ion-emitter': ['Ion Emitter', 4, 'Weapon', 'Adds an ion (disable) attack.', {}],
  'deflector-shields': ['Deflector Shields', 4, 'Defense', 'Absorb 2 damage per attack.', {}],
  'armor-plating': ['Armor Plating', 3, 'Defense', 'Reduce each hit by 1.', {}],
  'pd-grid': ['Point Defense Grid', 3, 'Defense', 'Missiles do nothing against this ship.', {}],
  afterburners: ['Afterburners', 3, 'Utility', '+1 speed.', {}],
  'cargo-pod': ['Cargo Pod', 2, 'Utility', 'Trade routes run by this ship pay +1 credit.', { only: ['freighter', 'runner'] }],
  'cloaking-device': ['Cloaking Device', 5, 'Utility', 'Can only be attacked from the same tile.', {}],
  'targeting-computer': ['Targeting Computer', 3, 'Utility', 'Ignore 1 point of enemy armor or shields.', {}],
  'repair-drones': ['Repair Drones', 3, 'Utility', 'Repair 1 hull at the start of each of your turns.', {}],
};
for (const [id, [name, cost, kind, text, rules]] of Object.entries(UPGRADES)) {
  CARDS[id] = { name, type: CARD_TYPE.UPGRADE, cost, icon: 'card:upgrade', upgradeKind: kind, text, ...rules };
}

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

/** Market deck composition (first-pass counts for playtesting). */
export const MARKET_DECK = [
  // upgrades
  ['laser-battery', 2], ['heavy-cannon', 2], ['missile-rack', 2], ['ion-emitter', 2], ['deflector-shields', 2],
  ['armor-plating', 2], ['pd-grid', 2], ['afterburners', 2], ['cargo-pod', 2], ['cloaking-device', 1],
  ['targeting-computer', 2], ['repair-drones', 2],
  // commands and credits
  ['focused-strike', 3], ['full-burn', 3], ['trade-contract', 4], ['smugglers-cache', 2],
  // utility
  ['refit-dock', 3], ['repair', 3], ['field-repairs', 2],
  // reactions
  ['return-fire', 2], ['evasive', 2], ['point-defense', 2], ['emergency-shields', 2], ['retreat', 2], ['ambush', 1],
  // rare ships
  ['ship-corvette', 2], ['ship-interceptor', 2], ['ship-runner', 2], ['ship-carrier', 1],
];
export const MARKET_ROW_SIZE = 6;
