// CPU opponents.
//
// The AI picks one action at a time from the current state, so the UI can
// animate each step. It is a set of plain heuristics, not a search:
//
//   1. keep the 2 best secret missions;
//   2. deploy ship cards, fit upgrades, repair badly damaged ships;
//   3. fire at the best target in range (kills first);
//   4. set up trade routes, then move: freighters toward route spots,
//      warships toward key planets, stations, intersections and weak enemies;
//   5. scout the market and buy what helps most;
//   6. offer trade agreements, then end the turn keeping reaction cards.
//
// It also answers the prompts other players' actions raise: reactions to an
// attack, ambushes and trade offers.

import { allCosts } from '../map/generator.js';
import { CARDS, CARD_TYPE } from './cards.js';
import { SHIPS } from './ships.js';
import { MISSIONS } from './missions.js';
import { attackOptions, shipStats } from './combat.js';
import { routeOptions, routeIncome, isTrader, offerCheck, routesOf, isRouteEnd } from './trade.js';
import {
  applyAction, shipsAt, shipsOf, deployCheck, moveTargets, cpUsed, cpCapacity, controllerOf, buyPrice,
  upgradeCheck, reactionCheck, retreatTiles, SHIPYARD, handCredits, MAX_KEEP, HOME_DEFENCE, GameError,
} from './state.js';

const costCache = new Map();
function costsFor(map) {
  const k = `${map.seed}|${map.players}|${map.attempt}`;
  if (!costCache.has(k)) costCache.set(k, allCosts(map.nodes));
  return costCache.get(k);
}

const offered = new Map(); // `${seed}|${from}|${to}` -> round of the last offer

const def = (state, uid) => CARDS[state.cards[uid].def];
const hostile = (s, pid) => s.owner !== pid;
const armed = (state, s) => shipStats(state, s).weapons.length > 0;
const firepower = (state, s) => shipStats(state, s).weapons.reduce((m, w) => Math.max(m, w.type === 'ion' ? 0 : w.damage), 0);

/** Would this action be accepted? */
function legal(state, action) {
  try {
    applyAction(state, action);
    return true;
  } catch (e) {
    if (e instanceof GameError) return false;
    throw e;
  }
}

// ------------------------------------------------------------ evaluation

/** Places worth holding, and what they are worth to this player. */
function objectives(state, pid) {
  const out = [];
  for (const n of state.map.nodes) {
    const owner = controllerOf(state, n.id);
    if (owner === pid) continue;
    let v = 0;
    if (n.type === 'key') v = n.core || n.central ? 11 : 9;
    else if (n.type === 'station') v = 7;
    else if (n.type === 'intersection') v = 4;
    else if (n.type === 'trade') v = 2;
    else if (n.hidden && !n.revealed) v = 2;
    if (!v) continue;
    if (owner !== null) v += 1; // taking it from someone also hurts them
    out.push({ tile: n.id, v });
  }
  return out;
}

/** Enemy strength on a tile (sum of hull of ships not ours). */
const enemyHull = (state, tile, pid) => shipsAt(state, tile).filter((s) => hostile(s, pid)).reduce((t, s) => t + s.hull, 0);
const enemyFire = (state, tile, pid) => shipsAt(state, tile).filter((s) => hostile(s, pid)).reduce((t, s) => t + firepower(state, s), 0);

/** Threat next to a tile: enemy firepower on it or one step away. */
function threatNear(state, tile, pid) {
  const costs = costsFor(state.map)[tile];
  let t = 0;
  for (const s of state.ships) {
    if (!hostile(s, pid)) continue;
    if (costs[s.tile] <= 1) t += firepower(state, s) + 1;
  }
  return t;
}

/** How good it is for this ship to sit on `tile` (higher is better). */
function placeValue(state, ship, tile, objs) {
  const pid = ship.owner;
  const node = state.map.nodes[tile];
  const costs = costsFor(state.map)[tile];
  let v = 0;
  if (node.type === 'home' && node.homeOf !== pid) v -= ship.hull <= HOME_DEFENCE ? 30 : 6;
  if (node.type === 'nebula') v -= 1.5;

  if (isTrader(ship)) {
    const route = state.routes.find((r) => r.ship === ship.id);
    if (route) return route.path.includes(tile) ? 20 - threatNear(state, tile, pid) * 2 : -10;
    // Head for a spot where a route can start (not our own home).
    let best = -Infinity;
    for (const n of state.map.nodes) {
      if (!isRouteEnd(n) || (n.type === 'home' && n.homeOf === pid)) continue;
      const d = costs[n.id];
      if (!Number.isFinite(d)) continue;
      best = Math.max(best, (n.type === 'trade' ? 10 : 8) - d * 1.4);
    }
    return v + best - threatNear(state, tile, pid) * 2.5 - enemyHull(state, tile, pid) * 2;
  }

  // Warships: claim objectives, hunt weak enemies, avoid stronger stacks.
  const myFire = firepower(state, ship);
  let best = 0;
  for (const o of objs) {
    const d = costs[o.tile];
    if (!Number.isFinite(d)) continue;
    best = Math.max(best, o.v - d * 1.3);
  }
  v += best;
  const here = objs.find((o) => o.tile === tile);
  if (here) v += here.v * 0.6;
  const eh = enemyHull(state, tile, pid);
  if (eh) {
    const theirFire = enemyFire(state, tile, pid);
    v += myFire >= eh ? 6 : ship.hull > theirFire * 2 ? 2 : -6;
  }
  // Prefer to keep a guard on held key planets that enemies are next to.
  if (node.type === 'key' && controllerOf(state, tile) === pid && threatNear(state, tile, pid) > 0) v += 3;
  return v;
}

