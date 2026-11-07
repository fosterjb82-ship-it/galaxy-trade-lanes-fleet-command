// Map generator for Fleet Command. Follows the generation steps in DESIGN.md:
//   1. Place home sectors evenly around the edge.
//   2. Place the central key planet(s).
//   3. Scatter the remaining nodes with minimum spacing.
//   4. Connect each node to its 2–3 nearest neighbours, then add lanes until
//      everything is connected.
//   5. Assign node types following the guarantees.
//   6. Run the fairness checks; if any fail, discard and regenerate.
//
// The same (seed, players) pair always produces the same map, including the
// number of rejected attempts, so seeds can be shared.

import { Rng } from '../rng.js';
import {
  buildAdjacency, allPairs, components, betweenness, segmentsCross, pointSegmentDistance,
} from './graph.js';
import { runFairnessChecks } from './fairness.js';

export const NODE = {
  HOME: 'home',
  KEY: 'key',
  INTERSECTION: 'intersection',
  STATION: 'station',
  TRADE: 'trade',
  EMPTY: 'empty',
};

export const HIDDEN = {
  DERELICT: 'derelict', // salvage: bonus credits
  PIRATE_NEST: 'pirateNest', // spawns a pirate fleet
  BONUS: 'bonus', // draw extra cards
};

export const HAZARD = {
  ASTEROID: 'asteroid', // costs 1 extra movement to cross
  NEBULA: 'nebula', // deals 1 damage to a ship crossing it
};

export const WIDTH = 1600;
export const HEIGHT = 1100;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;

/** Map size and composition per player count. */
export function mapParams(players) {
  if (players < 2 || players > 6) throw new Error('Fleet Command supports 2–6 players');
  const perWedge = { 2: 9, 3: 7, 4: 6, 5: 6, 6: 6 }[players];
  const centralCount = players <= 4 ? 1 : players - 3; // 5p: 2, 6p: 3
  return {
    players,
    perWedge, // scattered nodes per player wedge (mirrored around the map)
    centralCount,
    nodeCount: players * (1 + perWedge) + centralCount,
    tradeCount: 2 * players + 1,
    chokeCount: players <= 4 ? 3 : 4,
    pirateCount: players <= 3 ? 2 : players <= 5 ? 3 : 4,
    rx: 690,
    ry: 470,
  };
}

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

// ---------------------------------------------------------------- placement
//
// Layout and lanes are built in "circle space" (a disc of radius R centred on
// 0,0) and squashed onto the wide map at the end. Nodes are scattered in one
// player's wedge and mirrored by rotation into every other wedge, with a small
// jitter per copy. That keeps maps random-looking but close to symmetric, so
// far fewer candidates fail the fairness checks.

const R = 640;
const JITTER = 14;

function rotate(pt, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: pt.x * c - pt.y * s, y: pt.x * s + pt.y * c };
}

function placeNodes(rng, p) {
  const nodes = [];
  const n = p.players;
  const rotation = rng.range(0, Math.PI * 2);
  const step = (Math.PI * 2) / n;

  // 1. Homes evenly around the edge.
  for (let i = 0; i < n; i++) {
    const a = rotation + i * step;
    nodes.push({ x: Math.cos(a) * R, y: Math.sin(a) * R, type: NODE.HOME, homeOf: i, group: -1 });
  }

  // 2. Central key planet(s): the galactic core sits dead centre; at 5–6
  //    players 1–2 more contested key planets flank it.
  nodes.push({ x: 0, y: 0, type: NODE.KEY, central: true, core: true, group: -2 });
  if (p.centralCount > 1) {
    const a0 = rng.range(0, Math.PI * 2);
    for (let i = 1; i < p.centralCount; i++) {
      const a = a0 + ((i - 1) / (p.centralCount - 1)) * Math.PI * 2;
      nodes.push({ x: Math.cos(a) * 175, y: Math.sin(a) * 175, type: NODE.KEY, central: true, group: -3 - i });
    }
  }

  // 3. Scatter one wedge with minimum spacing, mirrored into every wedge.
  const area = Math.PI * R * R;
  let spacing = Math.sqrt(area / p.nodeCount) * 0.78;
  const centerClear = p.centralCount === 1 ? spacing : 175 + spacing * 0.8;
  let placed = 0;
  let tries = 0;
  while (placed < p.perWedge) {
    tries++;
    if (tries % 300 === 0) spacing *= 0.95; // relax if we're stuck
    const a = rotation + rng.range(-step / 2, step / 2);
    const r = centerClear + Math.sqrt(rng.next()) * (R * 0.96 - centerClear);
    const base = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    const copies = [];
    for (let i = 0; i < n; i++) copies.push(rotate(base, i * step));
    const ok = copies.every((c, i) =>
      nodes.every((q) => Math.hypot(q.x - c.x, q.y - c.y) >= spacing) &&
      copies.every((d, j) => j <= i || Math.hypot(d.x - c.x, d.y - c.y) >= spacing));
    if (!ok) continue;
    copies.forEach((c) => nodes.push({
      x: c.x + rng.range(-JITTER, JITTER),
      y: c.y + rng.range(-JITTER, JITTER),
      type: null,
      group: placed,
    }));
    placed++;
  }
  return nodes;
}

