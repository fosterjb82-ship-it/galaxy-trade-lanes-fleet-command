// Hex-board map generator for Fleet Command. Every space is a hex tile and
// ships move between tiles that share an edge. Follows the generation steps
// in DESIGN.md, adapted to a hex board:
//   1. Place home sectors evenly around the edge.
//   2. Place the central key planet(s).
//   3. Scatter terrain (void rifts, asteroid fields, nebulas) with minimum
//      spacing, mirrored into every player's wedge.
//   4. Keep the board fully connected (cut-off pockets become void).
//   5. Assign tile types following the guarantees.
//   6. Run the fairness checks; if any fail, discard and regenerate.
//
// The same (seed, players) pair always produces the same map, including the
// number of rejected attempts, so seeds can be shared.

import { Rng } from '../rng.js';
import { betweenness, components, dijkstra } from './graph.js';
import {
  hexagon, key, neighbors, hexDistance, toPixel, rotateCell, polarCell, TILE_W, TILE_H,
} from './hex.js';
import { runFairnessChecks } from './fairness.js';

export const NODE = {
  HOME: 'home',
  KEY: 'key',
  INTERSECTION: 'intersection',
  STATION: 'station',
  TRADE: 'trade',
  EMPTY: 'empty',
  ASTEROID: 'asteroid', // costs 2 movement to enter
  NEBULA: 'nebula', // 1 damage to a ship entering it
  VOID: 'void', // impassable rift
};

export const HIDDEN = {
  DERELICT: 'derelict', // salvage: bonus credits
  PIRATE_NEST: 'pirateNest', // spawns a pirate fleet
  BONUS: 'bonus', // draw extra cards
};

/** Movement cost to enter a tile of each type. */
export function enterCost(type) {
  if (type === NODE.VOID) return Infinity;
  if (type === NODE.ASTEROID) return 2;
  return 1;
}

/** Map size and composition per player count. */
export function mapParams(players) {
  if (players < 2 || players > 6) throw new Error('Fleet Command supports 2–6 players');
  return {
    players,
    radius: { 2: 4, 3: 5, 4: 5, 5: 6, 6: 6 }[players],
    centralCount: players <= 4 ? 1 : players - 3, // 5p: 2, 6p: 3
    tradeCount: 2 * players + 1,
    chokeCount: players <= 4 ? 3 : 4,
    pirateCount: players <= 3 ? 2 : players <= 5 ? 3 : 4,
    voidShare: 0.14,
    hazardShare: 0.09,
  };
}

// ---------------------------------------------------------------- symmetry
//
// Each player's wedge is a copy of player 0's wedge. For 2, 3 and 6 players
// the copies are exact hex rotations; for 4 players they are the board's two
// mirror reflections; for 5 players rotations by 72° snap to the grid.

const reflectX = (c) => ({ q: -c.q - c.r, r: c.r }); // x -> -x
const reflectY = (c) => ({ q: c.q + c.r, r: -c.r }); // y -> -y

function symmetry(players) {
  if (players === 4) {
    return { homeAngle: Math.PI / 6, transforms: [(c) => c, reflectX, (c) => reflectX(reflectY(c)), reflectY] };
  }
  const step = (Math.PI * 2) / players;
  return {
    homeAngle: 0,
    transforms: Array.from({ length: players }, (_, i) => (c) => rotateCell(c, i * step)),
  };
}

const angleOf = (c) => Math.atan2(1.5 * c.r, Math.sqrt(3) * (c.q + c.r / 2));

const SYL_A = ['Ar', 'Bel', 'Cor', 'Dra', 'El', 'Fen', 'Gal', 'Hel', 'Ix', 'Jor', 'Kel', 'Lum', 'Mor',
  'Nex', 'Or', 'Pyr', 'Quo', 'Rhe', 'Sol', 'Tal', 'Ul', 'Vor', 'Xan', 'Zeb'];
const SYL_B = ['ax', 'is', 'on', 'ara', 'eth', 'ion', 'os', 'una', 'ar', 'ix', 'or', 'ea', 'yn', 'um'];
const SUFFIX = ['', '', '', ' Prime', ' II', ' IV', ' Reach', ' Gate', ' Drift', ' Point'];

