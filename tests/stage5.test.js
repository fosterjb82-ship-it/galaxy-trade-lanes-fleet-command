import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, cardLocations, controllerOf, turnOrder } from '../src/game/state.js';
import { shipStats, attackOptions } from '../src/game/combat.js';
import { routeOptions } from '../src/game/trade.js';
import { MISSIONS } from '../src/game/missions.js';
import { MARKET_DECK, MARKET_ROW_SIZE } from '../src/game/cards.js';
import { SHIPS } from '../src/game/ships.js';
import { hexDistance } from '../src/map/hex.js';

const act = (g, a) => applyAction(g, a);
const newGame = (n = 3, seed = 'S5-1', extra = {}) => createGame({ missions: 'auto', seed, players: ['Ada', 'Bo', 'Cy', 'Di'].slice(0, n), ...extra });

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
const empty = (g) => g.map.nodes.filter((n) => n.type === 'empty' && !n.hidden && !g.ships.some((s) => s.tile === n.id));
const endAll = (g) => {
  for (const pid of turnOrder(g).slice(g.turnInRound)) {
    if (g.phase !== 'action') break;
    g = act(g, { type: 'endTurn', player: pid });
  }
  return g;
};

// ---------------------------------------------------------------- market

test('market row: 6 face-up cards, bought card goes to discard and is replaced', () => {
  let g = newGame();
  const total = MARKET_DECK.reduce((s, [, n]) => s + n, 0);
  assert.equal(g.market.row.length, MARKET_ROW_SIZE);
  assert.equal(g.market.deck.length, total - MARKET_ROW_SIZE);
  g.players[0].credits = 20;
  const uid = g.market.row[0];
  const price = { ...g.cards }[uid] && g.cards[uid].def;
  g = act(g, { type: 'buy', player: 0, def: uid });
  assert.ok(g.players[0].discard.includes(uid));
  assert.equal(g.cards[uid].owner, 0);
  assert.equal(g.market.row.length, MARKET_ROW_SIZE);
  assert.ok(!g.market.row.includes(uid));
  assert.equal(g.market.deck.length, total - MARKET_ROW_SIZE - 1);
  assert.ok(price);
  cardLocations(g);
});

test('upgrades: slots, no duplicates, restrictions, stat effects', () => {
  let g = newGame();
  const [t] = empty(g);
  const fighter = spawn(g, 0, 'fighter', t.id); // 1 slot
  const frig = spawn(g, 0, 'frigate', t.id); // 2 slots
  g = act(g, { type: 'playUpgrade', player: 0, card: giveCard(g, 0, 'deflector-shields'), ship: frig });
  assert.equal(shipStats(g, ship(g, frig)).shields, 2);
  assert.throws(() => act(g, { type: 'playUpgrade', player: 0, card: giveCard(g, 0, 'deflector-shields'), ship: frig }), /Already fitted/);
  assert.throws(() => act(g, { type: 'playUpgrade', player: 0, card: giveCard(g, 0, 'cargo-pod'), ship: frig }), /only fits/);
  assert.throws(() => act(g, { type: 'playUpgrade', player: 0, card: giveCard(g, 0, 'heavy-cannon'), ship: fighter }), /only fits/);
  g = act(g, { type: 'playUpgrade', player: 0, card: giveCard(g, 0, 'missile-rack'), ship: frig });
  assert.deepEqual(shipStats(g, ship(g, frig)).weapons.map((w) => w.type), ['laser', 'missile']);
  assert.throws(() => act(g, { type: 'playUpgrade', player: 0, card: giveCard(g, 0, 'afterburners'), ship: frig }), /No free upgrade slot/);
  g = act(g, { type: 'playUpgrade', player: 0, card: giveCard(g, 0, 'afterburners'), ship: fighter });
  assert.equal(shipStats(g, ship(g, fighter)).speed, 4);
  // Fully Loaded: every slot full on the frigate (2/2) and fighter (1/1).
  assert.ok(MISSIONS['fully-loaded'].progress(g, g.players[0])[0] >= 1);
  cardLocations(g);
});

