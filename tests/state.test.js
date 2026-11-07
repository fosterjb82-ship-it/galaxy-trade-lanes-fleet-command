import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, applyAction, controllerOf, cpCapacity, cpUsed, deployCheck, deployTiles, drawCards,
  cardLocations, shipsOf, GameError,
} from '../src/game/state.js';
import { SHIPS } from '../src/game/ships.js';

const NAMES = ['Ada', 'Bo', 'Cy', 'Di'];
const newGame = (n = 4, seed = 'STATE-1') => createGame({ seed, players: NAMES.slice(0, n) });
const handDefs = (state, pid) => state.players[pid].hand.map((u) => state.cards[u].def);

test('every player starts with the same 10-card deck and a hand of 5', () => {
  const g = newGame();
  for (const p of g.players) {
    const all = [...p.hand, ...p.deck].map((u) => g.cards[u].def).sort();
    assert.deepEqual(all, ['attack', 'attack', 'credits', 'credits', 'credits', 'credits', 'move', 'move', 'move', 'ship-fighter']);
    assert.equal(p.hand.length, 5);
    assert.equal(p.deck.length, 5);
  }
  cardLocations(g);
});

test('the fighter is always in the opening hand', () => {
  for (let i = 0; i < 60; i++) {
    const g = createGame({ seed: `FIGHTER-${i}`, players: ['A', 'B', 'C'] });
    for (const p of g.players) assert.ok(handDefs(g, p.id).includes('ship-fighter'), `seed ${i} player ${p.id}`);
  }
});

test('games are deterministic per seed', () => {
  assert.equal(JSON.stringify(newGame(3, 'X')), JSON.stringify(newGame(3, 'X')));
  assert.notEqual(JSON.stringify(newGame(3, 'X').players[0].hand), JSON.stringify(newGame(3, 'Y').players[0].hand));
});

test('drawing reshuffles the discard pile when the deck runs out', () => {
  const g = newGame(2);
  const p = g.players[0];
  p.discard.push(...p.hand.splice(0));
  drawCards(g, 0, 5); // empties deck
  assert.equal(p.deck.length, 0);
  drawCards(g, 0, 3); // reshuffles 5 discards
  assert.equal(p.hand.length, 8);
  assert.equal(p.deck.length, 2);
  assert.equal(p.discard.length, 0);
  cardLocations(g);
});

test('homes start controlled by their owner and give 6 CP', () => {
  const g = newGame();
  for (const p of g.players) {
    assert.equal(controllerOf(g, p.home), p.id);
    assert.equal(cpCapacity(g, p.id).total, 6);
    assert.equal(cpUsed(g, p.id), 0);
    assert.deepEqual(deployTiles(g, p.id), [p.home]);
  }
});

test('deploying a ship card moves it from hand to the board', () => {
  let g = newGame();
  const card = g.players[0].hand.find((u) => g.cards[u].def === 'ship-fighter');
  g = applyAction(g, { type: 'deploy', player: 0, card, tile: g.players[0].home });
  assert.equal(g.players[0].hand.length, 4);
  const [ship] = shipsOf(g, 0);
  assert.equal(ship.type, 'fighter');
  assert.equal(ship.hull, 2);
  assert.equal(ship.card, card);
  assert.equal(cpUsed(g, 0), 1);
  cardLocations(g);
});

test('deploy is rejected off-turn, off controlled tiles, and over CP capacity', () => {
  let g = newGame();
  const fighterOf = (pid) => g.players[pid].hand.find((u) => g.cards[u].def === 'ship-fighter');
  assert.throws(() => applyAction(g, { type: 'deploy', player: 1, card: fighterOf(1), tile: g.players[1].home }), GameError);
  assert.throws(() => applyAction(g, { type: 'deploy', player: 0, card: fighterOf(0), tile: g.players[1].home }), GameError);
  // 6 CP: two destroyers (3 CP each) fill it; a fighter no longer fits.
  for (let i = 0; i < 2; i++) {
    g = applyAction(g, { type: 'dev.giveCard', player: 0, def: 'ship-destroyer' });
    const d = g.players[0].hand.find((u) => g.cards[u].def === 'ship-destroyer');
    g = applyAction(g, { type: 'deploy', player: 0, card: d, tile: g.players[0].home });
  }
  assert.equal(cpUsed(g, 0), 6);
  const check = deployCheck(g, 0, fighterOf(0));
  assert.equal(check.ok, false);
  assert.match(check.reason, /Command Points/);
  assert.throws(() => applyAction(g, { type: 'deploy', player: 0, card: fighterOf(0), tile: g.players[0].home }), /Command Points/);
});

