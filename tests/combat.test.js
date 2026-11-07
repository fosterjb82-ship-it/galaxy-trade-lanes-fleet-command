import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, cardLocations, shipsOf, reactionCheck } from '../src/game/state.js';
import { damageFor, shipStats, attackOptions, CANNON_PIERCE } from '../src/game/combat.js';
import { hexDistance } from '../src/map/hex.js';
import { SHIPS } from '../src/game/ships.js';

const act = (g, a) => applyAction(g, a);
const newGame = (n = 2, seed = 'WAR-1') => createGame({ seed, players: ['Ada', 'Bo', 'Cy'].slice(0, n) });

/** Put a ship of `type` for `owner` on `tile` (card attached like a real deploy). */
function spawn(g, owner, type, tile, hull) {
  if (owner === 'pirate') {
    g.ships.push({ id: `s${g.nextId++}`, owner: 'pirate', type: 'pirate', tile, hull: hull ?? 4, upgrades: [] });
    return g.ships.at(-1).id;
  }
  const uid = `c${g.nextId++}`;
  g.cards[uid] = { uid, def: `ship-${type}`, owner };
  g.ships.push({ id: `s${g.nextId++}`, owner, type, tile, hull: hull ?? SHIPS[type].hull, card: uid, upgrades: [] });
  return g.ships.at(-1).id;
}
function giveCard(g, pid, def, zone = 'hand') {
  const uid = `c${g.nextId++}`;
  g.cards[uid] = { uid, def, owner: pid };
  g.players[pid][zone].push(uid);
  return uid;
}
const ship = (g, id) => g.ships.find((s) => s.id === id);
/** An open tile with no ships, and an open neighbour of it. */
function arena(g) {
  const free = (n) => n.type === 'empty' && !n.hidden && !g.ships.some((s) => s.tile === n.id);
  const a = g.map.nodes.find((n) => free(n) && g.map.nodes.some((m) => free(m) && hexDistance(m, n) === 1));
  const b = g.map.nodes.find((m) => free(m) && hexDistance(m, a) === 1);
  return [a.id, b.id];
}

test('damage maths: fixed damage minus shields and armor; cannons pierce shields', () => {
  const laser = { type: 'laser', damage: 2, range: 0 };
  const cannon = { type: 'cannon', damage: 4, range: 0 };
  const none = { pierce: 0 };
  assert.equal(damageFor(laser, none, { shields: 0, armor: 0 }).damage, 2);
  assert.equal(damageFor(laser, none, { shields: 2, armor: 0 }).damage, 0, 'lasers are weak against shields');
  assert.equal(damageFor(cannon, none, { shields: 2, armor: 1 }).damage, 3, `cannon ignores ${CANNON_PIERCE} shields`);
  assert.equal(damageFor(laser, none, { shields: 0, armor: 0 }, { bonus: 1 }).damage, 3, 'attack card bonus');
  assert.equal(damageFor(laser, none, { shields: 0, armor: 0 }, { evasive: true }).damage, 0);
  assert.equal(damageFor(laser, none, { shields: 0, armor: 0 }, { extraShields: 3 }).damage, 0);
  assert.equal(damageFor(laser, { pierce: 1 }, { shields: 1, armor: 1 }).damage, 1, 'targeting computer ignores 1');
  assert.equal(damageFor({ type: 'ion', damage: 0 }, none, { shields: 0, armor: 0 }).ion, true);
  assert.equal(shipStats({ cards: {} }, { owner: 0, type: 'destroyer', upgrades: [] }).armor, 1, 'destroyer armor 1');
});

