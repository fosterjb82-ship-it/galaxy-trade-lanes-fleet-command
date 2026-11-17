// Ship movement on the hex board.
//
// A Move card moves one ship up to its speed. Entering a tile costs its
// movement cost (asteroid fields 2, everything else 1; void is impassable).
// A ship may enter a tile holding enemy ships or pirates, but must stop
// there: it can't fly through an occupied tile, which makes choke points
// worth holding. Nebulas deal 1 damage to a ship each time it enters one.

import { tileGraph } from '../map/generator.js';
import { shipDef } from './ships.js';

const graphCache = new Map();

function graphFor(map) {
  const k = `${map.seed}|${map.players}|${map.attempt}`;
  if (!graphCache.has(k)) graphCache.set(k, tileGraph(map.nodes));
  return graphCache.get(k);
}

/** Is there a ship on this tile that isn't the mover's (incl. pirates)? */
function hostileAt(state, tile, owner) {
  return state.ships.some((s) => s.tile === tile && s.owner !== owner);
}

/**
 * Tiles a ship can reach this move, cheapest path first, fewest nebulas second.
 * @returns {Map<number, { cost: number, nebulas: number, path: number[] }>}
 */
export function reachable(state, ship, speed = shipDef(ship).speed) {
  const { adj, cost } = graphFor(state.map);
  const nodes = state.map.nodes;
  const best = new Map([[ship.tile, { cost: 0, nebulas: 0, path: [ship.tile] }]]);
  const better = (a, b) => !b || a.cost < b.cost || (a.cost === b.cost && a.nebulas < b.nebulas);
  const frontier = [ship.tile];
  while (frontier.length) {
    // Small graphs: pick the cheapest frontier entry each time.
    frontier.sort((a, b) => best.get(a).cost - best.get(b).cost || best.get(a).nebulas - best.get(b).nebulas);
    const u = frontier.shift();
    const cur = best.get(u);
    if (u !== ship.tile && hostileAt(state, u, ship.owner)) continue; // must stop here
    for (const v of adj[u]) {
      const c = cur.cost + cost[v];
      if (c > speed) continue;
      const next = { cost: c, nebulas: cur.nebulas + (nodes[v].type === 'nebula' ? 1 : 0), path: [...cur.path, v] };
      if (better(next, best.get(v))) {
        best.set(v, next);
        if (!frontier.includes(v)) frontier.push(v);
      }
    }
  }
  best.delete(ship.tile);
  return best;
}