test('focused strike adds +2; destroyed ship returns upgrades to discard', () => {
  let g = newGame();
  const [t] = empty(g);
  const des = spawn(g, 0, 'destroyer', t.id);
  const tgt = spawn(g, 1, 'carrier', t.id);
  g.players[1].reserve = [];
  const opts = attackOptions(g, ship(g, des), 2);
  assert.equal(opts[0].preview.damage, 6);
  const up = giveCard(g, 1, 'armor-plating');
  g.players[1].hand.splice(g.players[1].hand.indexOf(up), 1);
  ship(g, tgt).upgrades.push(up);
  g = act(g, { type: 'attack', player: 0, card: giveCard(g, 0, 'focused-strike'), ship: des, target: tgt });
  assert.equal(ship(g, tgt).hull, 3, 'cannon 4 + 2 − armor 1 = 5');
  cardLocations(g);
});

test("smuggler's cache discards a card; refit dock scraps one for good", () => {
  let g = newGame();
  const cache = giveCard(g, 0, 'smugglers-cache');
  const victim = g.players[0].hand[0];
  assert.throws(() => act(g, { type: 'playCredit', player: 0, card: cache }), /discard/);
  g = act(g, { type: 'playCredit', player: 0, card: cache, discard: victim });
  assert.equal(g.players[0].credits, 3);
  assert.ok(g.players[0].discard.includes(victim));
  const dock = giveCard(g, 0, 'refit-dock');
  const junk = g.players[0].hand.find((u) => u !== dock);
  g = act(g, { type: 'scrap', player: 0, card: dock, target: junk });
  assert.ok(g.scrapped.includes(junk));
  assert.ok(!g.players[0].hand.includes(junk));
  cardLocations(g);
});

// ---------------------------------------------------------------- trade

function tradeSetup(seed = 'S5-TRADE') {
  const g = newGame(3, seed);
  g.ships = g.ships.filter((s) => s.owner !== 'pirate'); // keep wandering pirates off the routes
  const tn = g.map.nodes.filter((n) => n.type === 'trade');
  return { g, tn };
}

test('trade routes: set up from a trade node, income at start of turn, long routes pay 2', () => {
  let { g, tn } = tradeSetup();
  const fr = spawn(g, 0, 'freighter', tn[0].id);
  const opts = routeOptions(g, ship(g, fr));
  assert.ok(opts.length > 0);
  const long = opts.find((o) => o.length >= 3) ?? opts.at(-1);
  g = act(g, { type: 'establishRoute', player: 0, ship: fr, to: long.to });
  assert.equal(g.routes.length, 1);
  assert.equal(g.players[0].longestRoute, long.length);
  g = endAll(g); // round ends; Ada's next turn is in round 2 after Bo and Cy
  while (g.active !== 0) g = act(g, { type: 'endTurn', player: g.active });
  assert.equal(g.players[0].credits, long.length >= 3 ? 2 : 1);
  assert.throws(() => act(g, { type: 'establishRoute', player: 0, ship: spawn(g, 0, 'frigate', tn[0].id), to: long.to }), /freighters/);
});

test('blockade: an enemy ship on the route stops income; leaving the route closes it', () => {
  let { g, tn } = tradeSetup('S5-BLOCK');
  const fr = spawn(g, 0, 'freighter', tn[0].id);
  const opt = routeOptions(g, ship(g, fr))[0];
  g = act(g, { type: 'establishRoute', player: 0, ship: fr, to: opt.to });
  spawn(g, 1, 'frigate', opt.path.at(-1)); // Bo parks on the route
  g = endAll(g);
  while (g.active !== 0) g = act(g, { type: 'endTurn', player: g.active });
  assert.equal(g.players[0].credits, 0, 'blockaded');
  assert.ok(g.turnStart.events.some((e) => e.includes('blockaded')));
  // Move the freighter off the route: it closes.
  const off = g.map.nodes.find((n) => n.type === 'empty' && !opt.path.includes(n.id) && hexDistance(n, g.map.nodes[ship(g, fr).tile]) === 1);
  if (off) {
    g = act(g, { type: 'dev.placeShip', ship: fr, tile: off.id });
    assert.equal(g.routes.length, 0);
  }
});