function bestRoute(state, ship) {
  const opts = routeOptions(state, ship).map((o) => {
    const blocked = o.path.some((t) => state.ships.some((s) => s.tile === t && hostile(s, ship.owner)));
    return { ...o, score: routeIncome(state, { ship: ship.id, length: o.length }) * 3 - (blocked ? 6 : 0) - o.length * 0.15 };
  });
  return opts.sort((a, b) => b.score - a.score)[0] ?? null;
}

// ------------------------------------------------------------ the turn

/**
 * The next action for CPU player `pid` on its own turn.
 * @returns {object} an action for applyAction (ends with an endTurn)
 */
export function nextAction(state, pid) {
  const p = state.players[pid];
  if (p.missionOffer.length) return { type: 'chooseMissions', player: pid, keep: chooseMissions(p) };
  const steps = [deployStep, upgradeStep, repairStep, attackStep, routeStep, moveStep, attackStep, routeStep, buyStep, offerStep];
  for (const step of steps) {
    const a = step(state, pid);
    if (a && legal(state, a)) return a;
  }
  return endTurnAction(state, pid);
}

/** The 2 secret missions a CPU player keeps. */
export function chooseMissions(p) {
  // Keep the two worth the most.
  return [...p.missionOffer].sort((a, b) => MISSIONS[b].vp - MISSIONS[a].vp).slice(0, 2);
}

function deployStep(state, pid) {
  const p = state.players[pid];
  const objs = objectives(state, pid);
  const cards = p.hand.filter((u) => def(state, u).type === CARD_TYPE.SHIP)
    .sort((a, b) => SHIPS[def(state, b).ship].cp - SHIPS[def(state, a).ship].cp);
  for (const card of cards) {
    const check = deployCheck(state, pid, card);
    if (!check.ok) continue;
    const ship = { id: '?', owner: pid, type: def(state, card).ship, hull: SHIPS[def(state, card).ship].hull, upgrades: [] };
    const tile = check.tiles.map((t) => [t, placeValue(state, ship, t, objs)]).sort((a, b) => b[1] - a[1])[0][0];
    return { type: 'deploy', player: pid, card, tile };
  }
  return null;
}

function upgradeStep(state, pid) {
  const p = state.players[pid];
  for (const card of p.hand.filter((u) => def(state, u).type === CARD_TYPE.UPGRADE)) {
    const d = def(state, card);
    const ships = shipsOf(state, pid).filter((s) => !upgradeCheck(state, s, state.cards[card].def));
    if (!ships.length) continue;
    const wantTrader = state.cards[card].def === 'cargo-pod';
    const best = ships.sort((a, b) => score(b) - score(a))[0];
    return { type: 'playUpgrade', player: pid, card, ship: best.id };
    function score(s) {
      if (wantTrader) return isTrader(s) ? 10 + (state.routes.some((r) => r.ship === s.id) ? 5 : 0) : -1;
      return (isTrader(s) ? -5 : 0) + SHIPS[s.type].hull + firepower(state, s) - s.upgrades.length * 2 + (d.upgradeKind === 'Weapon' && armed(state, s) ? 2 : 0);
    }
  }
  return null;
}

function repairStep(state, pid) {
  const p = state.players[pid];
  const card = p.hand.find((u) => def(state, u).repair);
  if (!card) return null;
  const amount = def(state, card).repair;
  const hurt = shipsOf(state, pid).map((s) => ({ s, missing: SHIPS[s.type].hull - s.hull }))
    .filter((x) => x.missing >= Math.min(2, amount)).sort((a, b) => b.missing - a.missing)[0];
  return hurt ? { type: 'repair', player: pid, card, ship: hurt.s.id } : null;
}

