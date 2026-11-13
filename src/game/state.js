// Core game state for Fleet Command.
//
// The state is a plain, JSON-serialisable object (so hot-seat games can be
// saved and resumed). It is only changed through applyAction(), which works
// on a copy, validates the action and returns the new state, so the UI can
// never put the game into an illegal position.

import { generateMap, tileGraph } from '../map/generator.js';
import { Rng } from '../rng.js';
import { CARDS, CARD_TYPE, STARTING_DECK, MARKET_DECK, MARKET_ROW_SIZE, cardDef } from './cards.js';
import { SHIPS, PIRATE, shipDef } from './ships.js';
import { reachable } from './movement.js';
import {
  shipStats, damageFor, inRange, attackOptions, cannotAttack, describeDamage, EMERGENCY_SHIELDS,
} from './combat.js';
import { neighbors, key as hexKey } from '../map/hex.js';
import {
  routeOptions, pruneRoutes, blockaded, routeIncome, routesOf, activeAgreements, agreementBetween, offerCheck,
  isTrader, BREAK_BONUS,
} from './trade.js';
import { MISSIONS, missionDone, missionPool } from './missions.js';
import { piratePhase } from './pirates.js';

export const HAND_SIZE = 5;
export const MAX_KEEP = 2;
export const KEY_PLANET_VP = 2;

/** Tiles whose control persists after your ships leave, until an enemy takes them. */
export const HOLDABLE = new Set(['home', 'key', 'station', 'trade', 'intersection']);
/** Damage an enemy ship takes when it ends a move in someone's home sector. */
export const HOME_DEFENCE = 2;
/** Pirates sit still for the opening rounds; the pirate phase starts this round. */
export const PIRATE_START_ROUND = 3;
export const AGREEMENT_VP = 1;

/** Chance the game ends after each round (DESIGN.md "Uncertain ending"). */
export const END_CHANCE = {
  standard: { 7: 1 / 3, 8: 1 / 2, 9: 1 / 2, 10: 1 },
  quick: { 3: 1 / 2, 4: 1 }, // for trying the ending without a full game
};
export const END_ODDS_LABEL = { [1 / 3]: '1 in 3', [1 / 2]: '1 in 2', 1: 'certain' };

/** Cards always for sale: the four basic ships, plus a Credits card for 2 so the economy never stalls. */
export const SHIPYARD = ['credits', 'ship-fighter', 'ship-freighter', 'ship-frigate', 'ship-destroyer'];



/** What hidden tiles hold, revealed when a ship arrives. */
export const HIDDEN_EFFECT = {
  derelict: { title: 'Derelict', text: 'Salvage: +2 credits this turn.' },
  bonus: { title: 'Bonus cache', text: 'Draw 1 card.' },
  pirateNest: { title: 'Pirate nest', text: 'A pirate fleet appears!' },
};

/** CP capacity granted by controlled tiles (DESIGN.md "Command Points"). */
export const CP_SOURCE = { home: 6, key: 2, station: 2 };

export class GameError extends Error {}

// ---------------------------------------------------------------- setup

/**
 * @param {{ seed: string, players: string[], mapSeed?: string }} opts
 */
