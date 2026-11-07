// Stage 2 game screen: the board with ships, the active player's hand,
// Command Points, and a sandbox panel for testing until turn flow exists.

import { allCosts, enterCost } from '../map/generator.js';
import { Board } from '../render/board.js';
import { unitLayer } from '../render/units.js';
import { PLAYER_COLORS } from '../render/sprites.js';
import { CARDS, CARD_TYPE, cardDef } from '../game/cards.js';
import { SHIPS, shipDef } from '../game/ships.js';
import {
  applyAction, controllerOf, cpCapacity, cpUsed, deployCheck, shipsAt, shipsOf, GameError,
} from '../game/state.js';
import { h, spriteIcon } from './dom.js';
import { cardFace } from './card.js';
import { tileDetails, tileTitle } from './details.js';
import { loadGame, saveGame, clearGame } from './storage.js';

const CP_LABEL = { home: 'Home sector', key: 'Key planet', station: 'Station' };

export function mountGame(root) {
  let state = loadGame();
  if (!state) {
    location.hash = '';
    return;
  }
  const costs = allCosts(state.map.nodes);
  let mode = { kind: 'idle' }; // idle | deploy {card, tiles} | place {ship, tiles}
  let openTile = null;

  // ---------------------------------------------------------- layout
  const roundLabel = h('span.round');
  const activeChip = h('span.active-chip');
  const toast = h('div.game-toast');
  const topbar = h('header.topbar',
    h('div.brand', h('h1', 'Fleet Command'), h('span.stage', 'Stage 2 · Core game state')),
    roundLabel, activeChip,
    h('span.spacer'),
    h('a.button', { href: `#lab&seed=${encodeURIComponent(state.mapSeed)}&players=${state.players.length}` }, 'Map Lab'),
    h('button', {
      onclick: () => {
        if (confirm('Abandon this game and set up a new one?')) {
          clearGame();
          location.hash = '';
        }
      },
    }, 'New game'));

  const canvas = h('canvas.board');
  const zoomLabel = h('span.zoom-level');
  const modeBar = h('div.mode-bar');
  const details = h('aside.details');
  const boardWrap = h('div.board-wrap', canvas,
    h('div.zoom',
      h('button', { 'aria-label': 'Zoom in', title: 'Zoom in (+)', onclick: () => board.zoomBy(1) }, '+'),
      zoomLabel,
      h('button', { 'aria-label': 'Zoom out', title: 'Zoom out (−)', onclick: () => board.zoomBy(-1) }, '−'),
      h('button.fit', { title: 'Fit board (0)', onclick: () => board.fit() }, 'Fit')),
    modeBar, details, toast);
  const handBar = h('section.hand-bar');
  const sidebar = h('aside.sidebar');
  root.append(topbar, h('div.main', h('div.play-col', boardWrap, handBar), sidebar));

  const board = new Board(canvas);
  board.on('zoom', (s) => { zoomLabel.textContent = `${s}×`; });
  board.decorators.push(unitLayer(() => ({
    state,
    targets: mode.kind === 'idle' ? [] : mode.tiles,
    selectedShip: mode.kind === 'place' ? mode.ship : null,
  })));
  // Tile names give way to ships (the details pane still shows them).
  board.setOptions({ labelFilter: (n) => !state.ships.some((s) => s.tile === n.id) });
  board.setMap(state.map);

  // ---------------------------------------------------------- actions

  let toastTimer = null;
  function say(text, kind = 'info') {
    toast.textContent = text;
    toast.className = `game-toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function dispatch(action) {
    try {
      state = applyAction(state, action);
      saveGame(state);
      return true;
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
      say(e.message, 'error');
      return false;
    } finally {
      render();
    }
  }

  function setMode(next) {
    mode = next;
    render();
  }

  function clickCard(uid) {
    const def = cardDef(state.cards[uid]);
    if (mode.kind === 'deploy' && mode.card === uid) return setMode({ kind: 'idle' });
    if (def.type !== CARD_TYPE.SHIP) return say(`${def.name} cards are played in Stage 3 (turn flow).`);
    const check = deployCheck(state, state.active, uid);
    if (!check.ok) return say(check.reason, 'error');
    closeDetails(); // keep the deploy targets visible
    setMode({ kind: 'deploy', card: uid, tiles: check.tiles });
  }

  board.on('click', (tile) => {
    if (tile === null) {
      if (mode.kind !== 'idle') return setMode({ kind: 'idle' });
      return closeDetails();
    }
    if (mode.kind === 'deploy') {
      if (!mode.tiles.includes(tile)) return say('Deploy at a highlighted tile: one you control, or your carrier\'s tile.', 'error');
      const card = mode.card;
      mode = { kind: 'idle' };
      const name = CARDS[state.cards[card].def].name;
      if (dispatch({ type: 'deploy', player: state.active, card, tile })) say(`${name} deployed at ${tileTitle(state.map.nodes[tile])}.`);
      return;
    }
    if (mode.kind === 'place') {
      if (enterCost(state.map.nodes[tile].type) === Infinity) return say('Ships cannot enter a void rift.', 'error');
      const ship = mode.ship;
      mode = { kind: 'idle' };
      if (dispatch({ type: 'dev.placeShip', ship, tile })) openDetails(tile);
      return;
    }
    if (tile === openTile) closeDetails();
    else openDetails(tile);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'Escape') {
      if (mode.kind !== 'idle') setMode({ kind: 'idle' });
      else closeDetails();
    }
    if (e.key === '+' || e.key === '=') board.zoomBy(1);
    if (e.key === '-' || e.key === '_') board.zoomBy(-1);
    if (e.key === '0') board.fit();
  });

  // ---------------------------------------------------------- details pane

  function closeDetails() {
    openTile = null;
    board.select(null);
    details.classList.remove('open');
  }

  function ownerName(owner) {
    return owner === 'pirate' ? 'Pirates' : state.players[owner].name;
  }

  function shipRow(ship) {
    const def = shipDef(ship);
    const mine = ship.owner === state.active;
    const color = ship.owner === 'pirate' ? '#ff8a7a' : PLAYER_COLORS[ship.owner].light;
    return h('li.ship-row',
      spriteIcon(`ship:${ship.owner === 'pirate' ? 'frigate' : ship.type}:${ship.owner === 'pirate' ? 'pirate' : ship.owner}`, 26),
      h('div',
        h('div', h('b', def.name), h('span', { style: { color } }, ` · ${ownerName(ship.owner)}`)),
        h('div.muted.small',
          `Hull ${ship.hull}/${def.hull} · Speed ${def.speed} · ` +
          `${def.weapon ? `${def.weapon.type} ${def.weapon.damage}` : 'unarmed'}` +
          `${def.armor ? ` · armor ${def.armor}` : ''}${def.cp ? ` · ${def.cp} CP` : ''}`),
        def.special && h('div.muted.small', def.special)),
      mine && h('button.small-btn', {
        title: 'Sandbox: put this ship on any open tile (real movement arrives in Stage 3)',
        onclick: () => {
          const tiles = state.map.nodes.filter((n) => enterCost(n.type) !== Infinity).map((n) => n.id);
          closeDetails();
          setMode({ kind: 'place', ship: ship.id, tiles });
        },
      }, 'Reposition'));
  }

  function openDetails(tile) {
    openTile = tile;
    board.select(tile);
    const ships = shipsAt(state, tile);
    const ctrl = controllerOf(state, tile);
    const node = state.map.nodes[tile];
    let controlledBy = ctrl === null ? 'No one' : state.players[ctrl].name;
    if (ctrl === null && ships.length) {
      controlledBy = ships.every((s) => s.owner === 'pirate') ? 'No one (pirates hold it)' : 'No one (contested: tied hull)';
    }
    const pirates = ships.filter((s) => s.owner === 'pirate')
      .map((s) => ({ hull: s.hull, maxHull: shipDef(s).hull, weapon: shipDef(s).weapon.damage }));
    const sections = [
      ships.length > 0 && h('h3', `Ships here (${ships.length})`),
      ships.length > 0 && h('ul.ship-list', ships.map(shipRow)),
      ships.length > 1 && h('p.muted.small', 'Control goes to the player with the highest total hull here; a tie means nobody controls it.'),
    ].filter(Boolean);
    details.replaceChildren(...tileDetails({
      map: state.map, id: tile, costs, reveal: false, pirates,
      playerNames: state.players.map((p) => p.name),
      controlledBy: node.type === 'void' ? undefined : controlledBy,
      sections, onNavigate: openDetails, onClose: closeDetails,
    }));
    details.classList.add('open');
  }

  // ---------------------------------------------------------- render

  function render() {
    const me = state.players[state.active];
    const color = PLAYER_COLORS[me.id];
    roundLabel.textContent = `Round ${state.round}`;
    activeChip.replaceChildren(spriteIcon(`ship:fighter:${me.id}`, 18), `${me.name}'s turn`);
    activeChip.style.borderColor = color.main;
    activeChip.style.color = color.light;

    // Mode bar.
    if (mode.kind === 'deploy') {
      const def = CARDS[state.cards[mode.card].def];
      modeBar.replaceChildren(
        h('span', `Deploy ${def.name.toLowerCase()} (${SHIPS[def.ship].cp} CP): click a highlighted tile.`),
        h('button', { onclick: () => setMode({ kind: 'idle' }) }, 'Cancel (Esc)'));
      modeBar.classList.add('show');
    } else if (mode.kind === 'place') {
      modeBar.replaceChildren(
        h('span', 'Sandbox: click any open tile to put the ship there.'),
        h('button', { onclick: () => setMode({ kind: 'idle' }) }, 'Cancel (Esc)'));
      modeBar.classList.add('show');
    } else {
      modeBar.classList.remove('show');
    }

    renderHand(me);
    renderSidebar(me);
    if (openTile !== null) openDetails(openTile);
    board.invalidate();
  }

  function renderHand(me) {
    const cards = me.hand.map((uid) => {
      const def = cardDef(state.cards[uid]);
      let cs = 'playable';
      let note;
      if (def.type === CARD_TYPE.SHIP) {
        const check = deployCheck(state, me.id, uid);
        if (!check.ok) {
          cs = 'blocked';
          note = check.reason;
        }
      } else {
        cs = 'locked';
        note = 'Coming in Stage 3';
      }
      if (mode.kind === 'deploy' && mode.card === uid) cs = 'selected';
      return cardFace(state.cards[uid].def, { owner: me.id, state: cs, note, onClick: () => clickCard(uid) });
    });
    handBar.replaceChildren(
      h('div.hand-label',
        h('div', { style: { color: PLAYER_COLORS[me.id].light } }, h('b', me.name)),
        h('div.muted.small', `Hand · ${me.hand.length} cards`)),
      h('div.hand-cards', cards.length ? cards : h('div.muted', 'No cards in hand.')),
      h('div.piles',
        h('div.pile', h('b', me.deck.length), h('span', 'Deck')),
        h('div.pile', h('b', me.discard.length), h('span', 'Discard'))));
  }

  function cpMeter(pid) {
    const used = cpUsed(state, pid);
    const cap = cpCapacity(state, pid);
    const pct = cap.total ? Math.min(100, (used / cap.total) * 100) : 100;
    const over = used > cap.total;
    return { used, cap, el: h('div.cp-meter', { title: `${used} of ${cap.total} Command Points in use` },
      h('div.cp-fill', { style: { width: `${pct}%`, background: over ? 'var(--bad)' : PLAYER_COLORS[pid].main } })) };
  }

  function renderSidebar(me) {
    const meter = cpMeter(me.id);
    const fleet = shipsOf(state, me.id);
    const giveSelect = h('select', { 'aria-label': 'Card to give' },
      Object.entries(CARDS).map(([id, c]) => h('option', { value: id }, `${c.name}${c.type === 'ship' ? ` (${SHIPS[c.ship].cp} CP)` : ''}`)));
    giveSelect.value = 'ship-destroyer';

    sidebar.replaceChildren(...[
      h('div.player-card', { style: { borderColor: PLAYER_COLORS[me.id].main } },
        h('div.pc-head',
          spriteIcon(`home:${me.id}`, 34),
          h('div', h('div.pc-name', { style: { color: PLAYER_COLORS[me.id].light } }, me.name),
            h('div.muted.small', `${PLAYER_COLORS[me.id].name} fleet · ${me.vp} VP`))),
        h('div.cp-row', h('span', 'Command Points'), h('b', `${meter.used} / ${meter.cap.total}`)),
        meter.el,
        meter.used > meter.cap.total && h('div.warn.small', 'Over capacity: no new ships until you are back under.'),
        h('ul.cp-breakdown', meter.cap.breakdown.length
          ? meter.cap.breakdown.map((b) => h('li', { onclick: () => openDetails(b.tile) },
            h('span', `${CP_LABEL[b.type]} · ${b.label}`), h('b', `+${b.amount}`)))
          : h('li.muted', 'You control no CP-giving tiles.'))),

      h('h2', `Fleet on the board (${fleet.length})`),
      fleet.length
        ? h('ul.fleet', fleet.map((s) => h('li', { onclick: () => openDetails(s.tile) },
          spriteIcon(`ship:${s.type}:${s.owner}`, 22),
          h('span', SHIPS[s.type].name),
          h('span.muted.small', tileTitle(state.map.nodes[s.tile])),
          h('b.small', `${s.hull}/${SHIPS[s.type].hull}`))))
        : h('p.muted.small', 'No ships deployed. Play a Ship card from your hand to deploy it at your home sector.'),

      h('h2', 'Players'),
      h('table.players',
        h('thead', h('tr', h('th', 'Player'), h('th', 'VP'), h('th', 'CP'), h('th', 'Ships'), h('th', 'Hand'), h('th', 'Deck'))),
        h('tbody', state.players.map((p) => {
          const m = cpMeter(p.id);
          return h(`tr${p.id === me.id ? '.active' : ''}`,
            h('td', h('span.swatch', { style: { background: PLAYER_COLORS[p.id].main } }), p.name),
            h('td', p.vp), h('td', `${m.used}/${m.cap.total}`), h('td', shipsOf(state, p.id).length),
            h('td', p.hand.length), h('td', `${p.deck.length}+${p.discard.length}`));
        }))),

      h('h2', 'Sandbox (testing until Stage 3)'),
      h('div.sandbox',
        h('label', 'Act as',
          h('select', {
            onchange: (e) => { mode = { kind: 'idle' }; dispatch({ type: 'dev.setActive', player: Number(e.target.value) }); },
          }, state.players.map((p) => h('option', { value: p.id, selected: p.id === me.id }, p.name)))),
        h('label', 'Give card', giveSelect,
          h('button', { onclick: () => dispatch({ type: 'dev.giveCard', player: me.id, def: giveSelect.value }) }, 'Give')),
        h('p.muted.small', 'Use “Reposition” on a ship in a tile\'s details to move it anywhere and watch control and CP change.')),

      h('h2', 'Log'),
      h('ol.log', state.log.slice(-8).reverse().map((l) => h('li', l.text))),
    ].filter(Boolean));
  }

  render();
  window.fleetCommand = { get state() { return state; }, board, dispatch, openDetails };
}