function attackStep(state, pid) {
  const p = state.players[pid];
  const cards = p.hand.filter((u) => def(state, u).command === 'attack').sort((a, b) => (def(state, b).bonus ?? 0) - (def(state, a).bonus ?? 0));
  if (!cards.length) return null;
  let best = null;
  for (const card of cards) {
    const bonus = def(state, card).bonus ?? 0;
    for (const ship of shipsOf(state, pid)) {
      for (const o of attackOptions(state, ship, bonus)) {
        const t = o.target;
        const partner = t.owner !== 'pirate' && state.agreements.some((a) => (a.a === pid && a.b === t.owner) || (a.b === pid && a.a === t.owner));
        let s;
        if (o.preview.ion) s = SHIPS[t.type] ? firepower(state, t) * 0.8 : 1;
        else {
          const kill = o.preview.damage >= t.hull;
          s = o.preview.damage * 2 + (kill ? 10 + (t.owner === 'pirate' ? 2 : (SHIPS[t.type]?.cost ?? 2)) : 0);
          if (isTrader(t)) s += 3;
        }
        if (partner && !(o.preview.damage >= t.hull)) s -= 8; // don't sour a deal for a scratch
        if (bonus && !(o.preview.damage >= t.hull)) s -= 1; // save Focused Strike for a kill
        if (s > 1 && (!best || s > best.s)) best = { s, action: { type: 'attack', player: pid, card, ship: ship.id, target: t.id, weapon: o.weapon } };
      }
    }
  }
  return best?.action ?? null;
}

function routeStep(state, pid) {
  for (const ship of shipsOf(state, pid).filter(isTrader)) {
    const cur = state.routes.find((r) => r.ship === ship.id);
    const opt = bestRoute(state, ship);
    if (!opt) continue;
    const curIncome = cur ? routeIncome(state, cur) : 0;
    if (!cur || routeIncome(state, { ship: ship.id, length: opt.length }) > curIncome) {
      return { type: 'establishRoute', player: pid, ship: ship.id, to: opt.to };
    }
  }
  return null;
}

function moveStep(state, pid) {
  const p = state.players[pid];
  const cards = p.hand.filter((u) => def(state, u).command === 'move');
  if (!cards.length) return null;
  const objs = objectives(state, pid);
  let best = null;
  for (const card of cards) {
    const bonus = def(state, card).speedBonus ?? 0;
    for (const ship of shipsOf(state, pid)) {
      const here = placeValue(state, ship, ship.tile, objs);
      // Getting trade running matters most: traders without a route move first.
      const weight = isTrader(ship) && !state.routes.some((r) => r.ship === ship.id) ? 3 : 1;
      for (const [tile, r] of moveTargets(state, ship.id, bonus)) {
        const gain = (placeValue(state, ship, tile, objs) - here) * weight - r.nebulas * 2 - (bonus ? 0.4 : 0);
        if (gain > 0.5 && (!best || gain > best.gain)) best = { gain, action: { type: 'move', player: pid, card, ship: ship.id, tile } };
      }
    }
  }
  return best?.action ?? null;
}

/** How much this player wants a card (0 = not at all). */
function want(state, pid, defId) {
  const c = CARDS[defId];
  const ships = shipsOf(state, pid);
  const round = state.round;
  if (c.type === CARD_TYPE.SHIP) {
    const s = SHIPS[c.ship];
    const p = state.players[pid];
    const plannedCards = [...p.deck, ...p.hand, ...p.discard, ...p.reserve, ...p.played]
      .map((u) => CARDS[state.cards[u].def]).filter((d) => d.type === CARD_TYPE.SHIP);
    const planned = plannedCards.reduce((t, d) => t + SHIPS[d.ship].cp, 0);
    if (cpUsed(state, pid) + planned + s.cp > cpCapacity(state, pid).total) return 0;
    if (s.trader) {
      const traders = ships.filter(isTrader).length + plannedCards.filter((d) => SHIPS[d.ship].trader).length;
      return traders < 2 ? 8 : traders < 3 && round >= 3 ? 4 : 1;
    }
    const same = ships.filter((x) => x.type === c.ship).length + plannedCards.filter((d) => d.ship === c.ship).length;
    const base = { fighter: 3.5, frigate: 7, destroyer: 9, corvette: 6, interceptor: 6, carrier: 6 }[c.ship] ?? 5;
    return base - same * (c.ship === 'fighter' ? 1 : 0.6);
  }
  if (c.type === CARD_TYPE.CREDIT) {
    if (defId === 'credits') return round <= 3 ? 2.5 : 1;
    return round <= 6 ? 6 : 3;
  }
  if (c.type === CARD_TYPE.UPGRADE) {
    const fits = ships.filter((s) => !upgradeCheck(state, s, defId));
    if (!fits.length) return 0;
    if (defId === 'cargo-pod') return fits.some((s) => state.routes.some((r) => r.ship === s.id)) ? 5 : 2;
    return c.upgradeKind === 'Weapon' ? 5 : 4;
  }
  if (c.command === 'attack') return 4;
  if (c.command === 'move') return 3;
  if (c.type === CARD_TYPE.REACTION) return defId === 'point-defense' ? 1.5 : 3;
  if (c.repair) return ships.some((s) => SHIPS[s.type].hull - s.hull >= 2) ? 4 : 1.5;
  return 1;
}

