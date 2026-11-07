import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, applyAction, cardLocations, controllerOf, moveTargets, buyPrice, turnOrder, shipsOf, HAND_SIZE,
} from '../src/game/state.js';
import { reachable } from '../src/game/movement.js';
import { hexDistance } from '../src/map/hex.js';

const game = (n = 3, seed = 'TURN-1') => createGame({ seed, players: ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'].slice(0, n) });
const find = (g, pid, def) => g.players[pid].hand.find((u) => g.cards[u].def === def);
const act = (g, a) => applyAction(g, a);

/** Put a specific card into the active player's hand (sandbox helper). */
function give(g, pid, def) {
  g = act(g, { type: 'dev.giveCard', player: pid, def });
  return [g, g.players[pid].hand.at(-1)];
}

function deployFighter(g, pid) {
  return act(g, { type: 'deploy', player: pid, card: find(g, pid, 'ship-fighter'), tile: g.players[pid].home });
}

test('credit cards add credits; unspent credits are lost at end of turn', () => {
  let g = game();
  const credits = g.players[0].hand.filter((u) => g.cards[u].def === 'credits');
  for (const c of credits) g = act(g, { type: 'playCredit', player: 0, card: c });
  assert.equal(g.players[0].credits, credits.length);
  assert.equal(g.players[0].played.length, credits.length);
  g = act(g, { type: 'endTurn', player: 0, keep: [] });
  assert.equal(g.players[0].credits, 0);
  assert.equal(g.active, 1);
  cardLocations(g);
});

test('buying from the shipyard puts the card in the discard pile', () => {
  let g = game();
  for (let i = 0; i < 3; i++) [g] = give(g, 0, 'credits');
  for (const c of g.players[0].hand.filter((u) => g.cards[u].def === 'credits')) g = act(g, { type: 'playCredit', player: 0, card: c });
  const before = g.players[0].credits;
  assert.ok(before >= 3 && before < 6);
  g = act(g, { type: 'buy', player: 0, def: 'ship-fighter' });
  assert.equal(g.players[0].credits, before - 2);
  assert.equal(g.players[0].spent, 2);
  assert.equal(g.cards[g.players[0].discard.at(-1)].def, 'ship-fighter');
  assert.throws(() => act(g, { type: 'buy', player: 0, def: 'ship-destroyer' }), /costs 6/);
  assert.throws(() => act(g, { type: 'buy', player: 0, def: 'ship-carrier' }), /Shipyard/);
  cardLocations(g);
});

test('ships cost 1 less while you control a station', () => {
  let g = game();
  g = deployFighter(g, 0);
  const station = g.map.nodes.find((n) => n.type === 'station').id;
  assert.equal(buyPrice(g, 0, 'ship-frigate'), 4);
  g = act(g, { type: 'dev.placeShip', ship: shipsOf(g, 0)[0].id, tile: station });
  assert.equal(controllerOf(g, station), 0);
  assert.equal(buyPrice(g, 0, 'ship-frigate'), 3);
  assert.equal(buyPrice(g, 0, 'ship-fighter'), 1);
  assert.equal(buyPrice(g, 0, 'move'), 0, 'non-ship cards keep their price');
});

test('end of turn: keep up to 2, discard the rest and played cards, draw back to 5', () => {
  let g = game();
  let credit;
  [g, credit] = give(g, 0, 'credits'); // hand of 6
  g = act(g, { type: 'playCredit', player: 0, card: credit });
  assert.throws(() => act(g, { type: 'endTurn', player: 0, keep: g.players[0].hand.slice(0, 3) }), /at most 2/);
  const keep = g.players[0].hand.slice(0, 2);
  g = act(g, { type: 'endTurn', player: 0, keep });
  const p = g.players[0];
  assert.equal(p.hand.length, HAND_SIZE);
  assert.deepEqual(p.hand.slice(0, 2), keep, 'kept cards stay in hand');
  assert.equal(p.played.length, 0);
  assert.equal(p.discard.length, 4, '1 played + 3 discarded from hand');
  cardLocations(g);
});

test('only the active player can act; turns go round in order', () => {
  let g = game(3);
  assert.throws(() => act(g, { type: 'playCredit', player: 1, card: find(g, 1, 'credits') }), /Ada's turn/);
  g = act(g, { type: 'endTurn', player: 0 });
  assert.equal(g.active, 1);
  g = act(g, { type: 'endTurn', player: 1 });
  assert.equal(g.active, 2);
  assert.equal(g.round, 1);
});

test('end of round scores key planets and rotates the first player', () => {
  let g = game(3);
  g = deployFighter(g, 0);
  const key = g.map.nodes.find((n) => n.type === 'key' && !n.central).id;
  g = act(g, { type: 'dev.placeShip', ship: shipsOf(g, 0)[0].id, tile: key });
  for (const pid of [0, 1, 2]) g = act(g, { type: 'endTurn', player: pid });
  assert.equal(g.round, 2);
  assert.equal(g.players[0].vp, 2);
  assert.equal(g.players[1].vp, 0);
  assert.equal(g.rounds.length, 1);
  assert.deepEqual(g.rounds[0].scores[0].keys, [key]);
  assert.equal(g.firstPlayer, 1);
  assert.equal(g.active, 1);
  assert.deepEqual(turnOrder(g), [1, 2, 0]);
  for (const pid of [1, 2, 0]) g = act(g, { type: 'endTurn', player: pid });
  assert.equal(g.round, 3);
  assert.equal(g.active, 2);
  assert.equal(g.players[0].vp, 4);
});

test('move: within speed, path costs, void blocks, card is used', () => {
  let g = game(2, 'MOVE-1');
  g = deployFighter(g, 0);
  const ship = shipsOf(g, 0)[0];
  const targets = moveTargets(g, ship.id);
  assert.ok(targets.size > 0);
  for (const [tile, route] of targets) {
    assert.ok(route.cost <= 3);
    assert.notEqual(g.map.nodes[tile].type, 'void');
    assert.ok(hexDistance(g.map.nodes[tile], g.map.nodes[ship.tile]) <= 3);
    // asteroid fields cost 2 to enter
    const pathCost = route.path.slice(1).reduce((s, t) => s + (g.map.nodes[t].type === 'asteroid' ? 2 : 1), 0);
    assert.equal(pathCost, route.cost);
  }
  const [dest] = [...targets.keys()];
  const move = find(g, 0, 'move');
  assert.ok(move, 'a Move card in hand for this seed');
  g = act(g, { type: 'move', player: 0, card: move, ship: ship.id, tile: dest });
  assert.equal(shipsOf(g, 0)[0].tile, dest);
  assert.ok(g.players[0].played.includes(move));
  const far = g.map.nodes.find((n) => n.type !== 'void' && hexDistance(n, g.map.nodes[dest]) > 3).id;
  const [g2, move2] = give(g, 0, 'move');
  assert.throws(() => act(g2, { type: 'move', player: 0, card: move2, ship: ship.id, tile: far }), /out of range/);
  cardLocations(g2);
});

test('ships must stop when entering a tile with enemy ships', () => {
  let g = game(2, 'MOVE-2');
  g = deployFighter(g, 0);
  const mine = shipsOf(g, 0)[0];
  // Put a pirate on a neighbouring open tile and check nothing beyond it is reached through it.
  const pirate = g.ships.find((s) => s.owner === 'pirate');
  const open = reachable(g, mine);
  const step1 = [...open].find(([, r]) => r.path.length === 2 && g.map.nodes[r.path[1]].type === 'empty')[0];
  pirate.tile = step1;
  const after = reachable(g, mine);
  assert.ok(after.has(step1), 'can enter the occupied tile');
  for (const [, r] of after) assert.ok(!r.path.slice(1, -1).includes(step1), 'never passes through it');
});

test('nebulas deal 1 damage on entry and can destroy a ship', () => {
  let g = game(2, 'NEB-1');
  g = deployFighter(g, 0);
  const ship = shipsOf(g, 0)[0];
  const neb = g.map.nodes.find((n) => n.type === 'nebula');
  const nb = g.map.nodes.find((n) => n.type === 'empty' && hexDistance(n, neb) === 1 && !g.ships.some((s) => s.tile === n.id));
  g = act(g, { type: 'dev.placeShip', ship: ship.id, tile: nb.id });
  g.ships.find((s) => s.id === ship.id).hull = 1;
  g = act(g, { type: 'move', player: 0, card: find(g, 0, 'move'), ship: ship.id, tile: neb.id });
  assert.equal(shipsOf(g, 0).length, 0, 'fighter lost');
  assert.ok(g.players[0].discard.includes(ship.card), 'ship card back to discard');
  assert.equal(g.players[0].losses, 1);
  cardLocations(g);
});

test('arriving on a hidden tile reveals it and applies its effect', () => {
  for (let i = 0; i < 40; i++) {
    let g = game(2, `HID-${i}`);
    const node = g.map.nodes.find((n) => n.hidden && n.hiddenContent === 'derelict');
    if (!node) continue;
    g = deployFighter(g, 0);
    const ship = shipsOf(g, 0)[0];
    const nb = g.map.nodes.find((n) => n.type === 'empty' && !n.hidden && hexDistance(n, node) === 1 && !g.ships.some((s) => s.tile === n.id));
    if (!nb || !find(g, 0, 'move')) continue;
    g = act(g, { type: 'dev.placeShip', ship: ship.id, tile: nb.id });
    g = act(g, { type: 'move', player: 0, card: find(g, 0, 'move'), ship: ship.id, tile: node.id });
    assert.ok(g.map.nodes[node.id].revealed);
    assert.equal(g.players[0].credits, 2);
    return;
  }
  assert.fail('no seed with a reachable derelict');
});

test('a full scripted round keeps every card accounted for', () => {
  let g = game(4, 'FULL-1');
  for (let r = 0; r < 3; r++) {
    for (const pid of turnOrder(g)) {
      const f = find(g, pid, 'ship-fighter');
      if (f && shipsOf(g, pid).length === 0) g = act(g, { type: 'deploy', player: pid, card: f, tile: g.players[pid].home });
      for (const c of g.players[pid].hand.filter((u) => g.cards[u].def === 'credits')) g = act(g, { type: 'playCredit', player: pid, card: c });
      if (g.players[pid].credits >= 3) g = act(g, { type: 'buy', player: pid, def: 'ship-freighter' });
      g = act(g, { type: 'endTurn', player: pid, keep: g.players[pid].hand.slice(0, 1) });
      cardLocations(g);
    }
  }
  assert.equal(g.round, 4);
  for (const p of g.players) assert.equal(p.hand.length, HAND_SIZE);
});