/** Map circle space onto the wide board. */
function toBoard(nodes, p) {
  for (const nd of nodes) {
    nd.x = Math.round(CX + (nd.x / R) * p.rx);
    nd.y = Math.round(CY + (nd.y / R) * p.ry);
  }
}

// ---------------------------------------------------------------- lanes

function laneOk(nodes, lanes, a, b) {
  if (a === b) return false;
  if (lanes.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return false;
  const pa = nodes[a];
  const pb = nodes[b];
  for (const l of lanes) {
    if (l.a === a || l.a === b || l.b === a || l.b === b) continue;
    if (segmentsCross(pa, pb, nodes[l.a], nodes[l.b])) return false;
  }
  // Keep lanes visibly clear of other nodes.
  for (let i = 0; i < nodes.length; i++) {
    if (i === a || i === b) continue;
    if (pointSegmentDistance(nodes[i], pa, pb) < 46) return false;
  }
  return true;
}

function connectNodes(rng, nodes, p) {
  const lanes = [];
  const n = nodes.length;
  const dist = (i, j) => Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
  const byDistance = (i) => [...Array(n).keys()].filter((j) => j !== i).sort((x, y) => dist(i, x) - dist(i, y));
  const maxLane = 520;
  const hasLane = (i, j) => lanes.some((l) => (l.a === i && l.b === j) || (l.a === j && l.b === i));

  // 4a. Each node links to its 2–3 nearest neighbours (when no crossing).
  // Mirrored copies are processed together with the same lane count.
  const groups = new Map();
  nodes.forEach((nd, i) => {
    const key = nd.group;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  const order = rng.shuffle([...groups.keys()]);
  for (const g of order) {
    // The galactic core is a hub with a spoke toward every player.
    const want = g === -2 ? p.players : rng.int(2, 3);
    for (const i of groups.get(g)) {
      let made = 0;
      for (const j of byDistance(i)) {
        if (made >= want || dist(i, j) > maxLane) break;
        if (hasLane(i, j)) made++;
        else if (laneOk(nodes, lanes, i, j)) {
          lanes.push({ a: i, b: j });
          made++;
        }
      }
    }
  }

  // 4b. Add the shortest legal lane between components until connected.
  for (let guard = 0; guard < 100; guard++) {
    const { comp, count } = components(buildAdjacency(n, lanes));
    if (count <= 1) break;
    let best = null;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (comp[i] === comp[j]) continue;
        const d = dist(i, j);
        if ((!best || d < best.d) && laneOk(nodes, lanes, i, j)) best = { i, j, d };
      }
    }
    if (!best) break; // can't connect without crossings: fairness check will reject
    lanes.push({ a: best.i, b: best.j });
  }

  // 4c. No dead-end homes: at least 2 exit lanes.
  for (let i = 0; i < n; i++) {
    if (nodes[i].type !== NODE.HOME) continue;
    for (const j of byDistance(i)) {
      const deg = lanes.filter((l) => l.a === i || l.b === i).length;
      if (deg >= 2) break;
      if (nodes[j].type === NODE.HOME) continue;
      if (laneOk(nodes, lanes, i, j)) lanes.push({ a: i, b: j });
    }
  }
  return lanes;
}

// ---------------------------------------------------------------- node types

/**
 * Pick one node per home at exactly `d` jumps from that home such that no home
 * ends up with a closer node of this kind. Backtracking over homes.
 */
function pickFairSet(rng, D, homes, free, d, existingOfKind) {
  // Existing nodes of this kind (e.g. central key planets) must not be closer than d.
  for (const h of homes) {
    for (const e of existingOfKind) if (D[h][e] < d) return null;
  }
  const candidates = homes.map((h) => {
    const list = free.filter((v) => D[h][v] === d && homes.every((o) => D[o][v] >= d));
    // Prefer nodes that clearly belong to this home (farther from everyone else).
    rng.shuffle(list);
    list.sort((u, v) => {
      const su = Math.min(...homes.filter((o) => o !== h).map((o) => D[o][u]));
      const sv = Math.min(...homes.filter((o) => o !== h).map((o) => D[o][v]));
      return sv - su;
    });
    return list;
  });
  const chosen = [];
  const used = new Set();
  const solve = (k) => {
    if (k === homes.length) return true;
    for (const v of candidates[k]) {
      if (used.has(v)) continue;
      used.add(v);
      chosen.push(v);
      if (solve(k + 1)) return true;
      used.delete(v);
      chosen.pop();
    }
    return false;
  };
  return solve(0) ? chosen : null;
}

const DISTANCE_PLANS = [
  { key: 2, station: 2 },
  { key: 2, station: 3 },
  { key: 3, station: 2 },
  { key: 2, station: 1 },
  { key: 3, station: 3 },
  { key: 3, station: 1 },
];

function assignTypes(rng, nodes, lanes, p) {
  const n = nodes.length;
  const adj = buildAdjacency(n, lanes);
  const D = allPairs(adj);
  const homes = nodes.map((nd, i) => (nd.type === NODE.HOME ? i : -1)).filter((i) => i >= 0);
  const centrals = nodes.map((nd, i) => (nd.central ? i : -1)).filter((i) => i >= 0);
  const freeNow = () => nodes.map((nd, i) => (nd.type === null ? i : -1)).filter((i) => i >= 0);

  const bc = betweenness(adj);

  // Fair key planets and stations near each home.
  let plan = null;
  for (const candidate of DISTANCE_PLANS) {
    const keys = pickFairSet(rng, D, homes, freeNow(), candidate.key, centrals);
    if (!keys) continue;
    const free2 = freeNow().filter((v) => !keys.includes(v));
    const stations = pickFairSet(rng, D, homes, free2, candidate.station, []);
    if (!stations) continue;
    plan = { ...candidate, keys, stations };
    break;
  }
  if (!plan) return { ok: false, reason: 'no fair key planet / station layout' };
  for (const v of plan.keys) nodes[v].type = NODE.KEY;
  for (const v of plan.stations) nodes[v].type = NODE.STATION;

  // Choke points: the free nodes with the highest betweenness become intersections.
    const chokes = freeNow()
    .filter((v) => adj[v].length >= 3)
    .sort((u, v) => bc[v] - bc[u])
    .slice(0, p.chokeCount);
  for (const v of chokes) nodes[v].type = NODE.INTERSECTION;

  // Trade nodes: 2 in each home's region (by nearest home), plus the rest central.
  const region = (v) => {
    const ds = homes.map((h) => D[h][v]);
    const m = Math.min(...ds);
    const owners = homes.filter((h) => D[h][v] === m);
    return owners.length === 1 ? owners[0] : -1;
  };
  const trade = [];
  for (const h of homes) {
    const mine = rng.shuffle(freeNow().filter((v) => region(v) === h && !trade.includes(v)));
    mine.sort((u, v) => Math.abs(D[h][u] - 2.5) - Math.abs(D[h][v] - 2.5));
    trade.push(...mine.slice(0, 2));
  }
  const spread = (v) => Math.max(...homes.map((h) => D[h][v])) - Math.min(...homes.map((h) => D[h][v]));
  const rest = rng.shuffle(freeNow().filter((v) => !trade.includes(v))).sort((u, v) => spread(u) - spread(v));
  while (trade.length < p.tradeCount && rest.length) trade.push(rest.shift());
  for (const v of trade) nodes[v].type = NODE.TRADE;

  // Everything else is empty space; some of it hides something.
  for (const v of freeNow()) nodes[v].type = NODE.EMPTY;

  return { ok: true, plan, D, adj, bc };
}

function placeExtras(rng, nodes, lanes, p, D) {
  const homes = nodes.map((nd, i) => (nd.homeOf !== undefined ? i : -1)).filter((i) => i >= 0);
  const empties = nodes.map((nd, i) => (nd.type === NODE.EMPTY ? i : -1)).filter((i) => i >= 0);

  // Pirate fleets start at least 2 jumps from every home, preferring empty
  // nodes that are equally far from all players and not next to each other.
  const minHome = (v) => Math.min(...homes.map((h) => D[h][v]));
  const spread = (v) => Math.max(...homes.map((h) => D[h][v])) - minHome(v);
  const open = nodes
    .map((nd, i) => ([NODE.EMPTY, NODE.TRADE, NODE.INTERSECTION].includes(nd.type) ? i : -1))
    .filter((v) => v >= 0 && minHome(v) >= 2);
  const pirateSpots = rng.shuffle(open).sort((u, v) =>
    (nodes[u].type !== NODE.EMPTY) - (nodes[v].type !== NODE.EMPTY) || spread(u) - spread(v));
  const pirates = [];
  for (const gap of [2, 1]) {
    for (const v of pirateSpots) {
      if (pirates.length >= p.pirateCount) break;
      if (pirates.some((q) => q.node === v || D[q.node][v] < gap)) continue;
      pirates.push({ id: `pirate-${pirates.length}`, node: v, hull: 4, maxHull: 4, weapon: 2 });
    }
  }

  // Hidden nodes: about 40% of the remaining empty nodes.
  const hiddenTable = [HIDDEN.DERELICT, HIDDEN.DERELICT, HIDDEN.BONUS, HIDDEN.BONUS, HIDDEN.PIRATE_NEST];
  for (const v of empties) {
    if (pirates.some((q) => q.node === v)) continue;
    if (rng.chance(0.4)) {
      nodes[v].hidden = true;
      nodes[v].hiddenContent = rng.pick(hiddenTable);
    }
  }

  // Hazard lanes: ~12% of lanes, never touching a home sector (keeps starts fair).
  for (const lane of lanes) {
    if (nodes[lane.a].type === NODE.HOME || nodes[lane.b].type === NODE.HOME) continue;
    if (rng.chance(0.12)) lane.hazard = rng.chance(0.5) ? HAZARD.ASTEROID : HAZARD.NEBULA;
  }
  return pirates;
}

// ---------------------------------------------------------------- entry point

/** Build one candidate map from a single attempt's RNG. May fail checks. */
export function generateCandidate(seed, players, attempt) {
  const p = mapParams(players);
  const rng = new Rng(`${seed}|${players}|${attempt}`);
  const nodes = placeNodes(rng, p);
  const lanes = connectNodes(rng, nodes, p);
  toBoard(nodes, p);
  const assigned = assignTypes(rng, nodes, lanes, p);

  const names = makeNames(rng, nodes.length);
  nodes.forEach((nd, i) => {
    nd.id = i;
    nd.name = names[i];
    delete nd.group;
  });

  let pirates = [];
  let plan = null;
  if (assigned.ok) {
    pirates = placeExtras(rng, nodes, lanes, p, assigned.D);
    plan = assigned.plan;
  }
  const map = { seed, players, attempt, width: WIDTH, height: HEIGHT, nodes, lanes, pirates, plan };
  map.checks = runFairnessChecks(map, assigned.ok ? null : assigned.reason);
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