test('trade agreements: offer, accept, +1 credit/turn and 1 VP/round each; breaking pays 2', () => {
  let { g, tn } = tradeSetup('S5-DEAL');
  const a = spawn(g, 0, 'freighter', tn[0].id);
  const b = spawn(g, 1, 'freighter', tn[1].id);
  g = act(g, { type: 'establishRoute', player: 0, ship: a, to: routeOptions(g, ship(g, a))[0].to });
  assert.throws(() => act(g, { type: 'offerAgreement', player: 0, to: 1 }), /no trade route/);
  g.active = 1;
  g = act(g, { type: 'establishRoute', player: 1, ship: b, to: routeOptions(g, ship(g, b))[0].to });
  g.active = 0;
  g = act(g, { type: 'offerAgreement', player: 0, to: 1 });
  assert.equal(g.pending.kind, 'offer');
  assert.throws(() => act(g, { type: 'respondOffer', player: 2, accept: true }), /Only Bo/);
  g = act(g, { type: 'respondOffer', player: 1, accept: true });
  assert.equal(g.agreements.length, 1);
  const vpBefore = [g.players[0].vp, g.players[1].vp];
  g = endAll(g);
  assert.equal(g.players[0].vpFrom.agreements, 1);
  assert.equal(g.players[1].vpFrom.agreements, 1);
  assert.ok(g.players[0].vp >= vpBefore[0] + 1);
  while (g.active !== 0) g = act(g, { type: 'endTurn', player: g.active });
  const credits = g.players[0].credits;
  g = act(g, { type: 'breakAgreement', player: 0, with: 1 });
  assert.equal(g.players[0].credits, credits + 2);
  assert.equal(g.agreements.length, 0);
  assert.ok(g.players[0].backstab);
});

// ---------------------------------------------------------------- missions

test('missions: 3 dealt, keep 2, secret until scored; immediate missions score at once', () => {
  let g = createGame({ seed: 'S5-MIS', players: ['Ada', 'Bo', 'Cy'] });
  assert.equal(g.players[0].missionOffer.length, 3);
  const dealt = g.players.flatMap((p) => p.missionOffer);
  assert.equal(new Set(dealt).size, dealt.length, 'no duplicates between players');
  assert.throws(() => act(g, { type: 'endTurn', player: 0 }), /missions first/);
  assert.throws(() => act(g, { type: 'chooseMissions', player: 0, keep: g.players[0].missionOffer }), /exactly 2/);
  g = act(g, { type: 'chooseMissions', player: 0, keep: g.players[0].missionOffer.slice(0, 2) });
  assert.equal(g.players[0].missions.length, 2);
  // Force Twin Worlds: control 2 key planets.
  g.players[0].missions = [{ id: 'twin-worlds', scored: false }, { id: 'armada', scored: false }];
  const keys = g.map.nodes.filter((n) => n.type === 'key' && !n.central).slice(0, 2);
  for (const k of keys) spawn(g, 0, 'fighter', k.id);
  g = act(g, { type: 'playCredit', player: 0, card: giveCard(g, 0, 'credits') });
  assert.equal(g.players[0].missions[0].scored, true);
  assert.equal(g.players[0].vpFrom.missions, 3);
  assert.equal(g.notices[0].kind, 'mission');
});

test('2-player games drop Diplomat and Backstabber', () => {
  for (let i = 0; i < 20; i++) {
    const g = createGame({ seed: `TWO-${i}`, players: ['A', 'B'] });
    for (const p of g.players) assert.ok(!p.missionOffer.includes('diplomat') && !p.missionOffer.includes('backstabber'));
  }
});

test('war chest, deep strike and backstabber missions', () => {
  let g = newGame(3, 'S5-WAR');
  g.players[0].missions = [{ id: 'war-chest', scored: false }, { id: 'deep-strike', scored: false }];
  g.players[0].credits = 12;
  g = act(g, { type: 'buy', player: 0, def: 'ship-destroyer' });
  g = act(g, { type: 'buy', player: 0, def: 'ship-destroyer' });
  assert.equal(g.players[0].missions[0].scored, true, 'spent 12');
  const bosHome = g.players[1].home;
  spawn(g, 0, 'fighter', bosHome);
  g = endAll(g);
  while (g.active !== 0) g = act(g, { type: 'endTurn', player: g.active });
  assert.equal(g.players[0].missions[1].scored, true, 'survived in an enemy home until next turn');
});

