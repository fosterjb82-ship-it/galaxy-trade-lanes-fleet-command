// Game screen: board, hand, shipyard and hot-seat turn flow.

import { allCosts } from '../map/generator.js';
import { Board } from '../render/board.js';
import { unitLayer } from '../render/units.js';
import { PLAYER_COLORS } from '../render/sprites.js';
import { CARDS, CARD_TYPE, cardDef } from '../game/cards.js';
import { SHIPS, shipDef } from '../game/ships.js';
import {
  applyAction, controllerOf, cpCapacity, cpUsed, deployCheck, shipsAt, shipsOf, moveTargets, buyPrice,
  hasStation, turnOrder, tileName, GameError, SHIPYARD, ARMORY, MAX_KEEP, HAND_SIZE, reactionCheck, retreatTiles,
} from '../game/state.js';
import { attackOptions, describeDamage, shipStats } from '../game/combat.js';
import { h, spriteIcon } from './dom.js';
import { cardFace } from './card.js';
import { tileDetails, tileTitle } from './details.js';
import { loadGame, saveGame, clearGame } from './storage.js';

const CP_LABEL = { home: 'Home sector', key: 'Key planet', station: 'Station' };

export function mountGame(root) {
  let state = loadGame();
  if (!state || state.version !== 1 || state.phase === undefined) {
    clearGame();
    location.hash = '';
    return;
  }
  const costs = allCosts(state.map.nodes);
  // idle | deploy {card,tiles} | moveShip {card,tiles,pickFrom?} | moveDest {card,ship,routes}
  let mode = { kind: 'idle' };
  let openTile = null;
  let concealed = true; // hand hidden until the active player confirms (hot-seat)
  let devOpen = false;
  let armoryOpen = false;

  // ---------------------------------------------------------- layout
  const roundLabel = h('span.round');
  const orderChips = h('div.turn-order');
  const toast = h('div.game-toast');
  const topbar = h('header.topbar',
    h('div.brand', h('h1', 'Fleet Command'), h('span.stage', 'Stage 4 · Combat')),
    roundLabel, orderChips,
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
  const overlay = h('div.overlay');
  root.append(topbar, h('div.main', h('div.play-col', boardWrap, handBar), sidebar), overlay);

  const board = new Board(canvas);
  board.on('zoom', (s) => { zoomLabel.textContent = `${s}×`; });
  board.decorators.push(unitLayer(() => {
    const view = { state, targets: [], selectedShip: null, labels: null, path: null };
    if (['deploy', 'moveShip', 'attackShip', 'repair'].includes(mode.kind)) view.targets = mode.tiles;
    if (mode.kind === 'attackTarget') {
      view.selectedShip = mode.ship;
      view.targets = [...new Set(mode.options.map((o) => o.target.tile))];
      view.labels = new Map();
      for (const o of mode.options) {
        const prev = view.labels.get(o.target.tile);
        const txt = o.preview.ion ? 'ion' : `−${o.preview.damage}`;
        view.labels.set(o.target.tile, prev ? `${prev} ${txt}` : txt);
      }
    }
    if (mode.kind === 'moveDest') {
      view.targets = [...mode.routes.keys()];
      view.selectedShip = mode.ship;
      view.labels = new Map([...mode.routes].map(([t, r]) => [t, `${r.cost}${r.nebulas ? ' ☁' : ''}`]));
      const hovered = board.hover !== null ? mode.routes.get(board.hover) : null;
      if (hovered) view.path = hovered.path;
    }
    return view;
  }));
  board.setOptions({ labelFilter: (n) => !state.ships.some((s) => s.tile === n.id) });
  board.setMap(state.map);

  // ---------------------------------------------------------- actions

  let toastTimer = null;
  function say(text, kind = 'info') {
    toast.textContent = text;
    toast.className = `game-toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
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

  const me = () => state.players[state.active];

  function clickCard(uid) {
    if (concealed) return;
    const defId = state.cards[uid].def;
    const def = cardDef(state.cards[uid]);
    if (mode.card === uid) return setMode({ kind: 'idle' });
    if (def.type === CARD_TYPE.CREDIT) {
      mode = { kind: 'idle' };
      if (dispatch({ type: 'playCredit', player: state.active, card: uid })) say(`+${def.credits} credit.`);
      return;
    }
    if (def.type === CARD_TYPE.SHIP) {
      const check = deployCheck(state, state.active, uid);
      if (!check.ok) return say(check.reason, 'error');
      closeDetails();
      return setMode({ kind: 'deploy', card: uid, tiles: check.tiles });
    }
    if (defId === 'attack') {
      const ready = shipsOf(state, state.active).filter((s) => attackOptions(state, s, def.bonus).length > 0);
      if (!ready.length) return say('None of your ships has an enemy in range (same tile, or adjacent for missiles).', 'error');
      closeDetails();
      if (ready.length === 1) return chooseAttacker(uid, ready[0].id);
      return setMode({ kind: 'attackShip', card: uid, tiles: [...new Set(ready.map((s) => s.tile))] });
    }
    if (def.repair) {
      const hurt = shipsOf(state, state.active).filter((s) => s.hull < SHIPS[s.type].hull);
      if (!hurt.length) return say('None of your ships is damaged.', 'error');
      closeDetails();
      return setMode({ kind: 'repair', card: uid, tiles: [...new Set(hurt.map((s) => s.tile))] });
    }
    if (def.type === CARD_TYPE.REACTION) {
      return say(`${def.name} is a reaction: keep it at the end of your turn to play it when an opponent attacks you.`);
    }
    if (defId === 'move') {
      const movable = shipsOf(state, state.active).filter((s) => moveTargets(state, s.id).size > 0);
      if (!movable.length) return say('You have no ship on the board that can move. Deploy one first.', 'error');
      closeDetails();
      if (movable.length === 1) return chooseShip(uid, movable[0].id);
      return setMode({ kind: 'moveShip', card: uid, tiles: [...new Set(movable.map((s) => s.tile))] });
    }
    say(`${def.name} can't be played yet.`);
  }

  function chooseAttacker(card, shipId) {
    const ship = state.ships.find((s) => s.id === shipId);
    const options = attackOptions(state, ship, CARDS[state.cards[card].def].bonus);
    setMode({ kind: 'attackTarget', card, ship: shipId, options });
  }

  function fireAt(option) {
    const { card, ship } = mode;
    mode = { kind: 'idle' };
    if (!dispatch({ type: 'attack', player: state.active, card, ship, target: option.target.id, weapon: option.weapon })) return;
    afterCombatAction();
  }

  /** After an attack or move: a defender may need to respond, or show the report. */
  function afterCombatAction() {
    if (state.pending) return defenderHandoff();
    if (state.lastCombat) combatReport(state.lastCombat);
  }

  function chooseShip(card, shipId) {
    setMode({ kind: 'moveDest', card, ship: shipId, routes: moveTargets(state, shipId) });
  }

  board.on('hover', () => { if (mode.kind === 'moveDest') board.invalidate(); });

  board.on('click', (tile) => {
    if (concealed) return;
    if (tile === null) {
      if (mode.kind !== 'idle') return setMode({ kind: 'idle' });
      return closeDetails();
    }
    if (mode.kind === 'deploy') {
      if (!mode.tiles.includes(tile)) return say('Deploy at a highlighted tile: one you control, or your carrier\'s tile.', 'error');
      const { card } = mode;
      const name = CARDS[state.cards[card].def].name;
      mode = { kind: 'idle' };
      if (dispatch({ type: 'deploy', player: state.active, card, tile })) say(`${name} deployed at ${tileTitle(state.map.nodes[tile])}.`);
      return;
    }
    if (mode.kind === 'moveShip') {
      const mine = shipsAt(state, tile).filter((s) => s.owner === state.active && moveTargets(state, s.id).size > 0);
      if (!mine.length) return say('Pick a highlighted tile with one of your ships.', 'error');
      if (mine.length === 1) return chooseShip(mode.card, mine[0].id);
      return setMode({ ...mode, pickFrom: mine.map((s) => s.id) });
    }
    if (mode.kind === 'attackShip') {
      const mine = shipsAt(state, tile).filter((s) => s.owner === state.active && attackOptions(state, s).length > 0);
      if (!mine.length) return say('Pick a highlighted tile with one of your armed ships.', 'error');
      if (mine.length === 1) return chooseAttacker(mode.card, mine[0].id);
      return setMode({ ...mode, pickFrom: mine.map((s) => s.id) });
    }
    if (mode.kind === 'attackTarget') {
      const here = mode.options.filter((o) => o.target.tile === tile);
      if (!here.length) return say('Choose a highlighted target, or pick one from the bar above.', 'error');
      if (here.length === 1) return fireAt(here[0]);
      return say('Several targets there: pick one from the bar above.');
    }
    if (mode.kind === 'repair') {
      const mine = shipsAt(state, tile).filter((s) => s.owner === state.active && s.hull < SHIPS[s.type].hull);
      if (!mine.length) return say('Pick a highlighted tile with a damaged ship.', 'error');
      const best = mine.sort((a, b) => (a.hull / SHIPS[a.type].hull) - (b.hull / SHIPS[b.type].hull))[0];
      const { card } = mode;
      mode = { kind: 'idle' };
      if (dispatch({ type: 'repair', player: state.active, card, ship: best.id })) say(`${SHIPS[best.type].name} repaired to ${state.ships.find((x) => x.id === best.id).hull}/${SHIPS[best.type].hull}.`);
      return;
    }
    if (mode.kind === 'moveDest') {
      const route = mode.routes.get(tile);
      if (!route) return say('Choose a highlighted tile in range.', 'error');
      const { card, ship } = mode;
      mode = { kind: 'idle' };
      if (dispatch({ type: 'move', player: state.active, card, ship, tile })) {
        const events = state.lastMove?.events ?? [];
        say(events.length ? events.join(' ') : `Moved to ${tileName(state, tile)} (${route.cost} movement).`);
        if (state.pending) defenderHandoff();
      }
      return;
    }
    if (tile === openTile) closeDetails();
    else openDetails(tile);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (overlay.classList.contains('show')) return;
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

  const ownerName = (owner) => (owner === 'pirate' ? 'Pirates' : state.players[owner].name);

  function shipRow(ship) {
    const def = shipDef(ship);
    const color = ship.owner === 'pirate' ? '#ff8a7a' : PLAYER_COLORS[ship.owner].light;
    return h('li.ship-row',
      spriteIcon(`ship:${ship.owner === 'pirate' ? 'frigate' : ship.type}:${ship.owner === 'pirate' ? 'pirate' : ship.owner}`, 26),
      h('div',
        h('div', h('b', def.name), h('span', { style: { color } }, ` · ${ownerName(ship.owner)}`)),
        h('div.muted.small',
          `Hull ${ship.hull}/${def.hull} · Speed ${def.speed} · ` +
          `${def.weapon ? `${def.weapon.type} ${def.weapon.damage}` : 'unarmed'}` +
          `${def.armor ? ` · armor ${def.armor}` : ''}${def.cp ? ` · ${def.cp} CP` : ''}`),
        def.special && h('div.muted.small', def.special),
        ship.disabled !== undefined && h('div.small.warn', 'Disabled by ion: cannot move or attack this turn'),
        ship.firedTurn === state.turnNumber && h('div.small.muted', 'Has fired this turn')));
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
    const shown = { ...state.map, nodes: state.map.nodes.map((n) => (n.revealed ? { ...n, hidden: false } : n)) };
    const found = { derelict: 'derelict', bonus: 'bonus cache', pirateNest: 'pirate nest' };
    const sections = [
      node.revealed && h('div.callout', h('b', 'Revealed'), h('span', `This hidden tile held a ${found[node.hiddenContent]}.`)),
      ships.length > 0 && h('h3', `Ships here (${ships.length})`),
      ships.length > 0 && h('ul.ship-list', ships.map(shipRow)),
      ships.length > 1 && h('p.muted.small', 'Control goes to the player with the highest total hull here; a tie means nobody controls it.'),
    ].filter(Boolean);
    details.replaceChildren(...tileDetails({
      map: shown, id: tile, costs, reveal: false, pirates,
      playerNames: state.players.map((p) => p.name),
      controlledBy: node.type === 'void' ? undefined : controlledBy,
      sections, onNavigate: openDetails, onClose: closeDetails,
    }));
    details.classList.add('open');
  }

  // ---------------------------------------------------------- overlays

  function showOverlay(content) {
    overlay.replaceChildren(h('div.dialog', content));
    overlay.classList.add('show');
  }

  function hideOverlay() {
    overlay.classList.remove('show');
    overlay.replaceChildren();
  }

  function endTurnDialog() {
    if (concealed) return;
    const p = me();
    const keep = new Set();
    const list = h('div.keep-cards');
    const confirmBtn = h('button.primary.big');
    const renderKeep = () => {
      list.replaceChildren(...p.hand.map((uid) => cardFace(state.cards[uid].def, {
        owner: p.id,
        state: keep.has(uid) ? 'selected' : 'playable',
        onClick: () => {
          if (keep.has(uid)) keep.delete(uid);
          else if (keep.size < MAX_KEEP) keep.add(uid);
          renderKeep();
        },
      })));
      confirmBtn.textContent = `End turn · keep ${keep.size}, draw ${HAND_SIZE - keep.size}`;
    };
    confirmBtn.onclick = () => {
      const roundBefore = state.round;
      hideOverlay();
      mode = { kind: 'idle' };
      closeDetails();
      concealed = true; // hide this hand before the next player's state renders
      if (!dispatch({ type: 'endTurn', player: p.id, keep: [...keep] })) {
        concealed = false;
        render();
        return;
      }
      if (state.round !== roundBefore) roundSummary(state.rounds.at(-1));
      else handoff();
    };
    renderKeep();
    showOverlay([
      h('h2', 'End your turn'),
      p.credits > 0 && h('div.callout.danger', h('b', `${p.credits} unspent credit${p.credits === 1 ? '' : 's'}`), h('span', 'Unspent credits are lost at the end of your turn.')),
      p.hand.length
        ? h('p.muted', `Choose up to ${MAX_KEEP} cards to keep. Kept cards are held face-down: opponents only see how many. You can play kept reaction cards when an opponent attacks you, and they return to your hand next turn. The rest are discarded, then you draw back up to ${HAND_SIZE}.`)
        : h('p.muted', `Your hand is empty. You will draw ${HAND_SIZE} new cards.`),
      list,
      h('div.dialog-actions', h('button', { onclick: hideOverlay }, 'Back'), confirmBtn),
    ].filter(Boolean));
  }

  function roundSummary(rs) {
    const ranked = [...state.players].sort((a, b) => b.vp - a.vp);
    showOverlay([
      h('div.kicker', `End of round ${rs.round}`),
      h('h2', 'Round scoring'),
      h('table.score',
        h('thead', h('tr', h('th', 'Player'), h('th', 'Key planets held'), h('th', 'This round'), h('th', 'Total VP'))),
        h('tbody', ranked.map((p) => {
          const sc = rs.scores.find((x) => x.player === p.id);
          return h('tr',
            h('td', h('span.swatch', { style: { background: PLAYER_COLORS[p.id].main } }), p.name),
            h('td', sc.keys.length ? sc.keys.map((t) => tileTitle(state.map.nodes[t])).join(', ') : '—'),
            h('td', sc.vp ? `+${sc.vp}` : '0'),
            h('td', h('b', p.vp)));
        }))),
      h('p.muted.small', 'Each controlled key planet scores 2 VP at the end of every round. Trade agreements, the pirate phase and the uncertain ending arrive in Stage 5.'),
      h('div.dialog-actions', h('button.primary.big', { onclick: handoff }, `Start round ${state.round}`)),
    ]);
  }

  function combatLines(events) {
    return h('ul.combat-log', events.map((e) => h('li', e)));
  }

  function combatReport(result, after = null) {
    showOverlay([
      h('div.kicker', 'Combat report'),
      h('h2', result.events.some((e) => e.includes('destroyed')) ? 'Ship destroyed!' : 'Shots fired'),
      combatLines(result.events),
      h('div.dialog-actions', h('button.primary.big', { onclick: () => { hideOverlay(); render(); after?.(); } }, 'Continue')),
    ]);
  }

  /** Public announcement, then hand the device to the defender. */
  function defenderHandoff() {
    concealed = true;
    render();
    const pend = state.pending;
    const d = state.players[pend.defender];
    const c = PLAYER_COLORS[d.id];
    const attackerName = me().name;
    let what;
    if (pend.kind === 'reaction') {
      const atk = state.ships.find((s) => s.id === pend.attack.attacker);
      const tgt = state.ships.find((s) => s.id === pend.attack.target);
      what = `${attackerName}'s ${SHIPS[atk.type].name.toLowerCase()} attacks ${d.name}'s ${SHIPS[tgt.type].name.toLowerCase()}: ${describeDamage(pend.preview)} damage unless ${d.name} reacts.`;
    } else {
      const mv = state.ships.find((s) => s.id === pend.mover);
      what = `${attackerName}'s ${SHIPS[mv.type].name.toLowerCase()} moves onto ${tileTitle(state.map.nodes[pend.tile])}, where ${d.name} has ships.`;
    }
    showOverlay(h('div.handoff',
      h('div.kicker', pend.kind === 'reaction' ? 'Incoming attack' : 'Enemy arrival'),
      h('h2', { style: { color: c.light } }, `Pass the device to ${d.name}`),
      h('p', what),
      h('p.muted', `${d.name} holds ${d.reserve.length} card${d.reserve.length === 1 ? '' : 's'} and may respond. ${attackerName}, look away.`),
      h('button.primary.big', { style: { background: c.dark, borderColor: c.main }, onclick: reactionDialog }, `I'm ${d.name}: respond`)));
  }

  function reactionDialog() {
    const pend = state.pending;
    const d = state.players[pend.defender];
    const options = d.reserve.map((uid) => {
      const why = reactionCheck(state, pend, uid);
      const def = CARDS[state.cards[uid].def];
      const face = cardFace(state.cards[uid].def, {
        owner: d.id, state: why ? 'blocked' : 'playable', note: why ?? undefined,
        onClick: () => {
          if (why) return;
          if (def.reaction === 'retreat') return retreatChooser(uid);
          if (def.reaction === 'ambush') return ambushChooser(uid);
          respond({ card: uid });
        },
      });
      return face;
    });
    let summary;
    if (pend.kind === 'reaction') {
      const tgt = state.ships.find((s) => s.id === pend.attack.target);
      summary = `Your ${SHIPS[tgt.type].name.toLowerCase()} (hull ${tgt.hull}) will take ${describeDamage(pend.preview)} damage.`;
    } else {
      const mv = state.ships.find((s) => s.id === pend.mover);
      summary = `An enemy ${SHIPS[mv.type].name.toLowerCase()} (hull ${mv.hull}) has moved onto your tile. Ambush hits it before it can act.`;
    }
    showOverlay([
      h('div.kicker', `${d.name}, respond`),
      h('h2', pend.kind === 'reaction' ? 'You are under attack' : 'Enemy on your tile'),
      h('p', summary),
      h('p.muted.small', 'Only one reaction per attack. Cards you don\'t play stay hidden in your reserve.'),
      h('div.keep-cards', options),
      h('div.dialog-actions', h('button.big', { onclick: () => respond({ card: null }) }, pend.kind === 'reaction' ? 'Take the hit' : 'Let it pass')),
    ]);
  }

  function retreatChooser(uid) {
    const tgt = state.ships.find((s) => s.id === state.pending.attack.target);
    showOverlay([
      h('h2', 'Retreat where?'),
      h('div.choice-list', retreatTiles(state, tgt).map((t) => h('button', { onclick: () => respond({ card: uid, tile: t }) },
        `${tileTitle(state.map.nodes[t])}${state.ships.some((s) => s.tile === t && s.owner !== tgt.owner) ? ' (enemy ships!)' : ''}${state.map.nodes[t].type === 'nebula' ? ' (nebula: 1 damage)' : ''}`))),
      h('div.dialog-actions', h('button', { onclick: reactionDialog }, 'Back')),
    ]);
  }

  function ambushChooser(uid) {
    const pend = state.pending;
    const mine = shipsAt(state, pend.tile).filter((s) => s.owner === pend.defender && shipStats(state, s).weapons.length && s.disabled === undefined);
    if (mine.length === 1) return respond({ card: uid, ship: mine[0].id });
    showOverlay([
      h('h2', 'Which ship springs the ambush?'),
      h('div.choice-list', mine.map((s) => h('button', { onclick: () => respond({ card: uid, ship: s.id }) }, `${SHIPS[s.type].name} (${shipStats(state, s).weapons[0].type} ${shipStats(state, s).weapons[0].damage})`))),
      h('div.dialog-actions', h('button', { onclick: reactionDialog }, 'Back')),
    ]);
  }

  function respond({ card, tile = null, ship = null }) {
    const defender = state.pending.defender;
    if (!dispatch({ type: 'react', player: defender, card, tile, ship })) return;
    const result = state.lastCombat ?? { events: [`${state.players[defender].name} lets the ship pass.`] };
    // Hand back to the attacker with the public result.
    combatReport(result, () => handoff());
  }

  function handoff() {
    concealed = true;
    render();
    const p = me();
    const c = PLAYER_COLORS[p.id];
    showOverlay([
      h('div.handoff',
        spriteIcon(`home:${p.id}`, 64),
        h('div.kicker', `Round ${state.round}`),
        h('h2', { style: { color: c.light } }, `Pass the device to ${p.name}`),
        h('p.muted', 'Everyone else, look away: your hand is about to be shown.'),
        h('button.primary.big', {
          style: { background: c.dark, borderColor: c.main },
          onclick: () => {
            concealed = false;
            hideOverlay();
            render();
            const ev = state.turnStart?.player === p.id ? state.turnStart.events : [];
            if (ev?.length) say(`Start of turn: ${ev.join(' ')}`);
          },
        }, `I'm ${p.name}: show my hand`)),
    ]);
  }

  // ---------------------------------------------------------- render

  function render() {
    const p = me();
    roundLabel.textContent = `Round ${state.round}`;
    const order = turnOrder(state);
    orderChips.replaceChildren(...order.map((pid, i) => {
      const done = i < state.turnInRound;
      const pl = state.players[pid];
      return h(`span.order-chip${pid === p.id ? '.now' : ''}${done ? '.done' : ''}`, {
        style: { borderColor: PLAYER_COLORS[pid].main, color: PLAYER_COLORS[pid].light },
        title: done ? `${pl.name} has played this round` : pid === p.id ? `${pl.name}'s turn` : `${pl.name} plays later this round`,
      }, pl.name, h('b', `${pl.vp} VP`));
    }));
    renderModeBar();
    renderHand(p);
    renderSidebar(p);
    if (openTile !== null) openDetails(openTile);
    board.invalidate();
  }

  function renderModeBar() {
    const cancel = h('button', { onclick: () => setMode({ kind: 'idle' }) }, 'Cancel (Esc)');
    let content = null;
    if (mode.kind === 'deploy') {
      const def = CARDS[state.cards[mode.card].def];
      content = [h('span', `Deploy ${def.name.toLowerCase()} (${SHIPS[def.ship].cp} CP): click a highlighted tile.`), cancel];
    } else if (mode.kind === 'moveShip') {
      content = mode.pickFrom
        ? [h('span', 'Which ship?'), ...mode.pickFrom.map((id) => {
          const s = state.ships.find((x) => x.id === id);
          return h('button', { onclick: () => chooseShip(mode.card, id) }, `${SHIPS[s.type].name} ${s.hull}/${SHIPS[s.type].hull}`);
        }), cancel]
        : [h('span', 'Move: click one of your highlighted ships.'), cancel];
    } else if (mode.kind === 'attackShip') {
      content = mode.pickFrom
        ? [h('span', 'Which ship fires?'), ...mode.pickFrom.map((id) => {
          const s = state.ships.find((x) => x.id === id);
          return h('button', { onclick: () => chooseAttacker(mode.card, id) }, SHIPS[s.type].name);
        }), cancel]
        : [h('span', 'Attack: click one of your highlighted ships.'), cancel];
    } else if (mode.kind === 'attackTarget') {
      const s = state.ships.find((x) => x.id === mode.ship);
      content = [h('span', `${SHIPS[s.type].name} fires at:`), ...mode.options.map((o) => {
        const t = o.target;
        const who = t.owner === 'pirate' ? 'Pirates' : state.players[t.owner].name;
        const name = t.owner === 'pirate' ? 'fleet' : SHIPS[t.type].name.toLowerCase();
        const max = t.owner === 'pirate' ? 4 : SHIPS[t.type].hull;
        const after = o.preview.ion ? 'disabled' : Math.max(0, t.hull - o.preview.damage) === 0 ? 'destroyed' : `${t.hull}→${t.hull - o.preview.damage}`;
        return h('button', { title: describeDamage(o.preview), onclick: () => fireAt(o) },
          `${who} ${name} ${t.hull}/${max}: ${o.preview.ion ? 'ion' : `${o.preview.damage} dmg`} (${after})`);
      }), cancel];
    } else if (mode.kind === 'repair') {
      const def = CARDS[state.cards[mode.card].def];
      content = [h('span', `${def.name}: click a highlighted tile with a damaged ship (+${def.repair} hull).`), cancel];
    } else if (mode.kind === 'moveDest') {
      const s = state.ships.find((x) => x.id === mode.ship);
      content = [h('span', `Move ${SHIPS[s.type].name.toLowerCase()} (speed ${SHIPS[s.type].speed}): click a destination. Badges show movement used, ☁ = nebula damage.`), cancel];
    }
    modeBar.replaceChildren(...(content ?? []));
    modeBar.classList.toggle('show', Boolean(content));
  }

  function renderHand(p) {
    if (concealed) {
      handBar.replaceChildren(h('div.hand-hidden', h('span', `${p.name}'s hand is hidden.`),
        h('button.primary', { onclick: handoff }, `Show ${p.name}'s hand`)));
      return;
    }
    const cards = p.hand.map((uid) => {
      const defId = state.cards[uid].def;
      const def = CARDS[defId];
      let cs = 'playable';
      let note;
      if (def.type === CARD_TYPE.SHIP) {
        const check = deployCheck(state, p.id, uid);
        if (!check.ok) {
          cs = 'blocked';
          note = check.reason;
        }
      } else if (def.type === CARD_TYPE.REACTION) {
        cs = 'locked';
        note = 'Reaction: keep it to use on opponents\' turns';
      } else if (defId === 'attack' && !shipsOf(state, p.id).some((s) => attackOptions(state, s).length > 0)) {
        cs = 'blocked';
        note = 'No enemy in range of your armed ships';
      } else if (def.repair && !shipsOf(state, p.id).some((s) => s.hull < SHIPS[s.type].hull)) {
        cs = 'blocked';
        note = 'No damaged ship';
      } else if (defId === 'move' && !shipsOf(state, p.id).some((s) => moveTargets(state, s.id).size > 0)) {
        cs = 'blocked';
        note = 'No ship on the board to move';
      }
      if (mode.card === uid) cs = 'selected';
      return cardFace(defId, { owner: p.id, state: cs, note, onClick: () => clickCard(uid) });
    });
    handBar.replaceChildren(
      h('div.hand-label',
        h('div', { style: { color: PLAYER_COLORS[p.id].light } }, h('b', p.name)),
        h('div.credits', { title: 'Credits to spend this turn' }, spriteIcon('card:credit', 16), h('b', p.credits), 'credits'),
        h('div.muted.small', `${p.played.length} card${p.played.length === 1 ? '' : 's'} played`)),
      h('div.hand-cards', cards.length ? cards : h('div.muted', 'No cards left in hand.')),
      h('div.piles',
        h('div.pile', h('b', p.deck.length), h('span', 'Deck')),
        h('div.pile', h('b', p.discard.length), h('span', 'Discard'))),
      h('button.end-turn', { onclick: endTurnDialog }, 'End turn'));
  }

  function cpMeter(pid) {
    const used = cpUsed(state, pid);
    const cap = cpCapacity(state, pid);
    const pct = cap.total ? Math.min(100, (used / cap.total) * 100) : 100;
    return { used, cap, el: h('div.cp-meter', { title: `${used} of ${cap.total} Command Points in use` },
      h('div.cp-fill', { style: { width: `${pct}%`, background: used > cap.total ? 'var(--bad)' : PLAYER_COLORS[pid].main } })) };
  }

  function shipyard(p) {
    const discount = hasStation(state, p.id);
    return h('div.shipyard', SHIPYARD.map((def) => {
      const card = CARDS[def];
      const ship = SHIPS[card.ship];
      const price = buyPrice(state, p.id, def);
      const afford = !concealed && p.credits >= price;
      return h('div.yard-item',
        spriteIcon(`ship:${card.ship}:${p.id}`, 30),
        h('div',
          h('div', h('b', card.name)),
          h('div.muted.small', `Spd ${ship.speed} · ${ship.weapon ? `${ship.weapon.type} ${ship.weapon.damage}` : 'unarmed'} · Hull ${ship.hull} · ${ship.cp} CP`)),
        h('button.buy', {
          disabled: !afford,
          title: afford ? `Buy for ${price}` : `Costs ${price}; you have ${p.credits}`,
          onclick: () => { if (dispatch({ type: 'buy', player: p.id, def })) say(`Bought a ${card.name.toLowerCase()}. It goes to your discard pile.`); },
        }, discount && h('s', card.cost), h('span.price', price)));
    }), h('p.muted.small', discount
      ? 'You control a station, so ships cost 1 less. Bought cards go to your discard pile.'
      : 'Bought cards go to your discard pile. Control a station to buy ships for 1 less.'));
  }

  function armory(p) {
    return h('details.armory', { open: armoryOpen, ontoggle: (e) => { armoryOpen = e.target.open; } },
      h('summary', 'Reaction and repair cards (temporary shop until the Market Row in Stage 5)'),
      h('div.shipyard', ARMORY.map((def) => {
        const card = CARDS[def];
        const price = buyPrice(state, p.id, def);
        const afford = !concealed && p.credits >= price;
        return h('div.yard-item',
          spriteIcon(card.icon, 26),
          h('div', h('div', h('b', card.name)), h('div.muted.small', card.text)),
          h('button.buy', {
            disabled: !afford,
            title: afford ? `Buy for ${price}` : `Costs ${price}; you have ${p.credits}`,
            onclick: () => { if (dispatch({ type: 'buy', player: p.id, def })) say(`Bought ${card.name}. It goes to your discard pile.`); },
          }, h('span.price', price)));
      })));
  }

  function renderSidebar(p) {
    const meter = cpMeter(p.id);
    const fleet = shipsOf(state, p.id);
    const giveSelect = h('select', { 'aria-label': 'Card to give' },
      Object.entries(CARDS).map(([id, c]) => h('option', { value: id }, c.name)));

    sidebar.replaceChildren(...[
      h('div.player-card', { style: { borderColor: PLAYER_COLORS[p.id].main } },
        h('div.pc-head',
          spriteIcon(`home:${p.id}`, 34),
          h('div', h('div.pc-name', { style: { color: PLAYER_COLORS[p.id].light } }, p.name),
            h('div.muted.small', `${PLAYER_COLORS[p.id].name} fleet`)),
          h('div.vp', h('b', p.vp), h('span', 'VP'))),
        h('div.cp-row', h('span', 'Command Points'), h('b', `${meter.used} / ${meter.cap.total}`)),
        meter.el,
        meter.used > meter.cap.total && h('div.warn.small', 'Over capacity: no new ships until you are back under.'),
        h('ul.cp-breakdown', meter.cap.breakdown.length
          ? meter.cap.breakdown.map((b) => h('li', { onclick: () => openDetails(b.tile) },
            h('span', `${CP_LABEL[b.type]} · ${b.label}`), h('b', `+${b.amount}`)))
          : h('li.muted', 'You control no CP-giving tiles.'))),

      h('h2', 'Armory'),
      armory(p),
      h('h2', 'Shipyard'),
      shipyard(p),

      h('h2', `Fleet on the board (${fleet.length})`),
      fleet.length
        ? h('ul.fleet', fleet.map((s) => h('li', { onclick: () => openDetails(s.tile) },
          spriteIcon(`ship:${s.type}:${s.owner}`, 22),
          h('span', SHIPS[s.type].name),
          h('span.muted.small', tileTitle(state.map.nodes[s.tile])),
          h('b.small', `${s.hull}/${SHIPS[s.type].hull}`))))
        : h('p.muted.small', 'No ships deployed. Play a Ship card to deploy it at your home sector.'),

      h('h2', 'Players'),
      h('table.players',
        h('thead', h('tr', h('th', 'Player'), h('th', 'VP'), h('th', 'CP'), h('th', 'Ships'), h('th', { title: 'Cards held in reserve for reactions (public count)' }, 'Held'), h('th', 'Deck'))),
        h('tbody', state.players.map((pl) => {
          const m = cpMeter(pl.id);
          return h(`tr${pl.id === p.id ? '.active' : ''}`,
            h('td', h('span.swatch', { style: { background: PLAYER_COLORS[pl.id].main } }), pl.name),
            h('td', pl.vp), h('td', `${m.used}/${m.cap.total}`), h('td', shipsOf(state, pl.id).length),
            h('td', pl.id === p.id ? '—' : pl.reserve.length), h('td', `${pl.deck.length}+${pl.discard.length}`));
        }))),

      h('h2', 'Log'),
      h('ol.log', state.log.slice(-10).reverse().map((l) => h('li', l.text))),

      h('details.dev', { open: devOpen, ontoggle: (e) => { devOpen = e.target.open; } },
        h('summary', 'Dev tools'),
        h('div.sandbox',
          h('label', 'Give card', giveSelect,
            h('button', { onclick: () => dispatch({ type: 'dev.giveCard', player: p.id, def: giveSelect.value }) }, 'Give')),
          h('p.muted.small', 'For testing only: adds a card to the active player\'s hand.'))),
    ].filter(Boolean));
  }

  render();
  if (state.pending) defenderHandoff();
  else handoff();
  window.fleetCommand = {
    get state() { return state; }, board, dispatch, openDetails,
    reveal: () => { concealed = false; hideOverlay(); render(); },
  };
}
