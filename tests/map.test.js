import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, generateCandidate, mapParams } from '../src/map/generator.js';
import { runFairnessChecks } from '../src/map/fairness.js';
import { buildAdjacency, bfs, segmentsCross } from '../src/map/graph.js';
import { Rng } from '../src/rng.js';

const SEEDS = Array.from({ length: 40 }, (_, i) => `TEST-${i}`);

test('rng is deterministic per seed', () => {
  const a = new Rng('VEGA-1234');
  const b = new Rng('VEGA-1234');
  const c = new Rng('VEGA-1235');
  const sa = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(sa, Array.from({ length: 5 }, () => b.next()));
  assert.notDeepEqual(sa, Array.from({ length: 5 }, () => c.next()));
});

test('same seed and player count give the same map', () => {
  for (let p = 2; p <= 6; p++) {
    const a = generateMap('ORION-7777', p);
    const b = generateMap('ORION-7777', p);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
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
      const failed = map.checks.filter((c) => !c.pass);
      assert.deepEqual(failed, [], `seed ${seed}`);

      // Independent re-verification of the core guarantees.
      const adj = buildAdjacency(map.nodes.length, map.lanes);
      const homes = map.nodes.filter((n) => n.type === 'home');
      assert.equal(homes.length, players);
      const nearest = (h, type) => {
        const d = bfs(adj, h.id);
        return Math.min(...map.nodes.filter((n) => n.type === type).map((n) => d[n.id]));
      };
      const keyD = homes.map((h) => nearest(h, 'key'));
      const staD = homes.map((h) => nearest(h, 'station'));
      assert.equal(new Set(keyD).size, 1, `fair key planets ${keyD} (seed ${seed})`);
      assert.equal(new Set(staD).size, 1, `fair stations ${staD} (seed ${seed})`);
      assert.ok(Number.isFinite(keyD[0]) && Number.isFinite(staD[0]));
      for (const h of homes) assert.ok(adj[h.id].length >= 2, 'home has 2+ exits');
      assert.ok(bfs(adj, 0).every(Number.isFinite), 'fully connected');
      assert.equal(map.nodes.filter((n) => n.type === 'trade').length, 2 * players + 1);
      assert.equal(map.nodes.filter((n) => n.central).length, p.centralCount);
      assert.equal(map.nodes.filter((n) => n.core).length, 1);
      assert.ok(map.nodes.filter((n) => n.type === 'intersection').length >= 3);
      assert.ok(map.pirates.length >= 2, 'neutral pirates placed');

      // Lanes never cross and never duplicate.
      const seen = new Set();
      for (const l of map.lanes) {
        const key = [l.a, l.b].sort((x, y) => x - y).join('-');
        assert.ok(!seen.has(key), 'duplicate lane');
        seen.add(key);
      }
      for (let i = 0; i < map.lanes.length; i++) {
        for (let j = i + 1; j < map.lanes.length; j++) {
          const A = map.lanes[i];
          const B = map.lanes[j];
          assert.ok(!segmentsCross(map.nodes[A.a], map.nodes[A.b], map.nodes[B.a], map.nodes[B.b]), 'lanes cross');
        }
      }
      // Hazards never touch a home sector.
      for (const l of map.lanes.filter((x) => x.hazard)) {
        assert.notEqual(map.nodes[l.a].type, 'home');
        assert.notEqual(map.nodes[l.b].type, 'home');
      }
    }
  });
}

test('fairness checks catch an unfair map', () => {
  const map = generateMap('BROKEN-1', 3);
  const broken = structuredClone(map);
  // Cut a home down to a single lane and make one home's station vanish.
  const home = broken.nodes.find((n) => n.type === 'home');
  const homeLanes = broken.lanes.filter((l) => l.a === home.id || l.b === home.id);
  broken.lanes = broken.lanes.filter((l) => !homeLanes.slice(1).includes(l));
  broken.nodes.find((n) => n.type === 'station').type = 'empty';
  const failed = runFairnessChecks(broken).filter((c) => !c.pass).map((c) => c.id);
  assert.ok(failed.includes('exits'));
  assert.ok(failed.includes('fairStation'));
});

test('rejected candidates are recorded and replayable', () => {
  // Find a seed that needed at least one retry, then confirm that attempt fails.
  let found = null;
  for (let i = 0; i < 50 && !found; i++) {
    const m = generateMap(`RETRY-${i}`, 5);
    if (m.rejected.length) found = m;
  }
  assert.ok(found, 'expected some seed to need a retry');
  const first = found.rejected[0];
  const replay = generateCandidate(found.seed, 5, first.attempt);
  assert.equal(replay.valid, false);
  assert.equal(found.attempt, found.rejected.length);
});