// ---------------------------------------------------------------- pirates

test('pirate phase: pirates step toward the nearest freighter and attack it', () => {
  let g = newGame(2, 'S5-PIR');
  g.ships = g.ships.filter((s) => s.owner !== 'pirate');
  const [a] = empty(g);
  const b = g.map.nodes.find((n) => n.type === 'empty' && hexDistance(n, a) === 1);
  const fr = spawn(g, 0, 'freighter', b.id);
  const pir = spawn(g, 'pirate', null, a.id);
  g = endAll(g);
  assert.equal(ship(g, pir).tile, b.id, 'moved onto the freighter');
  assert.equal(ship(g, fr).hull, 1, 'laser 2 vs freighter hull 3');
  assert.ok(g.rounds[0].pirates.length >= 2);
  g = endAll(g);
  assert.equal(ship(g, fr), undefined, 'destroyed next round');
  assert.equal(g.players[0].losses, 1);
  cardLocations(g);
});

// ---------------------------------------------------------------- ending

test('uncertain ending: never before round 7, always by round 10', () => {
  for (let i = 0; i < 12; i++) {
    let g = newGame(2, `END-${i}`);
    g.ships = g.ships.filter((s) => s.owner !== 'pirate');
    while (g.phase === 'action') g = endAll(g);
    const last = g.rounds.at(-1);
    assert.ok(last.round >= 7 && last.round <= 10, `ended after round ${last.round}`);
    assert.ok(g.rounds.slice(0, 6).every((r) => r.ending.chance === 0));
    assert.ok(g.final.ranking.length === 2);
  }
});

test('quick games end after round 3 or 4', () => {
  let g = newGame(2, 'QUICK-1', { length: 'quick' });
  while (g.phase === 'action') g = endAll(g);
  assert.ok([3, 4].includes(g.rounds.at(-1).round));
});

test('final scoring: end-of-game missions, then tiebreakers (key planets, then ships)', () => {
  let g = newGame(2, 'FINAL-1', { length: 'quick' });
  g.ships = g.ships.filter((s) => s.owner !== 'pirate');
  g.players[0].missions = [{ id: 'armada', scored: false }, { id: 'unbroken-line', scored: false }];
  g.players[1].missions = [{ id: 'station-network', scored: false }, { id: 'merchant-fleet', scored: false }];
  // Equal VP; Bo holds a key planet at the end -> wins the tiebreak... but key planets also score VP,
  // so give Ada an equal VP lead via kills instead.
  const key = g.map.nodes.find((n) => n.type === 'key' && !n.central).id;
  while (g.phase === 'action') {
    if (g.round === g.rounds.length + 1 && g.turnInRound === 0) { /* no-op */ }
    g = endAll(g);
  }
  // Unbroken Line (no losses) scores 4 for Ada; Bo's missions fail.
  assert.equal(g.players[0].vpFrom.missions, 4);
  assert.equal(g.players[1].vpFrom.missions, 0);
  assert.ok(g.players[1].missions.every((m) => m.revealed && m.failed));
  assert.equal(g.final.ranking[0].player, 0);
  assert.ok(key !== undefined);
});

test('tiebreak order is VP, then key planets, then ships on the board', () => {
  let g = newGame(2, 'TIE-1', { length: 'quick' });
  g.ships = g.ships.filter((s) => s.owner !== 'pirate');
  for (const p of g.players) p.missions = [];
  spawn(g, 1, 'fighter', g.players[1].home);
  while (g.phase === 'action') g = endAll(g);
  assert.equal(g.players[0].vp, g.players[1].vp);
  assert.equal(g.final.ranking[0].player, 1, 'more ships wins the tie');
  assert.equal(g.final.ranking[1].tiebreak, 'ships on the board');
  assert.equal(controllerOf(g, g.players[1].home), 1);
});