function buyStep(state, pid) {
  const p = state.players[pid];
  const budget = p.credits + handCredits(state, pid);
  if (p.scoutTurn !== state.turnNumber && state.market.deck.length && budget >= 2 && !p.scout) return { type: 'scout', player: pid };
  if (budget <= 0) return null;
  const offers = [
    ...SHIPYARD.map((d) => ({ def: d, buy: d })),
    ...state.market.row.map((u) => ({ def: state.cards[u].def, buy: u })),
    ...(p.scout ? [{ def: state.cards[p.scout].def, buy: p.scout }] : []),
  ];
  let best = null;
  for (const o of offers) {
    const price = buyPrice(state, pid, o.def);
    if (price > budget) continue;
    const w = want(state, pid, o.def);
    if (w <= 1) continue;
    const s = w + price * 0.35; // pricier cards are usually stronger
    if (!best || s > best.s) best = { s, o };
  }
  return best ? { type: 'buy', player: pid, def: best.o.buy, autoPay: true } : null;
}

function offerStep(state, pid) {
  if (!routesOf(state, pid).length) return null;
  const me = state.players[pid];
  for (const o of state.players) {
    if (o.id === pid || offerCheck(state, pid, o.id)) continue;
    const k = `${state.seed}|${pid}|${o.id}`;
    if (offered.has(k) && state.round - offered.get(k) < 3) continue;
    if (o.vp > me.vp + 4) continue; // don't feed the leader
    offered.set(k, state.round);
    return { type: 'offerAgreement', player: pid, to: o.id };
  }
  return null;
}

function endTurnAction(state, pid) {
  const p = state.players[pid];
  const rank = (u) => ({ retreat: 6, shields: 5, returnFire: 5, evasive: 4, ambush: 4, pointDefense: 2 }[def(state, u).reaction] ?? 0);
  const keep = p.hand.filter((u) => def(state, u).type === CARD_TYPE.REACTION).sort((a, b) => rank(b) - rank(a)).slice(0, MAX_KEEP);
  return { type: 'endTurn', player: pid, keep };
}

// ------------------------------------------------------------ answers

/** Answer a pending attack, ambush or offer aimed at CPU player `pid`. */
export function respond(state, pid) {
  const pend = state.pending;
  if (!pend || pend.defender !== pid) return null;
  if (pend.kind === 'offer') {
    const from = state.players[pend.from];
    const accept = routesOf(state, pid).length > 0 && from.vp <= state.players[pid].vp + 5;
    return { type: 'respondOffer', player: pid, accept };
  }
  const p = state.players[pid];
  const usable = p.reserve.filter((u) => !reactionCheck(state, pend, u));
  if (pend.kind === 'ambush') {
    const card = usable.find((u) => def(state, u).reaction === 'ambush');
    const shooter = shipsAt(state, pend.tile).filter((s) => s.owner === pid && armed(state, s) && s.disabled === undefined)
      .sort((a, b) => firepower(state, b) - firepower(state, a))[0];
    return card && shooter ? { type: 'react', player: pid, card, ship: shooter.id } : { type: 'react', player: pid, card: null };
  }
  // An attack on one of our ships.
  const target = state.ships.find((s) => s.id === pend.attack.target);
  const dmg = pend.preview.ion ? 0 : pend.preview.damage;
  const lethal = dmg >= target.hull;
  const of = (kind) => usable.find((u) => def(state, u).reaction === kind);
  const pick = (card, extra = {}) => ({ type: 'react', player: pid, card, ...extra });
  if (of('pointDefense')) return pick(of('pointDefense'));
  if (lethal) {
    const r = of('retreat');
    if (r) {
      const safe = retreatTiles(state, target).filter((t) => !state.ships.some((s) => s.tile === t && hostile(s, pid))
        && !(state.map.nodes[t].type === 'nebula' && target.hull <= 1));
      if (safe.length) return pick(r, { tile: safe[0] });
    }
    if (of('shields') && dmg - 3 < target.hull) return pick(of('shields'));
    if (of('evasive') && dmg - 2 < target.hull) return pick(of('evasive'));
  }
  if (of('returnFire') && !lethal) return pick(of('returnFire'));
  if (dmg >= 3 && of('shields')) return pick(of('shields'));
  return pick(null);
}

/** Is this player run by the computer? */
export const isCpu = (state, pid) => Boolean(state.players[pid]?.cpu);