export function createGame({ seed, players, mapSeed = seed, length = 'standard', missions = 'draft' }) {
  if (players.length < 2 || players.length > 6) throw new GameError('Fleet Command needs 2–6 players');
  const map = generateMap(mapSeed, players.length);
  const pirates = map.pirates;
  const state = {
    version: 2,
    seed,
    mapSeed,
    map: { ...map, pirates: [] },
    round: 1,
    firstPlayer: 0,
    active: 0,
    turnInRound: 0, // how many players have finished their turn this round
    turnNumber: 1,
    phase: 'action',
    pending: null, // an attack or ambush waiting for the defender's reaction
    rounds: [], // end-of-round scoring summaries
    settings: { length },
    market: { deck: [], row: [] },
    scrapped: [],
    routes: [], // { id, owner, ship, a, b, path, length, label }
    agreements: [], // { id, a, b }
    notices: [], // public announcements for the UI (missions scored, …)
    final: null,
    players: players.map((name, i) => ({
      id: i,
      name: name || `Player ${i + 1}`,
      home: map.nodes.find((n) => n.homeOf === i).id,
      deck: [],
      hand: [],
      discard: [],
      played: [],
      reserve: [], // cards kept at end of turn, playable as reactions
      vp: 0,
      credits: 0, // available this turn; lost at end of turn
      spent: 0, // spent this turn (War Chest mission)
      kills: 0,
      losses: 0,
      killLog: [], // { type, owner } of each ship destroyed (missions)
      vpFrom: { planets: 0, agreements: 0, kills: 0, missions: 0 },
      missionOffer: [], // 3 dealt at the start; keep 2
      missions: [], // { id, scored }
      longestRoute: 0,
      bestSpend: 0,
      deepStrikeShips: [],
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

  withRng(state, (rng) => {
    // Market deck and the face-up row of 6.
    for (const [def, count] of MARKET_DECK) for (let i = 0; i < count; i++) state.market.deck.push(newCard(state, def, null));
    rng.shuffle(state.market.deck);
    state.market.row = state.market.deck.splice(0, MARKET_ROW_SIZE);
    // Secret missions: deal 3 each.
    const pool = rng.shuffle(missionPool(players.length));
    for (const player of state.players) player.missionOffer = pool.splice(0, 3);
  });
  // 'auto' (tests, quick setups) keeps the first 2 dealt.
  if (missions === 'auto') {
    for (const player of state.players) {
      player.missions = player.missionOffer.slice(0, 2).map((id) => ({ id, scored: false }));
      player.missionOffer = [];
    }
  }
  log(state, `Round 1 begins. ${state.players[0].name} goes first.`);
  startTurn(state);
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

/** Record a visual effect for the UI to play back (moves, shots, explosions…). */
export function fx(state, effect) {
  (state.fx ??= []).push(effect);
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
 * Who has the upper hand on a tile right now: the only player with ships
 * there, or the player with the most total hull. A tie, pirates on top or an
 * empty tile give null.
 */
export function presenceOf(state, tileId) {
  const here = shipsAt(state, tileId);
  if (here.length === 0) return null;
  const hull = new Map();
  for (const s of here) hull.set(s.owner, (hull.get(s.owner) ?? 0) + s.hull);
  const ranked = [...hull.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0] === 'pirate' ? null : ranked[0][0];
}

/** The stored holder of a holdable tile (homes start with their owner). */
function heldBy(state, tileId) {
  const stored = state.control?.[tileId];
  if (stored !== undefined) return stored;
  const node = state.map.nodes[tileId];
  return node.type === 'home' ? node.homeOf : null;
}

/**
 * Who controls a tile. Open space, asteroids and nebulas: whoever has the
 * upper hand there now. Homes, key planets, stations, trade nodes and
 * intersections are held: the holder keeps them after leaving, through ties
 * and while pirates sit there, until another player has the upper hand.
 */
export function controllerOf(state, tileId) {
  const now = presenceOf(state, tileId);
  if (!HOLDABLE.has(state.map.nodes[tileId].type)) return now;
  return now ?? heldBy(state, tileId);
}

/** Record who holds each holdable tile (run after every change on the board). */
export function updateControl(state) {
  state.control ??= {};
  for (const n of state.map.nodes) {
    if (!HOLDABLE.has(n.type)) continue;
    const now = presenceOf(state, n.id);
    if (now === null) continue;
    const before = heldBy(state, n.id);
    if (now !== before) {
      state.control[n.id] = now;
      if (n.name) log(state, `${state.players[now].name} takes control of ${n.name}.`);
    }
  }
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
  if (state.phase !== 'action') return { ok: false, reason: 'The game is over.' };
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

// ---------------------------------------------------------------- turn flow

/** Players in turn order for the current round (first player rotates). */
export function turnOrder(state) {
  const n = state.players.length;
  return Array.from({ length: n }, (_, i) => (state.firstPlayer + i) % n);
}

/** Ship cards cost 1 less while you control at least one station. */
export function hasStation(state, playerId) {
  for (const [tile, owner] of controlMap(state)) {
    if (owner === playerId && state.map.nodes[tile].type === 'station') return true;
  }
  return false;
}

export function buyPrice(state, playerId, def) {
  const card = CARDS[def];
  if (card.type === CARD_TYPE.SHIP && hasStation(state, playerId)) return Math.max(1, card.cost - 1);
  return card.cost;
}

/**
 * Start-of-turn effects: kept reaction cards return to hand; ships at a
 * controlled station repair fully; ships with your carrier repair 2 hull.
 * (Trade route income arrives in Stage 5.)
 */
function startTurn(state) {
  const p = state.players[state.active];
  p.credits = 0;
  p.spent = 0;
  p.hand = [...p.reserve, ...p.hand];
  p.reserve = [];
  const events = [];
  const carriers = shipsOf(state, p.id).filter((s) => SHIPS[s.type]?.deployPoint);
  for (const ship of shipsOf(state, p.id)) {
    const max = maxHull(ship);
    if (ship.hull >= max) continue;
    const node = state.map.nodes[ship.tile];
    let heal = 0;
    let where = '';
    if (node.type === 'station' && controllerOf(state, ship.tile) === p.id) {
      heal = max - ship.hull;
      where = `at ${node.name}`;
    } else if (carriers.some((c) => c.id !== ship.id && c.tile === ship.tile)) {
      heal = Math.min(2, max - ship.hull);
      where = 'by its carrier';
    }
    if (heal > 0) {
      ship.hull += heal;
      fx(state, { kind: 'repair', ship: ship.id, tile: ship.tile, amount: heal, start: true });
      events.push(`${shipDef(ship).name} repaired ${heal} hull ${where}.`);
    }
  }
  // Repair Drones.
  for (const ship of shipsOf(state, p.id)) {
    if (shipStats(state, ship).repairDrones && ship.hull < maxHull(ship)) {
      ship.hull += 1;
      fx(state, { kind: 'repair', ship: ship.id, tile: ship.tile, amount: 1, start: true });
      events.push(`Repair drones fix 1 hull on a ${shipDef(ship).name.toLowerCase()}.`);
    }
  }
  // Trade route and agreement income.
  let income = 0;
  for (const r of routesOf(state, p.id)) {
    if (blockaded(state, r)) events.push(`Route ${r.label} is blockaded: no income.`);
    else income += routeIncome(state, r);
  }
  const deals = activeAgreements(state, p.id).length;
  income += deals;
  if (income) {
    p.credits += income;
    fx(state, { kind: 'income', tile: p.home, amount: income, owner: p.id, start: true });
    events.push(`Trade income: +${income} credit${income === 1 ? '' : 's'}${deals ? ` (incl. ${deals} from agreements)` : ''}.`);
  }
  // Deep Strike: a ship that ended your last turn in an enemy home and is still there.
  if (p.deepStrikeShips.some((id) => {
    const sh = state.ships.find((x) => x.id === id);
    const n = sh && state.map.nodes[sh.tile];
    return n && n.type === 'home' && n.homeOf !== p.id;
  })) p.deepStrikeDone = true;
  p.deepStrikeShips = [];
  if (p.backstab && state.turnNumber > p.backstab.until) p.backstab = null;
  for (const e of events) log(state, `${p.name}: ${e}`);
  state.turnStart = { player: p.id, turnNumber: state.turnNumber, events };
  checkMissions(state);
}

function awardVP(state, pid, n, source) {
  const p = state.players[pid];
  p.vp += n;
  p.vpFrom[source] += n;
}

/** Remove a ship: its card and upgrades go back to the owner's discard pile. */
export function destroyShip(state, shipId, { by = null, cause = '' } = {}) {
  const i = state.ships.findIndex((s) => s.id === shipId);
  const [ship] = state.ships.splice(i, 1);
  fx(state, { kind: 'explode', ship: ship.id, tile: ship.tile, type: ship.type, owner: ship.owner });
  if (ship.owner !== 'pirate') {
    const owner = state.players[ship.owner];
    if (ship.card) owner.discard.push(ship.card);
    owner.discard.push(...ship.upgrades);
    owner.losses++;
  }
  if (by !== null && by !== 'pirate') {
    const killer = state.players[by];
    awardVP(state, by, 1, 'kills');
    killer.kills += 1;
    killer.killLog.push({ type: ship.type, owner: ship.owner });
    if (killer.backstab && killer.backstab.target === ship.owner && state.turnNumber <= killer.backstab.until) killer.backstabDone = true;
  }
  pruneRoutes(state, (t) => log(state, t));
  log(state, `${ship.owner === 'pirate' ? 'A pirate fleet' : `${state.players[ship.owner].name}'s ${shipDef(ship).name.toLowerCase()}`} was destroyed${cause ? ` ${cause}` : ''}${by !== null && by !== 'pirate' ? ` (+1 VP to ${state.players[by].name})` : ''}.`);
  return ship;
}

/**
 * End of round: 2 VP per controlled key planet and 1 VP per active trade
 * agreement; then the pirate phase; then the roll for the uncertain ending.
 */
function endRound(state) {
  updateControl(state);
  const control = controlMap(state);
  const scores = state.players.map((p) => {
    const keys = [...control].filter(([tile, owner]) => owner === p.id && state.map.nodes[tile].type === 'key').map(([t]) => t);
    const planetVp = keys.length * KEY_PLANET_VP;
    const deals = activeAgreements(state, p.id).length;
    awardVP(state, p.id, planetVp, 'planets');
    awardVP(state, p.id, deals * AGREEMENT_VP, 'agreements');
    return { player: p.id, keys, agreements: deals, vp: planetVp + deals * AGREEMENT_VP, total: p.vp };
  });
  for (const sc of scores) {
    if (sc.vp) log(state, `${state.players[sc.player].name} scores ${sc.vp} VP (${sc.keys.length} key planet${sc.keys.length === 1 ? '' : 's'}, ${sc.agreements} agreement${sc.agreements === 1 ? '' : 's'}).`);
  }
  const pirates = state.round >= PIRATE_START_ROUND
    ? piratePhase(state, destroyShip, (sh) => shipLabel(state, sh), (sh) => homeDefence(state, sh, []))
    : [];
  for (const e of pirates) log(state, e);
  updateControl(state);
  checkMissions(state);

  // Uncertain ending.
  const chance = END_CHANCE[state.settings?.length ?? 'standard'][state.round] ?? 0;
  const roll = chance > 0 ? withRng(state, (rng) => rng.next()) : null;
  const ends = chance >= 1 || (roll !== null && roll < chance);
  state.rounds.push({ round: state.round, scores, pirates, ending: { chance, roll, ends } });
  if (chance > 0) log(state, ends ? 'Imperial Ceasefire! The war is over.' : `The ceasefire talks fail (${END_ODDS_LABEL[chance]} chance). The war goes on.`);
  if (ends) {
    finalScoring(state);
    return;
  }
  state.round++;
  state.firstPlayer = (state.firstPlayer + 1) % state.players.length;
  state.turnInRound = 0;
  log(state, `Round ${state.round} begins. ${state.players[state.firstPlayer].name} goes first.`);
}

/** Final scoring: reveal end-of-game missions, then rank with tiebreakers. */
function finalScoring(state) {
  state.phase = 'over';
  state.pending = null;
  const control = controlMap(state);
  const keysOf = (pid) => [...control].filter(([t, o]) => o === pid && state.map.nodes[t].type === 'key').length;
  for (const p of state.players) {
    for (const m of p.missions) {
      const def = MISSIONS[m.id];
      if (m.scored || def.timing !== 'end') continue;
      m.revealed = true;
      if (missionDone(state, p, m.id)) {
        m.scored = true;
        awardVP(state, p.id, def.vp, 'missions');
        log(state, `${p.name} reveals ${def.name}: +${def.vp} VP.`);
      } else {
        m.failed = true;
      }
    }
  }
  const ranking = [...state.players].map((p) => ({
    player: p.id, vp: p.vp, keys: keysOf(p.id), ships: shipsOf(state, p.id).length,
  })).sort((a, b) => b.vp - a.vp || b.keys - a.keys || b.ships - a.ships);
  ranking.forEach((r, i) => {
    const prev = ranking[i - 1];
    r.place = prev && prev.vp === r.vp && prev.keys === r.keys && prev.ships === r.ships ? prev.place : i + 1;
    r.tiebreak = prev && prev.vp === r.vp ? (prev.keys !== r.keys ? 'key planets' : prev.ships !== r.ships ? 'ships on the board' : 'shared') : null;
  });
  state.final = { round: state.round, ranking };
  const top = ranking.filter((r) => r.place === 1).map((r) => state.players[r.player].name);
  log(state, top.length > 1 ? `${top.join(' and ')} share the win with ${ranking[0].vp} VP!` : `${top[0]} wins with ${ranking[0].vp} VP!`);
}

/** Reveal and score any immediate missions that are now complete. */
function checkMissions(state) {
  for (const p of state.players) {
    for (const m of p.missions) {
      const def = MISSIONS[m.id];
      if (m.scored || def.timing !== 'immediate') continue;
      if (missionDone(state, p, m.id)) {
        m.scored = true;
        m.revealed = true;
        awardVP(state, p.id, def.vp, 'missions');
        const text = `${p.name} completes the secret mission ${def.name}: +${def.vp} VP.`;
        log(state, text);
        state.notices.push({ kind: 'mission', player: p.id, mission: m.id, text });
      }
    }
  }
}

function requireTurn(state, player) {
  if (state.phase !== 'action') throw new GameError('The game is over.');
  if (state.pending) throw new GameError(`Waiting for ${state.players[state.pending.defender].name} to respond.`);
  if (state.players[player]?.missionOffer.length) throw new GameError('Choose your 2 secret missions first.');
  if (player !== state.active) throw new GameError(`It is ${state.players[state.active].name}'s turn.`);
}

function takeFromHand(state, player, card, type) {
  const p = state.players[player];
  if (!p.hand.includes(card)) throw new GameError('That card is not in your hand.');
  const def = cardDef(state.cards[card]);
  if (type && def.type !== type && !(Array.isArray(type) && type.includes(def.type))) throw new GameError(`${def.name} can't be played that way.`);
  p.hand.splice(p.hand.indexOf(card), 1);
  return def;
}

export function tileName(state, tile) {
  const n = state.map.nodes[tile];
  return n.name ?? ({ empty: 'open space', asteroid: 'an asteroid field', nebula: 'a nebula' }[n.type] ?? n.type);
}

/** A ship arriving on a hidden tile reveals it and triggers its contents. */
function revealHidden(state, ship) {
  const node = state.map.nodes[ship.tile];
  if (!node.hidden || node.revealed) return;
  node.revealed = true;
  const p = state.players[ship.owner];
  const eff = HIDDEN_EFFECT[node.hiddenContent];
  if (node.hiddenContent === 'derelict') p.credits += 2;
  if (node.hiddenContent === 'bonus') drawCards(state, p.id, 1);
  if (node.hiddenContent === 'pirateNest') {
    state.ships.push({ id: `s${state.nextId++}`, owner: 'pirate', type: 'pirate', tile: node.id, hull: PIRATE.hull, upgrades: [] });
  }
  fx(state, { kind: 'reveal', tile: node.id, content: node.hiddenContent, spawned: node.hiddenContent === 'pirateNest' ? state.ships.at(-1).id : null });
  state.lastMove?.events.push(`${eff.title}! ${eff.text}`);
  log(state, `${p.name} revealed a ${eff.title.toLowerCase()}: ${eff.text}`);
}

/** Tiles a player's ship can reach with a Move card right now. */
export function moveTargets(state, shipId, speedBonus = 0) {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.disabled) return new Map();
  return reachable(state, ship, shipStats(state, ship).speed + speedBonus);
}

// ---------------------------------------------------------------- combat

const shipById = (state, id) => state.ships.find((s) => s.id === id);
const shipLabel = (state, s) => (s.owner === 'pirate' ? 'pirate fleet' : `${state.players[s.owner].name}'s ${shipDef(s).name.toLowerCase()}`);

/** Why this upgrade can't go on this ship, or null. */
export function upgradeCheck(state, ship, defId) {
  const def = CARDS[defId];
  if (!def || def.type !== CARD_TYPE.UPGRADE) return 'Not an upgrade card.';
  const sd = SHIPS[ship.type];
  if (!sd) return 'Pirates cannot be upgraded.';
  if (ship.upgrades.length >= sd.slots) return `No free upgrade slot (${sd.name}: ${sd.slots}).`;
  if (ship.upgrades.some((u) => state.cards[u].def === defId)) return `Already fitted with ${def.name}.`;
  if (def.only && !def.only.includes(ship.type)) return `${def.name} only fits ${def.only.map((t) => SHIPS[t].name.toLowerCase() + 's').join(' and ')}.`;
  if (def.needs === 'laser' && !shipStats(state, ship).weapons.some((w) => w.type === 'laser')) return `${def.name} needs a laser weapon.`;
  return null;
}

/** Neighbouring tiles a ship can retreat to. */
export function retreatTiles(state, ship) {
  const index = new Map(state.map.nodes.map((n) => [hexKey(n.q, n.r), n.id]));
  const n = state.map.nodes[ship.tile];
  return neighbors(n.q, n.r).map((c) => index.get(hexKey(c.q, c.r)))
    .filter((id) => id !== undefined && state.map.nodes[id].type !== 'void');
}

/** Which reaction cards could answer this attack, and why not the others. */
export function reactionCheck(state, pendingInfo, cardUid) {
  const def = cardDef(state.cards[cardUid]);
  if (def.type !== CARD_TYPE.REACTION) return 'Not a reaction card.';
  const { kind } = pendingInfo;
  if (kind === 'ambush') return def.reaction === 'ambush' ? null : 'Only Ambush can be played when an enemy arrives.';
  if (def.reaction === 'ambush') return 'Ambush is played when an enemy moves onto your tile.';
  const atk = pendingInfo.attack;
  const target = shipById(state, atk.target);
  const attacker = shipById(state, atk.attacker);
  const weapon = shipStats(state, attacker).weapons[atk.weapon];
  if (def.reaction === 'evasive' && !shipStats(state, target).evasive) return 'Only fighters and frigates can make evasive maneuvers.';
  if (def.reaction === 'pointDefense' && weapon.type !== 'missile') return 'Point Defense only stops missiles.';
  if (def.reaction === 'returnFire') {
    const ts = shipStats(state, target);
    if (!ts.weapons.some((w) => inRange(state, target, w, attacker))) return 'Your ship has no weapon that can reach the attacker.';
    if (target.disabled) return 'Your ship is disabled.';
  }
  if (def.reaction === 'retreat' && !retreatTiles(state, target).length) return 'There is nowhere to retreat to.';
  return null;
}

/**
 * Home defences: an enemy ship (or pirate) ending a move in someone's home
 * sector takes HOME_DEFENCE damage. Returns false if the ship was destroyed.
 */
function homeDefence(state, ship, events) {
  const node = state.map.nodes[ship.tile];
  if (node.type !== 'home' || node.homeOf === ship.owner) return true;
  const owner = state.players[node.homeOf];
  fx(state, {
    kind: 'shot', from: node.id, to: node.id, weapon: 'cannon', damage: HOME_DEFENCE, ion: false,
    shooter: null, shooterOwner: node.homeOf, target: ship.id,
  });
  ship.hull -= HOME_DEFENCE;
  events.push(`${owner.name}'s home defences hit ${shipLabel(state, ship)} for ${HOME_DEFENCE}.`);
  log(state, `${owner.name}'s home defences hit ${shipLabel(state, ship)} for ${HOME_DEFENCE}.`);
  if (ship.hull <= 0) {
    destroyShip(state, ship.id, { cause: `by ${owner.name}'s home defences` });
    events.push(`${shipLabel(state, ship)} was destroyed.`);
    return false;
  }
  return true;
}

/** Enter a tile outside normal movement (retreat): nebula damage applies. */
function enterTile(state, ship, tile, events) {
  fx(state, { kind: 'move', ship: ship.id, path: [ship.tile, tile], nebulas: state.map.nodes[tile].type === 'nebula' ? [1] : [] });
  ship.tile = tile;
  if (state.map.nodes[tile].type === 'nebula') {
    ship.hull -= 1;
    events.push(`Nebula: ${shipLabel(state, ship)} takes 1 damage.`);
    if (ship.hull <= 0) {
      destroyShip(state, ship.id, { cause: 'in a nebula' });
      return false;
    }
  }
  return homeDefence(state, ship, events);
}

/** Fire one weapon from `shooter` at `target`. Returns the damage report. */
function fire(state, shooter, weaponIndex, target, opts, events) {
  const ws = shipStats(state, shooter);
  const weapon = ws.weapons[weaponIndex];
  const report = damageFor(weapon, ws, shipStats(state, target), opts);
  fx(state, {
    kind: 'shot', from: shooter.tile, to: target.tile, weapon: weapon.type, damage: report.damage, ion: report.ion,
    shooter: shooter.id, shooterOwner: shooter.owner, target: target.id,
  });
  if (report.ion) {
    target.disabled = state.turnNumber;
    events.push(`Ion strike: ${shipLabel(state, target)} is disabled for its next turn.`);
    return report;
  }
  target.hull -= report.damage;
  events.push(`${shipLabel(state, shooter)} hits ${shipLabel(state, target)} for ${report.damage} (${weapon.type} ${describeDamage(report)}).`);
  if (target.hull <= 0) {
    destroyShip(state, target.id, { by: shooter.owner });
    events.push(`${shipLabel(state, target)} destroyed!${shooter.owner !== 'pirate' ? ` +1 VP to ${state.players[shooter.owner].name}.` : ''}`);
    report.destroyed = true;
  }
  return report;
}

/** Resolve a declared attack, with the defender's reaction (or none). */
function resolveAttack(state, atk, reaction, retreatTo) {
  const attacker = shipById(state, atk.attacker);
  const target = shipById(state, atk.target);
  const events = [];
  const result = { attacker: atk.attacker, target: atk.target, reaction: reaction ? CARDS[reaction].name : null, events };
  state.lastCombat = result;
  const r = reaction ? CARDS[reaction].reaction : null;
  if (reaction) events.push(`${state.players[target.owner].name} reacts with ${CARDS[reaction].name}!`);
  const weapon = shipStats(state, attacker).weapons[atk.weapon];

  if (r === 'retreat') {
    events.push(`${shipLabel(state, target)} retreats to ${tileName(state, retreatTo)}. The attack misses.`);
    enterTile(state, target, retreatTo, events);
    return finish();
  }
  if (weapon.type === 'missile' && (r === 'pointDefense' || shipStats(state, target).pointDefense)) {
    events.push('Point defense shoots the missiles down. No damage.');
    return finish();
  }
  const report = fire(state, attacker, atk.weapon, target, {
    bonus: atk.bonus, extraShields: r === 'shields' ? EMERGENCY_SHIELDS : 0, evasive: r === 'evasive',
  }, events);
  result.damage = report.damage;
  result.destroyed = Boolean(report.destroyed);

  if (r === 'returnFire' && !report.destroyed && shipById(state, attacker.id)) {
    const ts = shipStats(state, target);
    const wi = ts.weapons.findIndex((w) => inRange(state, target, w, attacker));
    if (wi >= 0) {
      events.push('Return fire!');
      fire(state, target, wi, attacker, {}, events);
    }
  }
  return finish();

  function finish() {
    for (const e of events) log(state, e);
    return result;
  }
}

/** After a move: does an enemy on the destination hold cards for an Ambush? */
function checkAmbush(state, mover) {
  if (!shipById(state, mover.id)) return;
  const here = shipsAt(state, mover.tile).filter((s) => s.owner !== 'pirate' && s.owner !== mover.owner);
  const owners = turnOrder(state).filter((pid) => here.some((s) => s.owner === pid && shipStats(state, s).weapons.length && !s.disabled));
  const defender = owners.find((pid) => state.players[pid].reserve.length > 0);
  if (defender === undefined) return;
  state.pending = { kind: 'ambush', defender, mover: mover.id, tile: mover.tile };
}

// ---------------------------------------------------------------- actions

/**
 * Apply an action and return the new state. Throws GameError if illegal.
 * Actions:
 *   { type: 'deploy', player, card, tile }
 *   { type: 'playCredit', player, card }
 *   { type: 'move', player, card, ship, tile }
 *   { type: 'buy', player, def }
 *   { type: 'endTurn', player, keep: [cardUid, …] }
 *   { type: 'dev.setActive', player }            (sandbox, stage 2 only)
 *   { type: 'dev.giveCard', player, def }        (sandbox)
 *   { type: 'dev.placeShip', ship, tile }        (sandbox)
 */
export function applyAction(prev, action) {
  const state = structuredClone(prev);
  const handler = HANDLERS[action.type];
  if (!handler) throw new GameError(`Unknown action ${action.type}`);
  state.notices = [];
  state.fx = [];
  handler(state, action);
  updateControl(state);
  pruneRoutes(state, (t) => log(state, t));
  if (state.phase === 'action') checkMissions(state);
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
    fx(state, { kind: 'deploy', ship: state.ships.at(-1).id, tile, owner: player });
    log(state, `${p.name} deployed a ${SHIPS[def.ship].name.toLowerCase()} at ${state.map.nodes[tile].name ?? 'open space'}.`);
  },

  playCredit(state, { player, card, discard = null }) {
    requireTurn(state, player);
    const p = state.players[player];
    const pre = state.cards[card] && cardDef(state.cards[card]);
    if (pre?.discard && p.hand.length > 1) {
      if (!discard || discard === card || !p.hand.includes(discard)) throw new GameError(`${pre.name}: choose another card from your hand to discard.`);
    }
    const def = takeFromHand(state, player, card, CARD_TYPE.CREDIT);
    p.played.push(card);
    p.credits += def.credits;
    if (def.discard && discard && p.hand.includes(discard)) {
      p.hand.splice(p.hand.indexOf(discard), 1);
      p.discard.push(discard);
    }
  },

  chooseMissions(state, { player, keep }) {
    const p = state.players[player];
    if (!p.missionOffer.length) throw new GameError('Missions already chosen.');
    if (keep.length !== 2 || new Set(keep).size !== 2 || keep.some((m) => !p.missionOffer.includes(m))) throw new GameError('Keep exactly 2 of the 3 missions you were dealt.');
    p.missions = keep.map((id) => ({ id, scored: false }));
    p.missionOffer = [];
  },

  playUpgrade(state, { player, card, ship: shipId }) {
    requireTurn(state, player);
    const ship = shipById(state, shipId);
    if (!ship || ship.owner !== player) throw new GameError('Choose one of your own ships.');
    const why = upgradeCheck(state, ship, state.cards[card]?.def);
    if (why) throw new GameError(why);
    takeFromHand(state, player, card, CARD_TYPE.UPGRADE);
    ship.upgrades.push(card);
    log(state, `${state.players[player].name} fitted ${CARDS[state.cards[card].def].name} to a ${shipDef(ship).name.toLowerCase()}.`);
  },

  scrap(state, { player, card, target }) {
    requireTurn(state, player);
    const p = state.players[player];
    const pre = state.cards[card] && cardDef(state.cards[card]);
    if (!pre?.scrap) throw new GameError('That card cannot scrap.');
    if (!target || target === card || !p.hand.includes(target)) throw new GameError('Choose another card from your hand to scrap.');
    takeFromHand(state, player, card, CARD_TYPE.UTILITY);
    p.played.push(card);
    p.hand.splice(p.hand.indexOf(target), 1);
    state.scrapped.push(target);
    log(state, `${p.name} scrapped a ${CARDS[state.cards[target].def].name} card.`);
  },

  establishRoute(state, { player, ship: shipId, to }) {
    requireTurn(state, player);
    const ship = shipById(state, shipId);
    if (!ship || ship.owner !== player || !isTrader(ship)) throw new GameError('Only your freighters and blockade runners run trade routes.');
    const opt = routeOptions(state, ship).find((r) => r.to === to);
    if (!opt) throw new GameError('Choose another trade node within range (your ship must be on a trade node).');
    state.routes = state.routes.filter((r) => r.ship !== shipId);
    const label = `${tileName(state, ship.tile)} – ${tileName(state, to)}`;
    state.routes.push({ id: `r${state.nextId++}`, owner: player, ship: shipId, a: ship.tile, b: to, path: opt.path, length: opt.length, label });
    const p = state.players[player];
    p.longestRoute = Math.max(p.longestRoute, opt.length);
    log(state, `${p.name} set up a trade route ${label} (${opt.length} jump${opt.length === 1 ? '' : 's'}).`);
  },

  offerAgreement(state, { player, to }) {
    requireTurn(state, player);
    const why = offerCheck(state, player, to);
    if (why) throw new GameError(why);
    state.pending = { kind: 'offer', defender: to, from: player };
    log(state, `${state.players[player].name} offers a trade agreement to ${state.players[to].name}.`);
  },

  respondOffer(state, { player, accept }) {
    const pend = state.pending;
    if (!pend || pend.kind !== 'offer') throw new GameError('There is no offer to answer.');
    if (player !== pend.defender) throw new GameError(`Only ${state.players[pend.defender].name} can answer.`);
    state.pending = null;
    if (accept) {
      state.agreements.push({ id: `a${state.nextId++}`, a: pend.from, b: player });
      log(state, `${state.players[player].name} accepts: trade agreement signed with ${state.players[pend.from].name}.`);
    } else {
      log(state, `${state.players[player].name} declines the trade agreement.`);
    }
    state.lastOffer = { from: pend.from, to: player, accepted: Boolean(accept) };
  },

  breakAgreement(state, { player, with: other }) {
    requireTurn(state, player);
    const ag = agreementBetween(state, player, other);
    if (!ag) throw new GameError('You have no agreement with that player.');
    state.agreements = state.agreements.filter((a) => a !== ag);
    const p = state.players[player];
    p.credits += BREAK_BONUS;
    p.backstab = { target: other, until: state.turnNumber + state.players.length };
    log(state, `${p.name} breaks the trade agreement with ${state.players[other].name} (+${BREAK_BONUS} credits).`);
  },

  move(state, { player, card, ship: shipId, tile }) {
    requireTurn(state, player);
    const ship = state.ships.find((s) => s.id === shipId);
    if (!ship || ship.owner !== player) throw new GameError('Choose one of your own ships to move.');
    if (ship.disabled) throw new GameError('That ship is disabled this turn.');
    const p = state.players[player];
    const cardObj = state.cards[card];
    if (!p.hand.includes(card) || cardDef(cardObj).command !== 'move') throw new GameError('Play a Move card to move a ship.');
    const bonus = cardDef(cardObj).speedBonus ?? 0;
    const route = moveTargets(state, shipId, bonus).get(tile);
    if (!route) throw new GameError(`That tile is out of range (speed ${shipStats(state, ship).speed + bonus}).`);
    p.hand.splice(p.hand.indexOf(card), 1);
    p.played.push(card);
    const nodes = state.map.nodes;
    state.lastMove = { ship: shipId, path: route.path, events: [] };
    fx(state, { kind: 'move', ship: shipId, path: route.path, nebulas: route.path.map((t, i) => (i > 0 && nodes[t].type === 'nebula' ? i : -1)).filter((i) => i > 0) });
    for (const step of route.path.slice(1)) {
      ship.tile = step;
      if (nodes[step].type === 'nebula') {
        ship.hull -= 1;
        state.lastMove.events.push(`Nebula: −1 hull at ${tileName(state, step)}.`);
        if (ship.hull <= 0) {
          destroyShip(state, ship.id, { cause: 'in a nebula' });
          state.lastMove.events.push('The ship was lost in the nebula.');
          return;
        }
      }
    }
    log(state, `${p.name} moved a ${shipDef(ship).name.toLowerCase()} to ${tileName(state, tile)}.`);
    if (!homeDefence(state, ship, state.lastMove.events)) return;
    revealHidden(state, ship);
    checkAmbush(state, ship);
  },

  buy(state, { player, def }) {
    requireTurn(state, player);
    const p = state.players[player];
    // def is a Shipyard card id, or `market` is the uid of a Market Row card.
    const fromMarket = !SHIPYARD.includes(def);
    const uid = fromMarket ? def : null;
    if (fromMarket && !state.market.row.includes(uid)) throw new GameError('That card is not for sale.');
    const defId = fromMarket ? state.cards[uid].def : def;
    const price = buyPrice(state, player, defId);
    if (p.credits < price) throw new GameError(`${CARDS[defId].name} costs ${price}; you have ${p.credits} credit${p.credits === 1 ? '' : 's'}.`);
    p.credits -= price;
    p.spent += price;
    p.bestSpend = Math.max(p.bestSpend, p.spent);
    if (fromMarket) {
      const i = state.market.row.indexOf(uid);
      state.cards[uid].owner = player;
      p.discard.push(uid);
      // Replace the bought card immediately.
      if (state.market.deck.length) state.market.row[i] = state.market.deck.shift();
      else state.market.row.splice(i, 1);
    } else {
      p.discard.push(newCard(state, defId, player));
    }
    log(state, `${p.name} bought ${CARDS[defId].name} for ${price}.`);
  },

  attack(state, { player, card, ship: shipId, target: targetId, weapon = 0 }) {
    requireTurn(state, player);
    const ship = shipById(state, shipId);
    if (!ship || ship.owner !== player) throw new GameError('Choose one of your own ships to fire.');
    const why = cannotAttack(state, ship);
    if (why) throw new GameError(why);
    const target = shipById(state, targetId);
    if (!target || target.owner === player) throw new GameError('Choose an enemy ship or pirate fleet to attack.');
    const p = state.players[player];
    if (!p.hand.includes(card) || cardDef(state.cards[card]).command !== 'attack') throw new GameError('Play an Attack card to fire.');
    const opt = attackOptions(state, ship, cardDef(state.cards[card]).bonus ?? 0).find((o) => o.target.id === targetId && o.weapon === weapon);
    if (!opt) throw new GameError('That target is out of range.');
    p.hand.splice(p.hand.indexOf(card), 1);
    p.played.push(card);
    ship.firedTurn = state.turnNumber;
    const atk = { attacker: shipId, target: targetId, weapon, bonus: cardDef(state.cards[card]).bonus ?? 0 };
    log(state, `${p.name}'s ${shipDef(ship).name.toLowerCase()} attacks ${shipLabel(state, target)}.`);
    if (target.owner !== 'pirate' && state.players[target.owner].reserve.length > 0) {
      state.lastCombat = null;
      state.pending = { kind: 'reaction', defender: target.owner, attack: atk, preview: opt.preview };
      return;
    }
    resolveAttack(state, atk, null);
  },

  /** The defender answers a pending attack or ambush. card = null passes. */
  react(state, { player, card = null, tile = null, ship: ambusher = null }) {
    const pend = state.pending;
    if (!pend) throw new GameError('There is nothing to react to.');
    if (player !== pend.defender) throw new GameError(`Only ${state.players[pend.defender].name} can respond.`);
    const p = state.players[player];
    if (card !== null) {
      if (!p.reserve.includes(card)) throw new GameError('You can only react with a card you kept.');
      const why = reactionCheck(state, pend, card);
      if (why) throw new GameError(why);
    }
    const def = card ? cardDef(state.cards[card]) : null;
    if (pend.kind === 'reaction') {
      if (def?.reaction === 'retreat') {
        const target = shipById(state, pend.attack.target);
        if (!retreatTiles(state, target).includes(tile)) throw new GameError('Choose a neighbouring tile to retreat to.');
      }
      if (card) {
        p.reserve.splice(p.reserve.indexOf(card), 1);
        p.discard.push(card);
      }
      state.pending = null;
      resolveAttack(state, pend.attack, card ? state.cards[card].def : null, tile);
      return;
    }
    // Ambush
    state.pending = null;
    const mover = shipById(state, pend.mover);
    if (!card) {
      state.lastCombat = null;
      return;
    }
    const shooter = shipById(state, ambusher);
    if (!shooter || shooter.owner !== player || shooter.tile !== pend.tile || !shipStats(state, shooter).weapons.length) {
      state.pending = pend;
      throw new GameError('Choose one of your armed ships on that tile to spring the ambush.');
    }
    p.reserve.splice(p.reserve.indexOf(card), 1);
    p.discard.push(card);
    const events = [`${p.name} springs an ambush!`];
    fire(state, shooter, 0, mover, {}, events);
    state.lastCombat = { attacker: shooter.id, target: mover.id, reaction: 'Ambush', events };
    for (const e of events) log(state, e);
  },

  repair(state, { player, card, ship: shipId }) {
    requireTurn(state, player);
    const ship = shipById(state, shipId);
    if (!ship || ship.owner !== player) throw new GameError('Choose one of your own ships to repair.');
    const max = maxHull(ship);
    if (ship.hull >= max) throw new GameError('That ship is not damaged.');
    const def = takeFromHand(state, player, card, CARD_TYPE.UTILITY);
    if (!def.repair) throw new GameError(`${def.name} is not a repair card.`);
    const heal = Math.min(def.repair, max - ship.hull);
    ship.hull += heal;
    fx(state, { kind: 'repair', ship: ship.id, tile: ship.tile, amount: heal });
    state.players[player].played.push(card);
    log(state, `${state.players[player].name} repaired a ${shipDef(ship).name.toLowerCase()} (+${heal} hull).`);
  },

  endTurn(state, { player, keep = [] }) {
    requireTurn(state, player);
    const p = state.players[player];
    if (keep.length > MAX_KEEP) throw new GameError(`You can keep at most ${MAX_KEEP} cards.`);
    if (new Set(keep).size !== keep.length || keep.some((u) => !p.hand.includes(u))) throw new GameError('You can only keep cards from your hand.');
    p.discard.push(...p.played, ...p.hand.filter((u) => !keep.includes(u)));
    p.played = [];
    p.hand = [];
    p.reserve = [...keep]; // hidden from opponents; only the count is public
    if (p.credits > 0) log(state, `${p.name} lost ${p.credits} unspent credit${p.credits === 1 ? '' : 's'}.`);
    p.credits = 0;
    drawCards(state, player, HAND_SIZE - p.reserve.length);
    state.lastMove = null;
    state.lastCombat = null;
    // Ion-disabled ships recover once their owner has sat out a full turn.
    for (const s of shipsOf(state, player)) if (s.disabled !== undefined && s.disabled !== false && s.disabled < state.turnNumber) delete s.disabled;

    // Deep Strike: remember ships ending this turn in an enemy home sector.
    p.deepStrikeShips = shipsOf(state, player).filter((sh) => {
      const n = state.map.nodes[sh.tile];
      return n.type === 'home' && n.homeOf !== player;
    }).map((sh) => sh.id);

    state.turnInRound++;
    state.turnNumber++;
    if (state.turnInRound >= state.players.length) {
      endRound(state);
      if (state.phase === 'over') return;
    }
    else state.active = turnOrder(state)[state.turnInRound];
    if (state.turnInRound === 0) state.active = state.firstPlayer;
    startTurn(state);
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
    for (const zone of ['deck', 'hand', 'discard', 'played', 'reserve']) for (const uid of p[zone]) put(uid, `${p.id}.${zone}`);
  }
  for (const uid of state.market?.deck ?? []) put(uid, 'market deck');
  for (const uid of state.market?.row ?? []) put(uid, 'market row');
  for (const uid of state.scrapped ?? []) put(uid, 'scrapped');
  for (const s of state.ships) {
    if (s.card) put(s.card, `ship ${s.id}`);
    for (const u of s.upgrades) put(u, `ship ${s.id} upgrade`);
  }
  for (const uid of Object.keys(state.cards)) if (!where.has(uid)) throw new Error(`card ${uid} is nowhere`);
  return where;
}
