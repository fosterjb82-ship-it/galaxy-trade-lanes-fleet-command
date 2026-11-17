// End-of-round pirate phase: each neutral pirate fleet moves 1 tile toward
// the nearest freighter or blockade runner, then attacks a player ship on
// its tile (traders first, then the most damaged). Pirates are automated, so
// defenders don't get reaction prompts against them.

import { tileGraph } from '../map/generator.js';
import { bfs } from '../map/graph.js';
import { shipStats, damageFor } from './combat.js';
import { isTrader } from './trade.js';

const graphCache = new Map();
function adjFor(map) {
  const k = `${map.seed}|${map.players}|${map.attempt}`;
  if (!graphCache.has(k)) graphCache.set(k, tileGraph(map.nodes).adj);
  return graphCache.get(k);
}

/**
 * @param {object} state
 * @param {(state, shipId, opts) => void} destroyShip
 * @param {(name: string) => string} label  ship description for the log
 * @param {(pirate) => boolean} onArrive  called after a move; false if the pirate was destroyed
 * @returns {string[]} events
 */
export function piratePhase(state, destroyShip, label, onArrive = () => true) {
  const events = [];
  const adj = adjFor(state.map);
  const pirates = state.ships.filter((s) => s.owner === 'pirate').map((s) => s.id);
  for (const id of pirates) {
    const pirate = state.ships.find((s) => s.id === id);
    if (!pirate) continue;
    const traders = state.ships.filter(isTrader);
    if (traders.length) {
      const dist = bfs(adj, pirate.tile);
      const target = traders.filter((t) => Number.isFinite(dist[t.tile])).sort((a, b) => dist[a.tile] - dist[b.tile])[0];
      if (target && dist[target.tile] > 0) {
        // Step to the neighbour closest to the target.
        const toTarget = bfs(adj, target.tile);
        const step = adj[pirate.tile].filter((n) => toTarget[n] < toTarget[pirate.tile]).sort((a, b) => toTarget[a] - toTarget[b])[0];
        if (step !== undefined) {
          (state.fx ??= []).push({ kind: 'move', ship: pirate.id, path: [pirate.tile, step], nebulas: [] });
          pirate.tile = step;
          events.push(`A pirate fleet moves toward ${label(target)}.`);
          if (!onArrive(pirate)) continue; // shot down by home defences
        }
      }
    }
    const victims = state.ships.filter((s) => s.tile === pirate.tile && s.owner !== 'pirate');
    if (!victims.length) continue;
    const victim = victims.sort((a, b) => (isTrader(b) - isTrader(a)) || a.hull - b.hull)[0];
    const ps = shipStats(state, pirate);
    const r = damageFor(ps.weapons[0], ps, shipStats(state, victim));
    (state.fx ??= []).push({
      kind: 'shot', from: pirate.tile, to: victim.tile, weapon: ps.weapons[0].type, damage: r.damage, ion: false,
      shooter: pirate.id, shooterOwner: 'pirate', target: victim.id,
    });
    victim.hull -= r.damage;
    events.push(`Pirates attack ${label(victim)} for ${r.damage}.`);
    if (victim.hull <= 0) {
      events.push(`${label(victim)} was destroyed by pirates.`);
      destroyShip(state, victim.id, { by: 'pirate', cause: 'by pirates' });
    }
  }
  return events;
}