test('attack: in-range targets only, exact damage, 1 VP on a kill, card returns to discard', () => {
  let g = newGame();
  const [a, b] = arena(g);
  const frig = spawn(g, 0, 'frigate', a);
  const enemy = spawn(g, 1, 'fighter', a);
  const far = spawn(g, 1, 'fighter', b);
  const opts = attackOptions(g, ship(g, frig));
  assert.deepEqual(opts.map((o) => o.target.id).sort(), [enemy], 'lasers have range 0');
  assert.equal(opts[0].preview.damage, 2);
  const atkCard = giveCard(g, 0, 'attack');
  assert.throws(() => act(g, { type: 'attack', player: 0, card: atkCard, ship: frig, target: far }), /out of range/);
  const enemyCard = ship(g, enemy).card;
  g = act(g, { type: 'attack', player: 0, card: atkCard, ship: frig, target: enemy });
  assert.equal(ship(g, enemy), undefined, 'fighter (hull 2) destroyed by laser 2');
  assert.equal(g.players[0].vp, 1);
  assert.equal(g.players[0].kills, 1);
  assert.ok(g.players[1].discard.includes(enemyCard));
  assert.equal(g.players[1].losses, 1);
  cardLocations(g);
});

test('each ship fires once per turn; unarmed and disabled ships cannot fire', () => {
  let g = newGame();
  const [a] = arena(g);
  const des = spawn(g, 0, 'destroyer', a);
  const fr = spawn(g, 0, 'freighter', a);
  const enemy = spawn(g, 1, 'carrier', a);
  g = act(g, { type: 'attack', player: 0, card: giveCard(g, 0, 'attack'), ship: des, target: enemy });
  assert.equal(ship(g, enemy).hull, 4, 'cannon 4 vs carrier hull 8');
  assert.throws(() => act(g, { type: 'attack', player: 0, card: giveCard(g, 0, 'attack'), ship: des, target: enemy }), /Already fired/);
  assert.throws(() => act(g, { type: 'attack', player: 0, card: giveCard(g, 0, 'attack'), ship: fr, target: enemy }), /unarmed/);
});

test('missiles hit adjacent tiles; point defense cancels them', () => {
  let g = newGame();
  const [a, b] = arena(g);
  const corv = spawn(g, 0, 'corvette', a);
  const target = spawn(g, 1, 'frigate', b);
  const opts = attackOptions(g, ship(g, corv));
  assert.ok(opts.some((o) => o.target.id === target), 'range 1 reaches the neighbour');
  const pd = giveCard(g, 1, 'point-defense', 'reserve');
  g = act(g, { type: 'attack', player: 0, card: giveCard(g, 0, 'attack'), ship: corv, target });
  assert.equal(g.pending.kind, 'reaction');
  assert.equal(g.pending.defender, 1);
  assert.throws(() => act(g, { type: 'endTurn', player: 0 }), /Waiting for Bo/);
  g = act(g, { type: 'react', player: 1, card: pd });
  assert.equal(ship(g, target).hull, 4, 'no damage');
  assert.equal(g.pending, null);
  assert.ok(g.players[1].discard.includes(pd));
  cardLocations(g);
});

