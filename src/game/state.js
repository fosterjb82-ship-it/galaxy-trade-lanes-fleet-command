// Core game state for Fleet Command.
//
// The state is a plain, JSON-serialisable object (so hot-seat games can be
// saved and resumed). It is only changed through applyAction(), which works
// on a copy, validates the action and returns the new state, so the UI can
// never put the game into an illegal position.

import { generateMap, tileGraph } from '../map/generator.js';
import { Rng } from '../rng.js';
import { CARDS, CARD_TYPE, STARTING_DECK, cardDef } from './cards.js';
import { SHIPS, PIRATE, shipDef } from './ships.js';

export const HAND_SIZE = 5;

/** CP capacity granted by controlled tiles (DESIGN.md "Command Points"). */
export const CP_SOURCE = { home: 6, key: 2, station: 2 };

export class GameError extends Error {}

// ---------------------------------------------------------------- setup

/**
 * @param {{ seed: string, players: string[], mapSeed?: string }} opts
 */
export function createGame({ seed, players, mapSeed = seed }) {
  if (players.length < 2 || players.length > 6) throw new GameError('Fleet Command needs 2–6 players');
  const map = generateMap(mapSeed, players.length);
  const pirates = map.pirates;
  const state = {
    version: 1,
    seed,
    mapSeed,
    map: { ...map, pirates: [] },
    round: 1,
    firstPlayer: 0,
    active: 0,
    players: players.map((name, i) => ({
      id: i,
      name: name || `Player ${i + 1}`,
      home: map.nodes.find((n) => n.homeOf === i).id,
      deck: [],
      hand: [],
      discard: [],
      played: [],
      vp: 0,
      credits: 0,
      kills: 0,
    })),
    cards: {},
    ships: [],
    nextId: 1,
    rng: new Rng(`game|${seed}`).save(),
    log: [],
  };

  for (const p of pirates) {
    state.ships.push({ id: `s${state.nextId++}`, owner: 'pirate', type: 'pirate', tile: p.node, hull: PIRATE.hull, upgrades: [] });
  }

  withRng(state, (rng) => {
    for (const player of state.players) {
      for (const [def, count] of STARTING_DECK) {
        for (let i = 0; i < count; i++) player.deck.push(newCard(state, def, player.id));
      }
      rng.shuffle(player.deck);
      // The fighter is always in the opening hand: swap it into the top 5.
      const fighter = player.deck.findIndex((uid) => state.cards[uid].def === 'ship-fighter');
      if (fighter >= HAND_SIZE) {
        const slot = rng.int(0, HAND_SIZE - 1);
        [player.deck[slot], player.deck[fighter]] = [player.deck[fighter], player.deck[slot]];
      }
    }
  });
  for (const player of state.players) drawCards(state, player.id, HAND_SIZE);
  log(state, `Round 1 begins. ${state.players[0].name} goes first.`);
  return state;
}

function newCard(state, def, owner) {
  if (!CARDS[def]) throw new GameError(`Unknown card ${def}`);
  const uid = `c${state.nextId++}`;
  state.cards[uid] = { uid, def, owner };
  return uid;
}

function withRng(state, fn) {
  const rng = Rng.restore(state.rng);
  const out = fn(rng);
  state.rng = rng.save();
  return out;
}

function log(state, text) {
  state.log.push({ round: state.round, text });
}

/** Draw n cards, shuffling the discard pile into the deck when it runs out. */
export function drawCards(state, playerId, n) {
  const p = state.players[playerId];
  let drawn = 0;
  while (drawn < n) {
    if (p.deck.length === 0) {
      if (p.discard.length === 0) break;
      p.deck = p.discard;
      p.discard = [];
      withRng(state, (rng) => rng.shuffle(p.deck));
    }
    p.hand.push(p.deck.shift());
    drawn++;
  }
  return drawn;
}

// ---------------------------------------------------------------- queries

export const shipsAt = (state, tile) => state.ships.filter((s) => s.tile === tile);
export const shipsOf = (state, playerId) => state.ships.filter((s) => s.owner === playerId);
export const maxHull = (ship) => shipDef(ship).hull;

/**
 * Who controls a tile: the only player with ships there, or the player with
 * the highest total hull. A tie (or pirates on top) means nobody. An empty
 * home sector stays with its owner.
 */
export function controllerOf(state, tileId) {
  const here = shipsAt(state, tileId);
  if (here.length === 0) {
    const node = state.map.nodes[tileId];
    return node.type === 'home' ? node.homeOf : null;
  }
  const hull = new Map();
  for (const s of here) hull.set(s.owner, (hull.get(s.owner) ?? 0) + s.hull);
  const ranked = [...hull.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0] === 'pirate' ? null : ranked[0][0];
}

/** Map of tileId -> controlling player for every controlled tile. */
export function controlMap(state) {
  const out = new Map();
  for (const n of state.map.nodes) {
    const c = controllerOf(state, n.id);
    if (c !== null) out.set(n.id, c);
  }
  return out;
}

