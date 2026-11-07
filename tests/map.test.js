import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, generateCandidate, mapParams, tileGraph, allCosts } from '../src/map/generator.js';
import { runFairnessChecks } from '../src/map/fairness.js';
import { hexDistance, hexagon, rotateCell, fromPixel, toPixel } from '../src/map/hex.js';
import { components } from '../src/map/graph.js';
import { Rng } from '../src/rng.js';

const SEEDS = Array.from({ length: 30 }, (_, i) => `TEST-${i}`);

test('rng is deterministic per seed', () => {
  const a = new Rng('VEGA-1234');
  const b = new Rng('VEGA-1234');
  const c = new Rng('VEGA-1235');
  const sa = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(sa, Array.from({ length: 5 }, () => b.next()));
  assert.notDeepEqual(sa, Array.from({ length: 5 }, () => c.next()));
});

test('hex maths: rotation by 60° is exact, pixel round-trips', () => {
  for (const c of hexagon(4)) {
    const r6 = [0, 1, 2, 3, 4, 5].reduce((acc) => rotateCell(acc, Math.PI / 3), c);
    assert.deepEqual(r6, c);
    assert.equal(hexDistance(rotateCell(c, Math.PI / 3), { q: 0, r: 0 }), hexDistance(c, { q: 0, r: 0 }));
    const px = toPixel(c.q, c.r);
    assert.deepEqual(fromPixel(px.x + 3, px.y - 3), c);
  }
});

test('same seed and player count give the same map', () => {
  for (let p = 2; p <= 6; p++) {
    assert.equal(JSON.stringify(generateMap('ORION-7777', p)), JSON.stringify(generateMap('ORION-7777', p)));
  }
});

test('different seeds give different maps', () => {
  const a = generateMap('ORION-1', 4);
  const b = generateMap('ORION-2', 4);
  assert.notEqual(JSON.stringify(a.nodes), JSON.stringify(b.nodes));
});

for (let players = 2; players <= 6; players++) {
  test(`${players} players: every generated map passes all guarantees`, () => {
    const p = mapParams(players);
    for (const seed of SEEDS) {
      const map = generateMap(seed, players);
      assert.deepEqual(map.checks.filter((c) => !c.pass), [], `seed ${seed}`);

      // Independent re-verification of the core guarantees.
      const { adj, cost } = tileGraph(map.nodes);
      const D = allCosts(map.nodes);
      const homes = map.nodes.filter((n) => n.type === 'home');
      assert.equal(homes.length, players);
      const nearest = (h, type) => Math.min(...map.nodes.filter((n) => n.type === type).map((n) => D[h.id][n.id]));
      const keyD = homes.map((h) => nearest(h, 'key'));
      const staD = homes.map((h) => nearest(h, 'station'));
      assert.equal(new Set(keyD).size, 1, `fair key planets ${keyD} (seed ${seed})`);
      assert.equal(new Set(staD).size, 1, `fair stations ${staD} (seed ${seed})`);
      for (const h of homes) assert.ok(adj[h.id].length >= 2, 'home has 2+ open exits');
      const { comp } = components(adj);
      const open = map.nodes.filter((n) => cost[n.id] !== Infinity);
      assert.equal(new Set(open.map((n) => comp[n.id])).size, 1, 'fully connected');
      assert.equal(map.nodes.filter((n) => n.type === 'trade').length, 2 * players + 1);
      assert.equal(map.nodes.filter((n) => n.central).length, p.centralCount);
      assert.equal(map.nodes.filter((n) => n.core).length, 1);
      assert.ok(map.nodes.filter((n) => n.type === 'intersection').length >= 3);
      assert.ok(map.pirates.length >= 2, 'neutral pirates placed');
      assert.ok(map.nodes.some((n) => n.type === 'void'), 'board has void rifts');
      assert.ok(map.nodes.some((n) => n.type === 'asteroid' || n.type === 'nebula'), 'board has hazards');

      // Hazards and rifts never touch a home tile.
      for (const h of homes) {
        for (const n of map.nodes) {
          if (['void', 'asteroid', 'nebula'].includes(n.type)) assert.ok(hexDistance(h, n) >= 2);
        }
      }
      // Every tile on the board is a hexagon cell within the radius.
      assert.equal(map.nodes.length, hexagon(p.radius).length);
    }
  });
}

test('fairness checks catch an unfair map', () => {
  const map = generateMap('BROKEN-1', 3);
  const broken = structuredClone(map);
  // Wall a home in with void and make one station vanish.
  const home = broken.nodes.find((n) => n.type === 'home');
  for (const n of broken.nodes) if (hexDistance(n, home) === 1) n.type = 'void';
  broken.nodes.find((n) => n.type === 'station').type = 'empty';
  const failed = runFairnessChecks(broken).filter((c) => !c.pass).map((c) => c.id);
  assert.ok(failed.includes('exits'));
  assert.ok(failed.includes('connected'));
  assert.ok(failed.includes('fairStation'));
});

test('rejected candidates are recorded and replayable', () => {
  let found = null;
  for (let i = 0; i < 60 && !found; i++) {
    const m = generateMap(`RETRY-${i}`, 2);
    if (m.rejected.length) found = m;
  }
  assert.ok(found, 'expected some seed to need a retry');
  const replay = generateCandidate(found.seed, 2, found.rejected[0].attempt);
  assert.equal(replay.valid, false);
  assert.equal(found.attempt, found.rejected.length);
});