test('control: only ships, highest total hull, ties mean nobody', () => {
  let g = newGame();
  const key = g.map.nodes.find((n) => n.type === 'key' && !n.central).id;
  const give = (pid, def) => {
    g = applyAction(g, { type: 'dev.setActive', player: pid });
    g = applyAction(g, { type: 'dev.giveCard', player: pid, def });
    const uid = g.players[pid].hand.find((u) => g.cards[u].def === def);
    g = applyAction(g, { type: 'deploy', player: pid, card: uid, tile: g.players[pid].home });
    return g.ships.at(-1).id;
  };
  assert.equal(controllerOf(g, key), null);
  const f0 = give(0, 'ship-fighter'); // hull 2
  g = applyAction(g, { type: 'dev.placeShip', ship: f0, tile: key });
  assert.equal(controllerOf(g, key), 0);
  assert.equal(cpCapacity(g, 0).total, 8, 'key planet adds 2 CP');
  assert.ok(deployTiles(g, 0).includes(key), 'can deploy at a controlled key planet');

  const f1 = give(1, 'ship-fighter'); // hull 2 -> tie
  g = applyAction(g, { type: 'dev.placeShip', ship: f1, tile: key });
  assert.equal(controllerOf(g, key), null, 'tie means nobody');
  assert.equal(cpCapacity(g, 0).total, 6);

  const fr1 = give(1, 'ship-frigate'); // +4 hull for player 1
  g = applyAction(g, { type: 'dev.placeShip', ship: fr1, tile: key });
  assert.equal(controllerOf(g, key), 1);
  assert.equal(cpCapacity(g, 1).total, 8);
});

test('an enemy alone in your home takes its control and CP', () => {
  let g = newGame(2);
  const card = g.players[0].hand.find((u) => g.cards[u].def === 'ship-fighter');
  g = applyAction(g, { type: 'deploy', player: 0, card, tile: g.players[0].home });
  g = applyAction(g, { type: 'dev.placeShip', ship: g.ships.at(-1).id, tile: g.players[1].home });
  assert.equal(controllerOf(g, g.players[1].home), 0);
  assert.equal(cpCapacity(g, 0).total, 12);
  assert.equal(cpCapacity(g, 1).total, 0);
  assert.equal(deployCheck(g, 1, g.players[1].hand.find((u) => g.cards[u].def === 'ship-fighter')).ok, false);
});

test('losing territory keeps ships but blocks new deploys until back under capacity', () => {
  let g = newGame(2);
  const key = g.map.nodes.find((n) => n.type === 'key' && !n.central).id;
  const deploy = (def) => {
    g = applyAction(g, { type: 'dev.giveCard', player: 0, def });
    const uid = g.players[0].hand.find((u) => g.cards[u].def === def);
    g = applyAction(g, { type: 'deploy', player: 0, card: uid, tile: g.players[0].home });
    return g.ships.at(-1).id;
  };
  const d = deploy('ship-destroyer');
  g = applyAction(g, { type: 'dev.placeShip', ship: d, tile: key }); // 8 CP
  deploy('ship-destroyer'); // 6 used of 8
  deploy('ship-fighter'); // 7 of 8
  g = applyAction(g, { type: 'dev.placeShip', ship: d, tile: g.players[0].home }); // lose key: 6 cap, 7 used
  assert.equal(cpUsed(g, 0), 7);
  assert.equal(cpCapacity(g, 0).total, 6);
  assert.equal(shipsOf(g, 0).length, 3, 'no ships removed');
  g = applyAction(g, { type: 'dev.giveCard', player: 0, def: 'ship-fighter' });
  const extra = g.players[0].hand.find((u) => g.cards[u].def === 'ship-fighter');
  assert.equal(deployCheck(g, 0, extra).ok, false);
});

test('carriers are mobile deploy points', () => {
  let g = newGame(2);
  g = applyAction(g, { type: 'dev.giveCard', player: 0, def: 'ship-carrier' });
  const c = g.players[0].hand.find((u) => g.cards[u].def === 'ship-carrier');
  g = applyAction(g, { type: 'deploy', player: 0, card: c, tile: g.players[0].home });
  const carrier = g.ships.at(-1);
  // Park the carrier on a tile shared with an enemy frigate (enemy controls it).
  g = applyAction(g, { type: 'dev.setActive', player: 1 });
  g = applyAction(g, { type: 'dev.giveCard', player: 1, def: 'ship-destroyer' });
  const d = g.players[1].hand.find((u) => g.cards[u].def === 'ship-destroyer');
  g = applyAction(g, { type: 'deploy', player: 1, card: d, tile: g.players[1].home });
  const open = g.map.nodes.find((n) => n.type === 'empty').id;
  g = applyAction(g, { type: 'dev.placeShip', ship: carrier.id, tile: open });
  g = applyAction(g, { type: 'dev.placeShip', ship: g.ships.at(-1).id, tile: open });
  g.ships.find((s) => s.id === carrier.id).hull = 3; // damaged: enemy destroyer (6) now controls
  assert.equal(controllerOf(g, open), 1);
  assert.ok(deployTiles(g, 0).includes(open), 'carrier tile is still a deploy point');
  assert.equal(SHIPS.carrier.cp, 4);
});

test('pirates start on the board and never control tiles', () => {
  const g = newGame();
  const pirates = g.ships.filter((s) => s.owner === 'pirate');
  assert.ok(pirates.length >= 2);
  for (const p of pirates) assert.equal(controllerOf(g, p.tile), null);
});

test('state survives a JSON round trip', () => {
  const g = newGame();
  const copy = JSON.parse(JSON.stringify(g));
  const card = copy.players[0].hand.find((u) => copy.cards[u].def === 'ship-fighter');
  const next = applyAction(copy, { type: 'deploy', player: 0, card, tile: copy.players[0].home });
  assert.equal(shipsOf(next, 0).length, 1);
});