test('reactions: evasive, emergency shields, return fire, retreat', () => {
  // Evasive: frigate laser 2 vs fighter -> 0
  let g = newGame();
  let [a, b] = arena(g);
  let atk = spawn(g, 0, 'frigate', a);
  let tgt = spawn(g, 1, 'fighter', a);
  let card = giveCard(g, 1, 'evasive', 'reserve');
  g = act(g, { type: 'attack', player: 0, card: giveCard(g, 0, 'attack'), ship: atk, target: tgt });
  g = act(g, { type: 'react', player: 1, card });
  assert.equal(ship(g, tgt).hull, 2);

  // Evasive is refused for a destroyer.
  g = newGame();
  [a, b] = arena(g);
  atk = spawn(g, 0, 'frigate', a);
  tgt = spawn(g, 1, 'destroyer', a);
  card = giveCard(g, 1, 'evasive', 'reserve');
  g = act(g, { type: 'attack', player: 0, card: giveCard(g, 0, 'attack'), ship: atk, target: tgt });
  assert.match(reactionCheck(g, g.pending, card), /fighters and frigates/);
  assert.throws(() => act(g, { type: 'react', player: 1, card }), /fighters and frigates/);
  // Emergency shields instead: cannon? no, laser 2 - armor 1 - 3 shields = 0
  const shields = giveCard(g, 1, 'emergency-shields', 'reserve');
  g = act(g, { type: 'react', player: 1, card: shields });
  assert.equal(ship(g, tgt).hull, 6);

  // Return fire: frigate hits destroyer for 1 (armor), destroyer survives and fires back cannon 4.
  g = newGame();
  [a, b] = arena(g);
  atk = spawn(g, 0, 'frigate', a);
  tgt = spawn(g, 1, 'destroyer', a);
  card = giveCard(g, 1, 'return-fire', 'reserve');
  g = act(g, { type: 'attack', player: 0, card: giveCard(g, 0, 'attack'), ship: atk, target: tgt });
  g = act(g, { type: 'react', player: 1, card });
  assert.equal(ship(g, tgt).hull, 5);
  assert.equal(ship(g, atk), undefined, 'frigate (hull 4) destroyed by return fire');
  assert.equal(g.players[1].vp, 1, 'defender scores the kill');

  // Retreat: move 1 tile, attack misses.
  g = newGame();
  [a, b] = arena(g);
  atk = spawn(g, 0, 'frigate', a);
  tgt = spawn(g, 1, 'frigate', a);
  card = giveCard(g, 1, 'retreat', 'reserve');
  g = act(g, { type: 'attack', player: 0, card: giveCard(g, 0, 'attack'), ship: atk, target: tgt });
  assert.throws(() => act(g, { type: 'react', player: 1, card, tile: a }), /neighbouring/);
  g = act(g, { type: 'react', player: 1, card, tile: b });
  assert.equal(ship(g, tgt).tile, b);
  assert.equal(ship(g, tgt).hull, 4);
  cardLocations(g);
});

test('no reaction prompt when the defender holds no cards', () => {
  let g = newGame();
  const [a] = arena(g);
  const atk = spawn(g, 0, 'frigate', a);
  const tgt = spawn(g, 1, 'frigate', a);
  g.players[1].reserve = [];
  g = act(g, { type: 'attack', player: 0, card: giveCard(g, 0, 'attack'), ship: atk, target: tgt });
  assert.equal(g.pending, null);
  assert.equal(ship(g, tgt).hull, 2);
});

test('the defender may decline; only one reaction per attack', () => {
  let g = newGame();
  const [a] = arena(g);
  const atk = spawn(g, 0, 'frigate', a);
  const tgt = spawn(g, 1, 'frigate', a);
  giveCard(g, 1, 'evasive', 'reserve');
  giveCard(g, 1, 'emergency-shields', 'reserve');
  g = act(g, { type: 'attack', player: 0, card: giveCard(g, 0, 'attack'), ship: atk, target: tgt });
  assert.throws(() => act(g, { type: 'react', player: 0, card: null }), /Only Bo/);
  g = act(g, { type: 'react', player: 1, card: null });
  assert.equal(ship(g, tgt).hull, 2);
  assert.equal(g.players[1].reserve.length, 2, 'cards kept');
});

test('ion disables the target for its owner\'s next turn, then it recovers', () => {
  let g = newGame();
  const [a, b] = arena(g);
  const ion = spawn(g, 0, 'interceptor', a);
  const tgt = spawn(g, 1, 'frigate', a);
  g.players[1].reserve = [];
  g = act(g, { type: 'attack', player: 0, card: giveCard(g, 0, 'attack'), ship: ion, target: tgt });
  assert.equal(ship(g, tgt).hull, 4, 'no damage');
  g = act(g, { type: 'endTurn', player: 0 });
  // Bo's turn: the frigate can't move or attack.
  assert.ok(ship(g, tgt).disabled !== undefined);
  assert.throws(() => act(g, { type: 'move', player: 1, card: giveCard(g, 1, 'move'), ship: tgt, tile: b }), /disabled/);
  assert.throws(() => act(g, { type: 'attack', player: 1, card: giveCard(g, 1, 'attack'), ship: tgt, target: ion }), /Disabled/);
  g = act(g, { type: 'endTurn', player: 1 });
  g = act(g, { type: 'endTurn', player: 1 === g.active ? 1 : g.active });
  assert.equal(ship(g, tgt).disabled, undefined, 'recovered');
});

