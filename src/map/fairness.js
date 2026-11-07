// Fairness checks from DESIGN.md "Guarantees for every map". These recompute
// everything from the finished map, independent of how it was generated, so
// they double as the acceptance test for the generator.

import { buildAdjacency, allPairs, components, betweenness } from './graph.js';
import { mapParams } from './generator.js';

/** How much more central than the average node a choke point must be. */
export const CHOKE_FACTOR = 1.5;

export function runFairnessChecks(map, assignFailure = null) {
  const p = mapParams(map.players);
  const n = map.nodes.length;
  const adj = buildAdjacency(n, map.lanes);
  const D = allPairs(adj);
  const idx = (pred) => map.nodes.filter(pred).map((nd) => nd.id ?? map.nodes.indexOf(nd));
  const homes = idx((nd) => nd.type === 'home');
  const keys = idx((nd) => nd.type === 'key');
  const centrals = idx((nd) => nd.central);
  const stations = idx((nd) => nd.type === 'station');
  const trades = idx((nd) => nd.type === 'trade');
  const chokes = idx((nd) => nd.type === 'intersection');
  const checks = [];
  const add = (id, label, pass, detail) => checks.push({ id, label, pass, detail });

  // Fully connected
  const { count } = components(adj);
  add('connected', 'Fully connected', count === 1,
    count === 1 ? 'Every node can reach every other node' : `${count} separate groups of nodes`);

  // No dead-end homes
  const exits = homes.map((h) => adj[h].length);
  add('exits', 'No dead-end homes', exits.length === p.players && exits.every((e) => e >= 2),
    `Home exit lanes: ${exits.join(', ')} (need 2+)`);

  // Fair homes: nearest key planet and nearest station at equal jumps.
  const nearest = (h, set) => (set.length ? Math.min(...set.map((v) => D[h][v])) : Infinity);
  const keyD = homes.map((h) => nearest(h, keys));
  const staD = homes.map((h) => nearest(h, stations));
  const fmt = (arr) => arr.map((d) => (d === Infinity ? '—' : d)).join(', ');
  const allEqual = (arr) => arr.length > 0 && arr.every((d) => d === arr[0] && Number.isFinite(d));
  add('fairKey', 'Fair homes: key planet', !assignFailure && allEqual(keyD),
    assignFailure ? assignFailure : `Jumps from each home to its nearest key planet: ${fmt(keyD)}`);
  add('fairStation', 'Fair homes: station', !assignFailure && allEqual(staD),
    assignFailure ? assignFailure : `Jumps from each home to its nearest station: ${fmt(staD)}`);

  // Contested center: the galactic core is roughly equidistant (±1 jump) from
  // every home; at 5–6 players every home is also equally close (±1) to its
  // nearest contested central planet.
  const core = idx((nd) => nd.core)[0];
  const coreD = core === undefined ? [] : homes.map((h) => D[h][core]);
  const nearCentral = homes.map((h) => nearest(h, centrals));
  const within1 = (arr) => arr.length > 0 && arr.every(Number.isFinite) && Math.max(...arr) - Math.min(...arr) <= 1;
  const range = (arr) => (arr.length ? `${Math.min(...arr)}–${Math.max(...arr)}`.replace(/^(\d+)–\1$/, '$1') : '—');
  const centerOk = centrals.length === p.centralCount && within1(coreD) && within1(nearCentral);
  add('center', 'Contested center', centerOk,
    `${centrals.length} central key planet${centrals.length === 1 ? '' : 's'} (need ${p.centralCount}); ` +
    `core is ${range(coreD)} jumps from every home` +
    (p.centralCount > 1 ? `, nearest central ${range(nearCentral)}` : ''));

  // Trade nodes scale: 2 per player + 1
  add('trade', 'Trade nodes scale', trades.length === p.tradeCount,
    `${trades.length} trade nodes (need ${p.tradeCount} = 2 × ${p.players} + 1)`);

  // Choke points: intersections that sit on many shortest paths.
  const bc = betweenness(adj);
  const mean = bc.reduce((s, x) => s + x, 0) / n;
  const strong = chokes.filter((v) => bc[v] >= CHOKE_FACTOR * mean);
  add('choke', 'Choke points', chokes.length >= p.chokeCount && strong.length === chokes.length,
    `${strong.length} of ${chokes.length} intersections sit on ${CHOKE_FACTOR}×+ the average share of shortest paths ` +
    `(need ${p.chokeCount})`);

  return checks;
}