function makeNames(rng, count) {
  const used = new Set();
  const out = [];
  while (out.length < count) {
    const name = rng.pick(SYL_A) + rng.pick(SYL_B) + rng.pick(SUFFIX);
    if (!used.has(name)) {
      used.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Adjacency (passable tiles only) and entry costs for a list of tiles. */
export function tileGraph(nodes) {
  const index = new Map(nodes.map((n) => [key(n.q, n.r), n.id]));
  const cost = nodes.map((n) => enterCost(n.type));
  const adj = nodes.map((n) => {
    if (cost[n.id] === Infinity) return [];
    return neighbors(n.q, n.r)
      .map((c) => index.get(key(c.q, c.r)))
      .filter((id) => id !== undefined && cost[id] !== Infinity);
  });
  return { adj, cost, index };
}

/** All-pairs movement-cost distances. */
export function allCosts(nodes) {
  const { adj, cost } = tileGraph(nodes);
  return nodes.map((n) => (cost[n.id] === Infinity ? nodes.map(() => Infinity) : dijkstra(adj, cost, n.id)));
}

// ---------------------------------------------------------------- generation

export function generateCandidate(seed, players, attempt) {
  const p = mapParams(players);
  const rng = new Rng(`${seed}|${players}|${attempt}`);
  const sym = symmetry(players);
  const cells = hexagon(p.radius);
  const nodes = cells.map((c, id) => ({ id, q: c.q, r: c.r, type: NODE.EMPTY }));
  const at = new Map(nodes.map((n) => [key(n.q, n.r), n]));
  const get = (c) => at.get(key(c.q, c.r));
  const onBoard = (c) => at.has(key(c.q, c.r));

  // 1. Homes on the rim.
  let home0 = polarCell(sym.homeAngle, p.radius);
  for (let d = p.radius; !onBoard(home0); d -= 0.25) home0 = polarCell(sym.homeAngle, d);
  const homes = sym.transforms.map((t, i) => {
    let c = t(home0);
    if (!onBoard(c)) c = polarCell(angleOf(c), p.radius - 1);
    const n = get(c);
    n.type = NODE.HOME;
    n.homeOf = i;
    return n;
  });
  if (new Set(homes).size !== players) throw new Error('homes overlap');

  // 2. Central key planet(s): the galactic core at the centre, flanked by
  //    1–2 more contested key planets right next to it at 5–6 players.
  const core = get({ q: 0, r: 0 });
  Object.assign(core, { type: NODE.KEY, central: true, core: true });
  const centrals = [core];
  if (p.centralCount > 1) {
    const dir = rng.int(0, 5);
    const offsets = p.centralCount === 2 ? [dir] : [dir, (dir + 3) % 6];
    for (const o of offsets) {
      const c = neighbors(0, 0)[o];
      const n = get(c); // adjacent to the core: a contested central cluster
      Object.assign(n, { type: NODE.KEY, central: true });
      centrals.push(n);
    }
  }

  // 3. Terrain scattered in player 0's wedge and mirrored into every wedge.
  const half = Math.PI / players;
  const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const home0Angle = angleOf(homes[0]);
  const wedge = cells.filter((c) => (c.q || c.r) && angDiff(angleOf(c), home0Angle) <= half);
  const tooClose = (c) =>
    homes.some((h) => hexDistance(h, c) < 2) || centrals.some((k) => hexDistance(k, c) < 2);
  const placeMirrored = (cell, type) => {
    for (const t of sym.transforms) {
      const n = get(t(cell));
      if (n && n.type === NODE.EMPTY && !tooClose(n)) n.type = type;
    }
  };
  const perWedge = cells.length / players;
  const voidTarget = Math.round(perWedge * p.voidShare);
  const hazardTarget = Math.round(perWedge * p.hazardShare);
  let voids = 0;
  for (let guard = 0; voids < voidTarget && guard < 200; guard++) {
    // A rift is a short random walk of 1–3 tiles.
    let c = rng.pick(wedge);
    if (tooClose(c) || get(c).type !== NODE.EMPTY) continue;
    const len = rng.int(1, 3);
    for (let i = 0; i < len && voids < voidTarget; i++) {
      if (get(c)?.type === NODE.EMPTY && !tooClose(c)) {
        placeMirrored(c, NODE.VOID);
        voids++;
      }
      c = rng.pick(neighbors(c.q, c.r));
      if (!onBoard(c)) break;
    }
  }
  let hazards = 0;
  for (let guard = 0; hazards < hazardTarget && guard < 200; guard++) {
    const c = rng.pick(wedge);
    if (tooClose(c) || get(c).type !== NODE.EMPTY) continue;
    // Minimum spacing between hazards so they don't merge into walls.
    if (nodes.some((n) => (n.type === NODE.ASTEROID || n.type === NODE.NEBULA) && hexDistance(n, c) < 2)) continue;
    placeMirrored(c, rng.chance(0.5) ? NODE.ASTEROID : NODE.NEBULA);
    hazards++;
  }

  // 4. Fully connected: pockets cut off from player 1's home become void.
  {
    const { adj } = tileGraph(nodes);
    const { comp } = components(adj);
    const main = comp[homes[0].id];
    for (const n of nodes) if (n.type !== NODE.VOID && comp[n.id] !== main) n.type = NODE.VOID;
  }

  // 5. Fair key planets, stations, then choke points and trade nodes.
  const D = allCosts(nodes);
  const isFree = (n) => n.type === NODE.EMPTY;
  const free = () => nodes.filter(isFree);

  /**
   * One tile per home at exactly `d` movement from that home, with no home
   * left closer than `d` to any tile of this kind. Tries mirrored picks
   * first (player 0's choice copied into each wedge), then backtracking.
   */
  const pickFair = (d, existing) => {
    for (const h of homes) for (const e of existing) if (D[h.id][e.id] < d) return null;
    const ok = (h, n) => isFree(n) && D[h.id][n.id] === d && homes.every((o) => D[o.id][n.id] >= d);
    const cands = homes.map((h) => rng.shuffle(free().filter((n) => ok(h, n))));
    for (const c0 of cands[0]) {
      const picks = [c0];
      for (let i = 1; i < homes.length; i++) {
        const target = sym.transforms[i](c0);
        const best = cands[i].filter((n) => !picks.includes(n))
          .sort((a, b) => hexDistance(a, target) - hexDistance(b, target))[0];
        if (!best) break;
        picks.push(best);
      }
      if (picks.length === homes.length) return picks;
    }
    return null;
  };

  const PLANS = [[3, 2], [3, 3], [2, 3], [4, 2], [2, 2], [4, 3]];
  let plan = null;
  for (const [kd, sd] of PLANS) {
    const keys = pickFair(kd, centrals);
    if (!keys) continue;
    keys.forEach((n) => (n.type = NODE.KEY));
    const stations = pickFair(sd, []);
    if (stations) {
      stations.forEach((n) => (n.type = NODE.STATION));
      plan = { key: kd, station: sd };
      break;
    }
    keys.forEach((n) => (n.type = NODE.EMPTY));
  }

  if (plan) {
    // Choke points: empty tiles on the most shortest paths, spread apart.
    const bc = betweenness(tileGraph(nodes).adj);
    const chokes = [];
    for (const n of free().filter((x) => homes.every((h) => hexDistance(h, x) >= 2)).sort((a, b) => bc[b.id] - bc[a.id])) {
      if (chokes.length >= p.chokeCount) break;
      if (chokes.some((c) => hexDistance(c, n) < 3)) continue;
      chokes.push(n);
    }
    chokes.forEach((n) => (n.type = NODE.INTERSECTION));

    // Trade nodes: 2 in each home's region (mirrored), the rest central.
    const region = (n) => {
      const ds = homes.map((h) => D[h.id][n.id]);
      const m = Math.min(...ds);
      return ds.filter((x) => x === m).length === 1 ? ds.indexOf(m) : -1;
    };
    const near = (h, n) => Math.abs(D[h.id][n.id] - 3.5);
    for (let k = 0; k < 2; k++) {
      const mine = rng.shuffle(free().filter((n) => region(n) === 0 && D[homes[0].id][n.id] >= 2))
        .sort((a, b) => near(homes[0], a) - near(homes[0], b));
      const c0 = mine[0];
      if (!c0) break;
      c0.type = NODE.TRADE;
      for (let i = 1; i < homes.length; i++) {
        const target = sym.transforms[i](c0);
        const best = free().filter((n) => region(n) === i && D[homes[i].id][n.id] >= 2)
          .sort((a, b) => hexDistance(a, target) - hexDistance(b, target))[0];
        if (best) best.type = NODE.TRADE;
      }
    }
    const spread = (n) => {
      const ds = homes.map((h) => D[h.id][n.id]);
      return Math.max(...ds) - Math.min(...ds);
    };
    const rest = rng.shuffle(free()).sort((a, b) => spread(a) - spread(b) || hexDistance(a, core) - hexDistance(b, core));
    let trades = nodes.filter((n) => n.type === NODE.TRADE).length;
    for (const n of rest) {
      if (trades >= p.tradeCount) break;
      if (nodes.some((x) => x.type === NODE.TRADE && hexDistance(x, n) < 2)) continue;
      n.type = NODE.TRADE;
      trades++;
    }
  }

  // Names for every notable tile.
  const notable = nodes.filter((n) => ![NODE.EMPTY, NODE.VOID, NODE.ASTEROID, NODE.NEBULA].includes(n.type));
  const names = makeNames(rng, notable.length);
  notable.forEach((n, i) => (n.name = names[i]));

  // Extras: hidden tiles and neutral pirates.
  const minHome = (n) => Math.min(...homes.map((h) => D[h.id][n.id]));
  const pirates = [];
  if (plan) {
    for (const n of free()) {
      if (minHome(n) >= 2 && rng.chance(0.14)) {
        n.hidden = true;
        n.hiddenContent = rng.pick([HIDDEN.DERELICT, HIDDEN.DERELICT, HIDDEN.BONUS, HIDDEN.BONUS, HIDDEN.PIRATE_NEST]);
      }
    }
    const spots = rng.shuffle(free().filter((n) => !n.hidden && minHome(n) >= 3));
    spots.sort((a, b) => {
      const sa = Math.max(...homes.map((h) => D[h.id][a.id])) - minHome(a);
      const sb = Math.max(...homes.map((h) => D[h.id][b.id])) - minHome(b);
      return sa - sb;
    });
    for (const n of spots) {
      if (pirates.length >= p.pirateCount) break;
      if (pirates.some((q) => hexDistance(nodes[q.node], n) < 3)) continue;
      pirates.push({ id: `pirate-${pirates.length}`, node: n.id, hull: 4, maxHull: 4, weapon: 2 });
    }
  }

  // Board pixel positions and bounds (in sprite pixels).
  for (const n of nodes) Object.assign(n, toPixel(n.q, n.r));
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const bounds = {
    minX: Math.min(...xs) - TILE_W / 2,
    maxX: Math.max(...xs) + TILE_W / 2,
    minY: Math.min(...ys) - TILE_H / 2,
    maxY: Math.max(...ys) + TILE_H / 2,
  };

  const map = { seed, players, attempt, radius: p.radius, nodes, pirates, plan, bounds };
  map.checks = runFairnessChecks(map, plan ? null : 'no fair key planet / station layout');
  map.valid = map.checks.every((c) => c.pass);
  return map;
}

/**
 * Generate a fair map for a seed. Candidates that fail any fairness check are
 * discarded and regenerated; the rejections are kept for display.
 */
export function generateMap(seed, players, { maxAttempts = 200 } = {}) {
  const rejected = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const map = generateCandidate(seed, players, attempt);
    if (map.valid) {
      map.rejected = rejected;
      return map;
    }
    rejected.push({ attempt, failed: map.checks.filter((c) => !c.pass).map((c) => c.id) });
  }
  throw new Error(`No fair map found for seed "${seed}" after ${maxAttempts} attempts`);
}
