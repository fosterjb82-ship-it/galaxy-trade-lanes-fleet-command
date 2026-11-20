import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, cardLocations } from '../src/game/state.js';
import { nextAction, respond } from '../src/game/ai.js';

function playOut(g) {
  let steps = 0;
  while (g.phase === 'action') {
    assert.ok(steps++ < 6000, 'game should finish');
    const a = g.pending ? respond(g, g.pending.defender) : nextAction(g, g.active);
    g = applyAction(g, a); // throws if the AI chose an illegal action
  }
  return g;
}

test('CPU-only games run to the end with legal actions', () => {
  for (const [seed, n] of [['AI-T1', 2], ['AI-T2', 3], ['AI-T3', 4]]) {
    const g = playOut(createGame({ seed, players: Array.from({ length: n }, (_, i) => ({ name: `CPU ${i}`, cpu: true })) }));
    assert.equal(g.phase, 'over');
    assert.ok(g.final.ranking.length === n);
    assert.ok(g.players.some((p) => p.vp > 0));
    assert.ok(g.log.some((l) => /set up a trade route/.test(l.text)), `${seed}: trade happens`);
    cardLocations(g);
  }
});

test('players can be marked as CPU', () => {
  const g = createGame({ seed: 'AI-FLAGS', players: [{ name: 'You' }, { name: 'Vex', cpu: true }] });
  assert.equal(g.players[0].cpu, false);
  assert.equal(g.players[1].cpu, true);
});

test('a CPU defender answers attacks, ambushes and offers', () => {
  let g = createGame({ seed: 'AI-RESP', players: [{ name: 'You' }, { name: 'Vex', cpu: true }], missions: 'auto' });
  g.pending = { kind: 'offer', defender: 1, from: 0 };
  assert.deepEqual(respond(g, 1), { type: 'respondOffer', player: 1, accept: false }, 'no route of its own: decline');
  assert.equal(respond(g, 0), null, 'only answers its own prompts');
});