test('pirate fleets can be attacked and give 1 VP', () => {
  let g = newGame();
  const [a] = arena(g);
  const des = spawn(g, 0, 'destroyer', a);
  const pir = spawn(g, 'pirate', null, a);
  g = act(g, { type: 'attack', player: 0, card: giveCard(g, 0, 'attack'), ship: des, target: pir });
  assert.equal(ship(g, pir), undefined);
  assert.equal(g.players[0].vp, 1);
  assert.deepEqual(g.players[0].killLog, [{ type: 'pirate', owner: 'pirate' }]);
});

test('ambush: an enemy moving onto your tile can be hit first', () => {
  let g = newGame();
  const [a, b] = arena(g);
  const mover = spawn(g, 0, 'fighter', b);
  const ambusher = spawn(g, 1, 'frigate', a);
  const amb = giveCard(g, 1, 'ambush', 'reserve');
  g = act(g, { type: 'move', player: 0, card: giveCard(g, 0, 'move'), ship: mover, tile: a });
  assert.equal(g.pending.kind, 'ambush');
  const evasive = giveCard(g, 1, 'evasive', 'reserve');
  assert.throws(() => act(g, { type: 'react', player: 1, card: evasive, ship: ambusher }), /Only Ambush/);
  g = act(g, { type: 'react', player: 1, card: amb, ship: ambusher });
  assert.equal(ship(g, mover), undefined, 'fighter shot down on arrival');
  assert.equal(g.players[1].vp, 1);
  cardLocations(g);
});

test('repair cards and start-of-turn repairs', () => {
  let g = newGame();
  const [a] = arena(g);
  const frig = spawn(g, 0, 'frigate', a, 1);
  const rep = giveCard(g, 0, 'repair');
  g = act(g, { type: 'repair', player: 0, card: rep, ship: frig });
  assert.equal(ship(g, frig).hull, 3);
  assert.throws(() => act(g, { type: 'repair', player: 0, card: giveCard(g, 0, 'field-repairs'), ship: spawn(g, 0, 'fighter', a) }), /not damaged/);

  // Station: full repair at the start of the owner's turn.
  const station = g.map.nodes.find((n) => n.type === 'station' && !g.ships.some((s) => s.tile === n.id)).id;
  const damaged = spawn(g, 1, 'destroyer', station, 1);
  // Carrier: +2 to other ships on its tile.
  const [, b] = arena(g);
  spawn(g, 1, 'carrier', b);
  const withCarrier = spawn(g, 1, 'frigate', b, 1);
  g = act(g, { type: 'endTurn', player: 0 });
  assert.equal(ship(g, damaged).hull, 6);
  assert.equal(ship(g, withCarrier).hull, 3);
  assert.equal(g.turnStart.events.length, 2);
});

test('kept cards become a hidden reserve and come back to hand next turn', () => {
  let g = newGame();
  const keep = g.players[0].hand.slice(0, 2);
  g = act(g, { type: 'endTurn', player: 0, keep });
  assert.deepEqual(g.players[0].reserve, keep);
  assert.equal(g.players[0].hand.length, 3);
  g = act(g, { type: 'endTurn', player: 1 }); // end of round 1
  g = act(g, { type: 'endTurn', player: 1 }); // Bo goes first in round 2
  assert.equal(g.active, 0);
  assert.deepEqual(g.players[0].reserve, []);
  assert.deepEqual(g.players[0].hand.slice(0, 2), keep);
  assert.equal(shipsOf(g, 0).length, 0);
  cardLocations(g);
});
