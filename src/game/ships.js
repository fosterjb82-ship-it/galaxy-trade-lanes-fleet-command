// Ship types from DESIGN.md "Ships" and "Command Points". First-pass numbers.

export const WEAPON = {
  LASER: 'laser',
  CANNON: 'cannon',
  MISSILE: 'missile',
  ION: 'ion',
};

export const SHIPS = {
  fighter: {
    name: 'Fighter', source: 'shipyard', cost: 2, speed: 3, hull: 2, slots: 1, cp: 1,
    weapon: { type: WEAPON.LASER, damage: 1, range: 0 }, armor: 0,
    special: 'Can use Evasive Maneuvers', evasive: true,
  },
  freighter: {
    name: 'Freighter', source: 'shipyard', cost: 3, speed: 2, hull: 3, slots: 2, cp: 1,
    weapon: null, armor: 0, special: 'Sets up trade routes', trader: true,
  },
  frigate: {
    name: 'Frigate', source: 'shipyard', cost: 4, speed: 2, hull: 4, slots: 2, cp: 2,
    weapon: { type: WEAPON.LASER, damage: 2, range: 0 }, armor: 0,
    special: 'Can use Evasive Maneuvers', evasive: true,
  },
  destroyer: {
    name: 'Destroyer', source: 'shipyard', cost: 6, speed: 1, hull: 6, slots: 3, cp: 3,
    weapon: { type: WEAPON.CANNON, damage: 4, range: 0 }, armor: 1, special: 'Armor 1 built in',
  },
  corvette: {
    name: 'Missile Corvette', source: 'market', cost: 4, speed: 2, hull: 3, slots: 1, cp: 2,
    weapon: { type: WEAPON.MISSILE, damage: 2, range: 1 }, armor: 0, special: 'Hits adjacent tiles',
  },
  interceptor: {
    name: 'Interceptor', source: 'market', cost: 5, speed: 3, hull: 3, slots: 1, cp: 2,
    weapon: { type: WEAPON.ION, damage: 0, range: 0 }, armor: 0, special: 'Ion: disables target. Freighter hunter',
  },
  runner: {
    name: 'Blockade Runner', source: 'market', cost: 4, speed: 3, hull: 3, slots: 2, cp: 2,
    weapon: { type: WEAPON.LASER, damage: 1, range: 0 }, armor: 0, special: 'Sets up trade routes', trader: true,
  },
  carrier: {
    name: 'Carrier', source: 'market', cost: 8, speed: 1, hull: 8, slots: 3, cp: 4,
    weapon: null, armor: 0, special: 'Mobile deploy point; repairs 2 hull', deployPoint: true,
  },
};

/** Neutral pirate fleets (not built by players, use no CP). */
export const PIRATE = {
  name: 'Pirate Fleet', speed: 1, hull: 4, slots: 0, cp: 0,
  weapon: { type: WEAPON.LASER, damage: 2, range: 0 }, armor: 0, special: 'Hunts freighters',
};

export function shipDef(ship) {
  return ship.owner === 'pirate' ? PIRATE : SHIPS[ship.type];
}

/** Ship sprite name for the renderer. */
export function shipSprite(ship) {
  return ship.owner === 'pirate' ? 'frigate' : ship.type;
}
