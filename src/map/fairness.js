// Fairness checks from DESIGN.md "Guarantees for every map", measured on the
// hex board in movement cost (asteroid tiles cost 2, void is impassable).
// They recompute everything from the finished map, independent of how it was
// generated, so they double as the acceptance test for the generator.

import { components, betweenness } from './graph.js';
import { mapParams, tileGraph, allCosts } from './generator.js';

/** How much more central than the average tile a choke point must be. */
export const CHOKE_FACTOR = 1.5;

export function runFairnessChecks(map, assignFailure = null) {
  const p = mapParams(map.players);
  const nodes = map.nodes;
  const { adj, cost } = tileGraph(nodes);
  const D = allCosts(nodes);
  const ids = (pred) => nodes.filter(pred).map((n) => n.id);
  const passable = ids((n) => cost[n.id] !== Infinity);
  const homes = ids((n) => n.type === 'home');
  const keys = ids((n) => n.type === 'key');
  const centrals = ids((n) => n.central);
  const stations = ids((n) => n.type === 'station');
  const trades = ids((n) => n.type === 'trade');
  const chokes = ids((n) => n.type === 'intersection');
  const checks = [];
  const add = (id, label, pass, detail) => checks.push({ id, label, pass, detail });

  // Fully connected (over passable tiles).
  const { comp } = components(adj);
  const groups = new Set(passable.map((i) => comp[i])).size;
  add('connected', 'Fully connected', groups === 1,
    groups === 1 ? `All ${passable.length} open tiles reach each other` : `${groups} separate regions`);

  // No dead-end homes: at least 2 open neighbouring tiles.
  const exits = homes.map((h) => adj[h].length);
  add('exits', 'No dead-end homes', exits.length === p.players && exits.every((e) => e >= 2),
    `Open exits from each home: ${exits.join(', ')} (need 2+)`);

  // Fair homes: nearest key planet and nearest station at equal cost.
  const nearest = (h, set) => (set.length ? Math.min(...set.map((v) => D[h][v])) : Infinity);
  const keyD = homes.map((h) => nearest(h, keys));
  const staD = homes.map((h) => nearest(h, stations));
  const fmt = (arr) => arr.map((d) => (d === Infinity ? '—' : d)).join(', ');
  const allEqual = (arr) => arr.length > 0 && arr.every((d) => d === arr[0] && Number.isFinite(d));
  add('fairKey', 'Fair homes: key planet', !assignFailure && allEqual(keyD),
    assignFailure ?? `Moves from each home to its nearest key planet: ${fmt(keyD)}`);
  add('fairStation', 'Fair homes: station', !assignFailure && allEqual(staD),
    assignFailure ?? `Moves from each home to its nearest station: ${fmt(staD)}`);

  // Contested center: the galactic core is roughly equidistant (±1) from
  // every home; at 5–6 players every home is also equally close (±1) to its
  // nearest contested central planet.
  const core = ids((n) => n.core)[0];
  const coreD = core === undefined ? [] : homes.map((h) => D[h][core]);
  const nearCentral = homes.map((h) => nearest(h, centrals));
  const within1 = (arr) => arr.length > 0 && arr.every(Number.isFinite) && Math.max(...arr) - Math.min(...arr) <= 1;
  const range = (arr) => (arr.length ? `${Math.min(...arr)}–${Math.max(...arr)}`.replace(/^(\d+)–\1$/, '$1') : '—');
  add('center', 'Contested center',
    centrals.length === p.centralCount && within1(coreD) && within1(nearCentral),
    `${centrals.length} central key planet${centrals.length === 1 ? '' : 's'} (need ${p.centralCount}); ` +
    `core is ${range(coreD)} moves from every home` +
    (p.centralCount > 1 ? `, nearest central ${range(nearCentral)}` : ''));

  // Trade nodes scale: 2 per player + 1
  add('trade', 'Trade nodes scale', trades.length === p.tradeCount,
    `${trades.length} trade nodes (need ${p.tradeCount} = 2 × ${p.players} + 1)`);

  // Choke points: intersections that sit on many shortest paths.
  const bc = betweenness(adj);
  const mean = passable.reduce((s, i) => s + bc[i], 0) / passable.length;
  const strong = chokes.filter((v) => bc[v] >= CHOKE_FACTOR * mean);
  add('choke', 'Choke points', chokes.length >= p.chokeCount && strong.length === chokes.length,
    `${strong.length} of ${chokes.length} intersections carry ${CHOKE_FACTOR}×+ the average traffic ` +
    `of shortest paths (need ${p.chokeCount})`);

  return checks;
}