export function cpCapacity(state, playerId) {
  const breakdown = [];
  for (const [tile, owner] of controlMap(state)) {
    if (owner !== playerId) continue;
    const node = state.map.nodes[tile];
    const amount = CP_SOURCE[node.type];
    if (amount) breakdown.push({ tile, label: node.name, type: node.type, amount });
  }
  return { total: breakdown.reduce((s, b) => s + b.amount, 0), breakdown };
}

export function cpUsed(state, playerId) {
  return shipsOf(state, playerId).reduce((s, ship) => s + shipDef(ship).cp, 0);
}

/** Tiles where this player may deploy: tiles they control, plus carrier tiles. */
export function deployTiles(state, playerId) {
  const tiles = new Set();
  for (const [tile, owner] of controlMap(state)) if (owner === playerId) tiles.add(tile);
  for (const s of shipsOf(state, playerId)) if (SHIPS[s.type]?.deployPoint) tiles.add(s.tile);
  return [...tiles].filter((t) => state.map.nodes[t].type !== 'void');
}

/** Can this player play this Ship card right now? */
export function deployCheck(state, playerId, cardUid) {
  const p = state.players[playerId];
  if (playerId !== state.active) return { ok: false, reason: `It is ${state.players[state.active].name}'s turn.` };
  if (!p.hand.includes(cardUid)) return { ok: false, reason: 'That card is not in your hand.' };
  const def = cardDef(state.cards[cardUid]);
  if (def.type !== CARD_TYPE.SHIP) return { ok: false, reason: 'Not a ship card.' };
  const need = SHIPS[def.ship].cp;
  const used = cpUsed(state, playerId);
  const cap = cpCapacity(state, playerId).total;
  if (used + need > cap) {
    return { ok: false, reason: `Not enough Command Points: ${used} of ${cap} in use and a ${SHIPS[def.ship].name.toLowerCase()} needs ${need}.` };
  }
  const tiles = deployTiles(state, playerId);
  if (tiles.length === 0) return { ok: false, reason: 'You control no tile to deploy at.' };
  return { ok: true, tiles, cp: need };
}

// ---------------------------------------------------------------- actions

/**
 * Apply an action and return the new state. Throws GameError if illegal.
 * Actions:
 *   { type: 'deploy', player, card, tile }
 *   { type: 'dev.setActive', player }            (sandbox, stage 2 only)
 *   { type: 'dev.giveCard', player, def }        (sandbox)
 *   { type: 'dev.placeShip', ship, tile }        (sandbox)
 */
export function applyAction(prev, action) {
  const state = structuredClone(prev);
  const handler = HANDLERS[action.type];
  if (!handler) throw new GameError(`Unknown action ${action.type}`);
  handler(state, action);
  return state;
}

const HANDLERS = {
  deploy(state, { player, card, tile }) {
    const check = deployCheck(state, player, card);
    if (!check.ok) throw new GameError(check.reason);
    if (!check.tiles.includes(tile)) throw new GameError('You can only deploy at a tile you control (or your carrier\'s tile).');
    const p = state.players[player];
    const def = cardDef(state.cards[card]);
    p.hand.splice(p.hand.indexOf(card), 1);
    // The card leaves the hand and travels with the ship until it is destroyed.
    state.ships.push({
      id: `s${state.nextId++}`, owner: player, type: def.ship, tile, hull: SHIPS[def.ship].hull, card, upgrades: [],
    });
    log(state, `${p.name} deployed a ${SHIPS[def.ship].name.toLowerCase()} at ${state.map.nodes[tile].name ?? 'open space'}.`);
  },

  'dev.setActive'(state, { player }) {
    if (!state.players[player]) throw new GameError('No such player');
    state.active = player;
  },

  'dev.giveCard'(state, { player, def }) {
    state.players[player].hand.push(newCard(state, def, player));
    log(state, `[sandbox] ${state.players[player].name} was given ${CARDS[def].name}.`);
  },

  'dev.placeShip'(state, { ship, tile }) {
    const s = state.ships.find((x) => x.id === ship);
    if (!s) throw new GameError('No such ship');
    const { cost } = tileGraph(state.map.nodes);
    if (cost[tile] === Infinity) throw new GameError('Ships cannot enter a void rift.');
    s.tile = tile;
  },
};

/** Quick integrity check used by tests: every card is in exactly one place. */
export function cardLocations(state) {
  const where = new Map();
  const put = (uid, place) => {
    if (where.has(uid)) throw new Error(`card ${uid} in ${where.get(uid)} and ${place}`);
    where.set(uid, place);
  };
  for (const p of state.players) {
    for (const zone of ['deck', 'hand', 'discard', 'played']) for (const uid of p[zone]) put(uid, `${p.id}.${zone}`);
  }
  for (const s of state.ships) {
    if (s.card) put(s.card, `ship ${s.id}`);
    for (const u of s.upgrades) put(u, `ship ${s.id} upgrade`);
  }
  for (const uid of Object.keys(state.cards)) if (!where.has(uid)) throw new Error(`card ${uid} is nowhere`);
  return where;
}
