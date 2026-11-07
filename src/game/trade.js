// Trade routes and trade agreements (DESIGN.md "Trade and economy").
//
// Hex-board reading of the rules: a freighter or blockade runner standing on
// a trade node can set up a route to another trade node. The route is the
// shortest open path between them, and the ship must stay somewhere on that
// path to keep it running. Each of the owner's turns it pays +1 credit
// (+2 for a route of 3+ jumps, +1 more with a Cargo Pod), unless an enemy
// ship or pirate sits on any tile of the path (a blockade).
//
// A trade agreement links two players who both run a route: each gets
// +1 credit per turn and 1 VP per round while both still have a route.

import { tileGraph } from '../map/generator.js';
import { shortestPath } from '../map/graph.js';
import { SHIPS } from './ships.js';
import { shipStats } from './combat.js';

export const MAX_ROUTE_LENGTH = 8;
export const LONG_ROUTE = 3;
export const BREAK_BONUS = 2;

const graphCache = new Map();
function adjFor(map) {
  const k = `${map.seed}|${map.players}|${map.attempt}`;
  if (!graphCache.has(k)) graphCache.set(k, tileGraph(map.nodes).adj);
  return graphCache.get(k);
}

export const isTrader = (ship) => ship.owner !== 'pirate' && Boolean(SHIPS[ship.type]?.trader);

/** Possible routes for a trader standing on a trade node. */
export function routeOptions(state, ship) {
  if (!isTrader(ship) || state.map.nodes[ship.tile].type !== 'trade') return [];
  const adj = adjFor(state.map);
  return state.map.nodes
    .filter((n) => n.type === 'trade' && n.id !== ship.tile)
    .map((n) => {
      const path = shortestPath(adj, ship.tile, n.id);
      return path && { to: n.id, path, length: path.length - 1 };
    })
    .filter((r) => r && r.length <= MAX_ROUTE_LENGTH)
    .sort((a, b) => a.length - b.length);
}

/** Is the route blockaded (enemy ship or pirate on any tile of it)? */
export function blockaded(state, route) {
  const tiles = new Set(route.path);
  return state.ships.some((s) => tiles.has(s.tile) && s.owner !== route.owner);
}

export function routeIncome(state, route) {
  const ship = state.ships.find((s) => s.id === route.ship);
  let income = route.length >= LONG_ROUTE ? 2 : 1;
  if (ship && shipStats(state, ship).cargoPod) income += 1;
  return income;
}

/** Drop routes whose ship was destroyed or has left the route's path. */
export function pruneRoutes(state, log) {
  state.routes = state.routes.filter((r) => {
    const ship = state.ships.find((s) => s.id === r.ship);
    const ok = ship && r.path.includes(ship.tile);
    if (!ok) log?.(`${state.players[r.owner].name}'s trade route ${r.label} closed.`);
    return ok;
  });
}

export const routesOf = (state, pid) => state.routes.filter((r) => r.owner === pid);
export const activeRoutes = (state, pid) => routesOf(state, pid).filter((r) => !blockaded(state, r));

/** Agreements involving this player that are currently active. */
export function activeAgreements(state, pid) {
  return state.agreements.filter((a) => (a.a === pid || a.b === pid) && routesOf(state, a.a).length && routesOf(state, a.b).length);
}

export function agreementBetween(state, x, y) {
  return state.agreements.find((a) => (a.a === x && a.b === y) || (a.a === y && a.b === x));
}

/** Can `from` offer a trade agreement to `to`? Returns a reason or null. */
export function offerCheck(state, from, to) {
  if (from === to) return 'You cannot trade with yourself.';
  if (agreementBetween(state, from, to)) return 'You already have an agreement.';
  if (!routesOf(state, from).length) return 'You need a trade route of your own to link.';
  if (!routesOf(state, to).length) return `${state.players[to].name} has no trade route to link.`;
  return null;
}
