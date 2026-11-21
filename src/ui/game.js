// Game screen: board, hand, shipyard and hot-seat turn flow.

import { allCosts } from '../map/generator.js';
import { Board, setAnimationsEnabled } from '../render/board.js';
import { FxPlayer } from '../render/fx.js';
import { unitLayer } from '../render/units.js';
import { PLAYER_COLORS, PIRATE_COLOR } from '../render/sprites.js';
import { slotOffset } from '../render/units.js';
import { CARDS, CARD_TYPE, cardDef } from '../game/cards.js';
import { SHIPS, PIRATE, shipDef, shipSprite } from '../game/ships.js';
import {
  applyAction, controllerOf, cpCapacity, cpUsed, deployCheck, shipsAt, shipsOf, moveTargets, buyPrice,
  hasStation, turnOrder, tileName, GameError, SHIPYARD, MAX_KEEP, HAND_SIZE, reactionCheck, retreatTiles,
  upgradeCheck, END_ODDS_LABEL, END_CHANCE, handCredits, autoPayCards, pirateWarning, pirateRound,
} from '../game/state.js';
import {
  routeOptions, isRouteEnd, routesOf, blockaded, routeIncome, activeAgreements, agreementBetween, offerCheck, isTrader, BREAK_BONUS,
} from '../game/trade.js';
import { MISSIONS, missionProgressText } from '../game/missions.js';
import { attackOptions, describeDamage, shipStats } from '../game/combat.js';
import { h, spriteIcon } from './dom.js';
import { cardFace, cardLarge } from './card.js';
import { installTooltips, cardTip, missionTip, tileTip, shipTip } from './tooltip.js';
import { tileDetails, tileTitle, row } from './details.js';
import { loadGame, saveGame, clearGame } from './storage.js';
import { soundMenu } from './soundmenu.js';
import { buildBattle, playBattle } from './battle.js';
import { nextAction as nextCpuAction, respond as respondCpu } from '../game/ai.js';
import { sound } from '../audio/sound.js';

const board0Animate = () => {
  try {
    const v = localStorage.getItem('fleetcommand.animations');
    if (v !== null) return v === 'on';
  } catch { /* ignore */ }
  return !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
};
const TYPE_WORD = { ship: 'Ship', command: 'Command', credit: 'Credit', upgrade: 'Upgrade', reaction: 'Reaction', utility: 'Utility' };
// Sound cues for actions whose effects don't already make a sound.
const ACTION_SOUND = {
  buy: 'buy', playCredit: 'income', playDraw: 'card', playUpgrade: 'card', scrap: 'card', repair: 'card', react: 'card',
  move: 'card', attack: 'card', deploy: 'card', establishRoute: 'income', chooseMissions: 'card', breakAgreement: 'income',
};
// Battle close-ups: 'always', 'kills' (only when a ship is destroyed) or 'off'.
const BATTLE_VIEW_KEY = 'fleetcommand.battleview';
function battleView() {
  try { return localStorage.getItem(BATTLE_VIEW_KEY) ?? 'always'; } catch { return 'always'; }
}
const CPU_SPEED_KEY = 'fleetcommand.cpuspeed';
function cpuSpeed() {
  try { return localStorage.getItem(CPU_SPEED_KEY) ?? 'normal'; } catch { return 'normal'; }
}
const TYPE_LABEL_SHORT = { trade: 'Trade node', key: 'Key planet', home: 'Home' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const CP_LABEL = { home: 'Home sector', key: 'Key planet', station: 'Station' };

export function mountGame(root) {
  let state = loadGame();
  // Single player against CPU opponents: older hot-seat saves start over.
  if (!state || state.version !== 2 || !state.players.some((p) => p.cpu)) {
    clearGame();
    location.hash = '';
    return;
  }
  const HUMAN = state.players.findIndex((p) => !p.cpu);
  const costs = allCosts(state.map.nodes);
  // idle | deploy {card,tiles} | moveShip {card,tiles,pickFrom?} | moveDest {card,ship,routes}
  let mode = { kind: 'idle' };
  let openTile = null;
  let openShipId = null;
  let locked = true; // true while it isn't your turn (CPU turns, dialogs waiting on you)
  let cpuRunning = false;
  let pendingAfter = () => {}; // what happens once a pending answer has been shown
  let combatOwners = new Set(); // owners of the ships in the last fight
  let devOpen = false;

  // ---------------------------------------------------------- layout
  const roundLabel = h('span.round');
  const orderChips = h('div.turn-order');
  const toast = h('div.game-toast');
  /** ⚙ Options: animations, battle close-ups and CPU speed, in one popover. */
  function optionsMenu() {
    const select = (key, value, options, onPick) => h('select.battle-select', {
      onchange: (e) => { try { localStorage.setItem(key, e.target.value); } catch { /* ignore */ } onPick?.(e.target.value); },
    }, options.map(([v, l]) => h('option', { value: v, selected: value === v }, l)));
    const panel = h('div.sound-panel', { role: 'dialog', 'aria-label': 'Options' },
      h('label.sound-row.master', h('b', 'Options')),
      h('label.sound-row', h('input', {
        type: 'checkbox', checked: board0Animate(),
        onchange: (e) => { setAnimationsEnabled(e.target.checked); board.setAnimate(e.target.checked); document.body.classList.toggle('still', !e.target.checked); },
      }), 'Animations'),
      h('div.sound-group', h('span.small.muted', 'Battles'),
        select(BATTLE_VIEW_KEY, battleView(), [['always', 'Close-up every attack'], ['kills', 'Close-up on kills only'], ['off', 'Board only']])),
      h('div.sound-group', h('span.small.muted', 'CPU speed'),
        select(CPU_SPEED_KEY, cpuSpeed(), [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']])),
      h('p.muted.small', 'Close-ups only play for fights involving your ships.'));
    const wrap = h('div.sound-menu', h('button', { type: 'button', onclick: (e) => { e.stopPropagation(); wrap.classList.toggle('open'); } }, '⚙ Options'), panel);
    panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => wrap.classList.remove('open'));
    return wrap;
  }

  const topbar = h('header.topbar',
    h('div.brand', h('h1', 'Fleet Command'), h('span.stage', `${state.settings?.length === 'quick' ? 'Quick game' : 'Standard game'} · you vs ${plural(state.players.length - 1, 'CPU')}`)),
    roundLabel, orderChips,
    h('span.spacer'),
    optionsMenu(),
    soundMenu(),
    h('a.button', { href: `#lab&seed=${encodeURIComponent(state.mapSeed)}&players=${state.players.length}` }, 'Map Lab'),
    h('button', {
      onclick: () => askConfirm('Start a new game?', 'This game will be abandoned and cannot be resumed.', 'Abandon and start new', () => {
        clearGame();
        location.hash = '';
      }),
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
  const targetPreview = h('div.target-preview');
  boardWrap.append(targetPreview);
  const handBar = h('section.hand-bar');
  const sidebar = h('aside.sidebar');
  const overlay = h('div.overlay');
  const table = h('aside.table', { 'aria-label': 'Shipyard and market' });
  root.append(topbar, h('div.main', table, h('div.play-col', boardWrap, handBar), sidebar), overlay);

  const board = new Board(canvas);
  document.body.classList.toggle('still', !board.animate);
  board.on('zoom', (s) => { zoomLabel.textContent = `${Math.round((s / board.fitScale()) * 100)}%`; });
  board.decorators.push(unitLayer(() => {
    const view = {
      state, targets: [], selectedShip: null, labels: null, path: null,
      routes: state.routes.map((r) => ({ path: r.path, owner: r.owner, blockaded: blockaded(state, r) })),
      fx: fxp,
      warnings: pirateWarning(state)?.tiles ?? [],
    };
    if (['deploy', 'moveShip', 'attackShip', 'repair', 'upgrade'].includes(mode.kind)) view.targets = mode.tiles;
    if (mode.pickFrom && pickHover) view.selectedShip = pickHover;
    if (routePreview && mode.kind === 'idle') view.path = routePreview;
    if (mode.kind === 'attackTarget') {
      view.selectedShip = mode.ship;
      view.attack = { shooter: mode.ship, targets: bestOptions(mode.options), hover: hoverTarget };
    }
    if (mode.kind === 'moveDest') {
      view.targets = [...mode.routes.keys()];
      view.selectedShip = mode.ship;
      const mover = state.ships.find((s) => s.id === mode.ship);
      const blocked = (t) => state.ships.some((s) => s.tile === t && s.owner !== mover?.owner);
      view.labels = new Map([...mode.routes].map(([t, r]) => [t, `${r.cost}${r.nebulas ? ' ☁' : ''}${blocked(t) ? ' ✋' : ''}`]));
      view.blockers = [...mode.routes.keys()].filter(blocked);
      const hovered = board.hover !== null ? mode.routes.get(board.hover) : null;
      if (hovered) view.path = hovered.path;
    }
    return view;
  }));
  const fxp = new FxPlayer(board);
  let startFx = [];
  let pendingBattle = null; // close-up waiting for the board effects to finish
  let hoverTarget = null; // ship under the pointer while aiming
  let pickHover = null; // ship tile under the pointer in a picker
  let routePreview = null; // trade route path to draw while choosing one
  let clearedFor = null; // picker the map was last panned for
  let seenHand = new Set(); // cards already shown, so only new draws deal in // start-of-turn effects, played once the player reveals their hand
  board.setOptions({ labelFilter: (n) => !state.ships.some((s) => s.tile === n.id) });
  board.setMap(state.map);

  // ---------------------------------------------------------- actions

  let toastTimer = null;
  function say(text, kind = 'info') {
    toast.textContent = text;
    toast.className = `game-toast show ${kind}`;
    if (kind === 'error') sound.sfx('error');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function dispatch(action) {
    try {
      const prev = state;
      state = applyAction(state, action);
      saveGame(state);
      const cue = ACTION_SOUND[action.type];
      if (cue) sound.sfx(cue);
      let events = state.fx ?? [];
      if (state.lastCombat && state.lastCombat !== prev.lastCombat) {
        const owner = (id) => (prev.ships.find((x) => x.id === id) ?? state.ships.find((x) => x.id === id))?.owner;
        combatOwners = new Set([owner(state.lastCombat.attacker), owner(state.lastCombat.target)]);
      }
      // Attacks and reactions: replay the fight as a close-up instead of on the board.
      pendingBattle = null;
      if (['attack', 'react'].includes(action.type) && state.lastCombat && !state.pending) {
        const battle = buildBattle(prev, state, state.lastCombat, events);
        const view = battleView();
        if (battle && combatOwners.has(HUMAN) && (view === 'always' || (view === 'kills' && battle.destroyed))) {
          pendingBattle = { battle, result: state.lastCombat };
          const fighters = new Set([state.lastCombat.attacker, state.lastCombat.target]);
          events = events.filter((e) => !((e.kind === 'shot' && fighters.has(e.shooter)) || (e.kind === 'explode' && fighters.has(e.ship))));
        }
      }
      fxp.play(events.filter((e) => !e.start), prev, state);
      startFx = events.filter((e) => e.start);
      startFx.prev = prev;
      const missions = state.notices.filter((n) => n.kind === 'mission');
      if (missions.length) fxp.whenIdle(() => announce(missions));
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

  const me = () => state.players[HUMAN];

  function clickCard(uid) {
    if (locked) return;
    const defId = state.cards[uid].def;
    const def = cardDef(state.cards[uid]);
    if (mode.card === uid) return setMode({ kind: 'idle' });
    if (def.type === CARD_TYPE.CREDIT && def.discard && me().hand.length > 1) {
      return pickCardDialog(`${def.name}: +${def.credits} credits`, 'Choose a card from your hand to discard.', uid,
        (other) => { if (dispatch({ type: 'playCredit', player: state.active, card: uid, discard: other })) say(`+${def.credits} credits.`); });
    }
    if (def.scrap) {
      if (me().hand.length < 2) return say('You have no other card to scrap.', 'error');
      return pickCardDialog(def.name, 'Choose a card to scrap. It is removed from the game for good: a great way to thin out basic Credits.', uid,
        (other) => { if (dispatch({ type: 'scrap', player: state.active, card: uid, target: other })) say('Card scrapped.'); });
    }
    if (def.type === CARD_TYPE.UPGRADE) {
      const ok = shipsOf(state, state.active).filter((s) => !upgradeCheck(state, s, defId));
      if (!ok.length) return say(`No ship of yours can take ${def.name} (slots, duplicates or ship type).`, 'error');
      closeDetails();
      if (ok.length === 1) {
        mode = { kind: 'idle' };
        if (dispatch({ type: 'playUpgrade', player: state.active, card: uid, ship: ok[0].id })) say(`${def.name} fitted to your ${SHIPS[ok[0].type].name.toLowerCase()}.`);
        return;
      }
      return setMode({ kind: 'upgrade', card: uid, tiles: [...new Set(ok.map((s) => s.tile))] });
    }
    if (def.type === CARD_TYPE.CREDIT) {
      mode = { kind: 'idle' };
      if (dispatch({ type: 'playCredit', player: state.active, card: uid })) say(`+${def.credits} credit${def.credits === 1 ? '' : 's'}${def.draw ? ' and you draw a card' : ''}.`);
      return;
    }
    if (def.type === CARD_TYPE.UTILITY && def.draw) {
      mode = { kind: 'idle' };
      if (dispatch({ type: 'playDraw', player: state.active, card: uid })) say(`${def.name}: you draw ${def.draw} card${def.draw === 1 ? '' : 's'}.`);
      return;
    }
    if (def.type === CARD_TYPE.SHIP) {
      const check = deployCheck(state, state.active, uid);
      if (!check.ok) return say(check.reason, 'error');
      closeDetails();
      return setMode({ kind: 'deploy', card: uid, tiles: check.tiles });
    }
    if (def.command === 'attack') {
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
    if (def.command === 'move') {
      const movable = shipsOf(state, state.active).filter((s) => moveTargets(state, s.id, def.speedBonus).size > 0);
      if (!movable.length) return say('You have no ship on the board that can move. Deploy one first.', 'error');
      closeDetails();
      if (movable.length === 1) return chooseShip(uid, movable[0].id);
      return setMode({ kind: 'moveShip', card: uid, tiles: [...new Set(movable.map((s) => s.tile))] });
    }
    say(`${def.name} can't be played yet.`);
  }

  /** Best weapon option per target ship: a kill first, then the most damage; ion last. */
  function bestOptions(options) {
    const best = new Map();
    const score = (o) => (o.preview.ion ? -1 : (o.preview.damage >= o.target.hull ? 100 : 0) + o.preview.damage);
    for (const o of options) {
      const cur = best.get(o.target.id);
      if (!cur || score(o) > score(cur)) best.set(o.target.id, o);
    }
    return best;
  }

  /** Floating preview next to the pointer while aiming at a target. */
  function showTargetPreview(opt, e) {
    const t = opt.target;
    const pirate = t.owner === 'pirate';
    const max = pirate ? 4 : SHIPS[t.type].hull;
    const after = opt.preview.ion ? t.hull : Math.max(0, t.hull - opt.preview.damage);
    const lethal = !opt.preview.ion && after === 0;
    const all = mode.options.filter((o) => o.target.id === t.id);
    const weapons = shipStats(state, state.ships.find((s) => s.id === mode.ship)).weapons;
    const reserve = pirate ? 0 : state.players[t.owner].reserve.length;
    const segs = Array.from({ length: max }, (_, i) => h(`span.seg${i >= t.hull ? '.empty' : i >= after ? '.lose' : ''}`));
    targetPreview.replaceChildren(...[
      h('div.tp-head',
        h('span.swatch', { style: { background: pirate ? '#d23c3c' : PLAYER_COLORS[t.owner].main } }),
        h('b', pirate ? 'Pirate fleet' : `${state.players[t.owner].name}'s ${SHIPS[t.type].name.toLowerCase()}`),
        lethal && h('span.tp-kill', 'DESTROY')),
      h('div.tp-hull', segs, h('span.tp-hull-num', opt.preview.ion ? `${t.hull}/${max}` : `${t.hull} → ${after}`)),
      ...all.map((o) => h(`div.tp-weapon${o === opt ? '.best' : ''}`,
        h('span', `${weapons[o.weapon].type}`),
        h('b', o.preview.ion ? 'Disables it next turn' : describeDamage(o.preview)))),
      reserve > 0 && h('div.tp-note', `${state.players[t.owner].name} holds ${plural(reserve, 'card')} in reserve and may react.`),
      h('div.tp-hint', all.length > 1 ? 'Click to fire the highlighted weapon, or pick one in the bar.' : 'Click to fire.'),
    ].filter(Boolean));
    const r = boardWrap.getBoundingClientRect();
    let x = e.clientX - r.left + 18;
    let y = e.clientY - r.top + 14;
    targetPreview.classList.add('show');
    const w = targetPreview.offsetWidth;
    const hgt = targetPreview.offsetHeight;
    if (x + w > r.width - 8) x = e.clientX - r.left - w - 18;
    if (y + hgt > r.height - 8) y = r.height - hgt - 8;
    targetPreview.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }

  function hideTargetPreview() {
    targetPreview.classList.remove('show');
    if (hoverTarget !== null) {
      hoverTarget = null;
      board.invalidate();
    }
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
  function afterCombatAction(after = () => {}) {
    fxp.whenIdle(() => {
      if (state.pending) return resolvePending(after);
      if (state.lastCombat) return combatReport(state.lastCombat, after);
      return after();
    });
  }

  function chooseShip(card, shipId) {
    setMode({ kind: 'moveDest', card, ship: shipId, routes: moveTargets(state, shipId, CARDS[state.cards[card].def].speedBonus ?? 0) });
  }

  board.on('hover', () => { if (mode.kind === 'moveDest') board.invalidate(); });

  /** The ship sprite under a click, if any. */
  function shipUnder(tile, e) {
    if (tile === null || !e) return null;
    const r = canvas.getBoundingClientRect();
    const b = board.toBoard((e.clientX - r.left) * board.dpr, (e.clientY - r.top) * board.dpr);
    const n = state.map.nodes[tile];
    let best = null;
    for (const sh of shipsAt(state, tile)) {
      const [ox, oy] = slotOffset(state, sh);
      const dx = b.x - (n.x + ox);
      const dy = b.y - (n.y + oy);
      if (Math.abs(dx) < 8.5 && Math.abs(dy) < 6) {
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) best = { sh, d };
      }
    }
    return best?.sh ?? null;
  }

  // ---------------------------------------------------------- hover tooltips

  function tileTipFor(id) {
    const node = state.map.nodes[id];
    const ships = shipsAt(state, id);
    const ctrl = controllerOf(state, id);
    let controller = ctrl === null ? 'No one' : state.players[ctrl].name;
    if (ctrl === null && ships.length) controller = ships.every((x) => x.owner === 'pirate') ? 'No one (pirates hold it)' : 'No one (tied hull)';
    const found = { derelict: 'derelict', bonus: 'bonus cache', pirateNest: 'pirate nest' };
    const shown = { ...state.map, nodes: state.map.nodes.map((n) => (n.revealed ? { ...n, hidden: false } : n)) };
    return tileTip(shown, id, {
      controller: node.type === 'void' ? null : controller,
      ships: ships.map((x) => `${x.owner === 'pirate' ? 'pirate fleet' : `${state.players[x.owner].name}'s ${SHIPS[x.type].name.toLowerCase()}`} (${x.hull})`),
      revealed: node.revealed ? `Revealed: it held a ${found[node.hiddenContent]}.`
        : pirateWarning(state)?.tiles.includes(id) ? 'Pirate signals: a pirate fleet warps in here at the end of this round.' : null,
    });
  }

  function shipTipFor(id) {
    const ship = state.ships.find((x) => x.id === id);
    if (!ship) return null;
    const status = [];
    if (ship.disabled !== undefined) status.push('Disabled by ion this turn.');
    if (ship.firedTurn === state.turnNumber) status.push('Has fired this turn.');
    const route = state.routes.find((r) => r.ship === id);
    if (route) status.push(`Runs the trade route ${route.label}.`);
    return shipTip(ship, {
      ownerName: ship.owner === 'pirate' ? 'Neutral pirate fleet' : `${state.players[ship.owner].name}'s fleet · ${tileTitle(state.map.nodes[ship.tile])}`,
      stats: shipStats(state, ship),
      upgrades: ship.upgrades.map((u) => CARDS[state.cards[u].def]),
      status,
    });
  }

  function missionTipFor(id) {
    const p = me();
    const held = p.missions.find((m) => m.id === id);
    if (!held) return missionTip(id);
    return missionTip(id, held.scored ? 'Complete' : missionProgressText(state, p, id), held.scored ? `Scored +${MISSIONS[id].vp} VP` : null);
  }

  const tips = installTooltips((kind, args) => {
    if (kind === 'card') return cardTip(args[0], args[1] ?? '', { price: args[2] ? Number(args[2]) : null });
    if (kind === 'mission') return missionTipFor(args[0]);
    if (kind === 'ship') return shipTipFor(args[0]);
    if (kind === 'tile') return tileTipFor(Number(args[0]));
    if (kind === 'text') { // text:Title|Body
      const [title, body] = args.join(':').split('|');
      return [h('div.tip-head', h('b.tip-title', title)), h('p.tip-text', body)];
    }
    return null;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) { hideTargetPreview(); return tips.hide(); } // panning
    const r = canvas.getBoundingClientRect();
    const tile = board.tileAt({ x: (e.clientX - r.left) * board.dpr, y: (e.clientY - r.top) * board.dpr });
    const sh = shipUnder(tile, e);
    if (mode.kind === 'attackTarget' && !locked) {
      tips.hide();
      const opt = sh && bestOptions(mode.options).get(sh.id);
      if (!opt) return hideTargetPreview();
      if (hoverTarget !== sh.id) { hoverTarget = sh.id; board.invalidate(); }
      return showTargetPreview(opt, e);
    }
    if (sh) return tips.hover(`ship:${sh.id}`, () => shipTipFor(sh.id), e);
    if (tile !== null) return tips.hover(`tile:${tile}`, () => tileTipFor(tile), e);
    return tips.hide();
  });
  canvas.addEventListener('pointerleave', () => { tips.hide(); hideTargetPreview(); });

  board.on('click', (tile, e) => {
    if (fxp.isBusy()) return;
    if (locked && tile !== null && mode.kind === 'idle') return openDetails(tile); // look around during CPU turns
    if (locked) return;
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
      const aimed = shipUnder(tile, e);
      const pick = aimed && bestOptions(mode.options).get(aimed.id);
      if (pick) { hideTargetPreview(); return fireAt(pick); }
      const here = [...bestOptions(mode.options).values()].filter((o) => o.target.tile === tile);
      if (!here.length) return say('Click a ship with a red target marker, or pick one from the bar above.', 'error');
      if (here.length === 1) return fireAt(here[0]);
      return say('Several targets there: pick one from the bar above.');
    }
    if (mode.kind === 'upgrade') {
      const defId = state.cards[mode.card].def;
      const ok = shipsAt(state, tile).filter((s) => s.owner === state.active && !upgradeCheck(state, s, defId));
      if (!ok.length) return say('Pick a highlighted tile with a ship that can take this upgrade.', 'error');
      if (ok.length > 1) return setMode({ ...mode, pickFrom: ok.map((s) => s.id) });
      const { card } = mode;
      mode = { kind: 'idle' };
      if (dispatch({ type: 'playUpgrade', player: state.active, card, ship: ok[0].id })) say(`${CARDS[defId].name} fitted.`);
      return;
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
        if (state.pending) fxp.whenIdle(() => resolvePending());
        else {
          const s = state.ships.find((x) => x.id === ship);
          if (s && isTrader(s) && routeOptions(state, s).length && !state.routes.some((r) => r.ship === s.id)) {
            fxp.whenIdle(() => openShip(s.id));
            say(`Your ${SHIPS[s.type].name.toLowerCase()} can start a trade route here: pick a destination in its panel.`);
          }
        }
      }
      return;
    }
    const hitShip = shipUnder(tile, e);
    if (hitShip) {
      if (openShipId === hitShip.id) closeDetails();
      else openShip(hitShip.id);
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
    openShipId = null;
    board.select(null);
    details.classList.remove('open');
  }

  const ownerName = (owner) => (owner === 'pirate' ? 'Pirates' : state.players[owner].name);

  function shipRow(ship) {
    const def = shipDef(ship);
    const color = ship.owner === 'pirate' ? '#ff8a7a' : PLAYER_COLORS[ship.owner].light;
    return h('li.ship-row.clickable', { onclick: () => openShip(ship.id), 'data-tip': `ship:${ship.id}` },
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

  const cap1 = (t) => t[0].toUpperCase() + t.slice(1);

  /** Details pane for one ship: art, stats, status and upgrade slots. */
  function openShip(id) {
    const ship = state.ships.find((x) => x.id === id);
    if (!ship) return closeDetails();
    openShipId = id;
    openTile = null;
    board.select(ship.tile);
    const pirate = ship.owner === 'pirate';
    const def = shipDef(ship);
    const st = shipStats(state, ship);
    const color = pirate ? PIRATE_COLOR : PLAYER_COLORS[ship.owner];
    const mine = !pirate && ship.owner === state.active && !locked && state.phase === 'action';
    const slots = def.slots ?? 0;
    const route = state.routes.find((r) => r.ship === id);
    const weapons = st.weapons.length
      ? st.weapons.map((w) => `${cap1(w.type)} ${w.type === 'ion' ? '(disables)' : w.damage}${w.range ? `, range ${w.range}` : ''}`).join(' · ')
      : 'Unarmed';
    const fits = mine ? me().hand.filter((u) => CARDS[state.cards[u].def].type === CARD_TYPE.UPGRADE && !upgradeCheck(state, ship, state.cards[u].def)) : [];
    const pct = Math.max(0, Math.min(100, (ship.hull / def.hull) * 100));
    const upgradeSlot = (u) => {
      const ud = CARDS[state.cards[u].def];
      return h('div.slot', { 'data-tip': `card:${state.cards[u].def}:${pirate ? '' : ship.owner}` },
        spriteIcon(`cardart:${state.cards[u].def}:${pirate ? '' : ship.owner}`, 88),
        h('div', h('b', ud.name), h('div.muted.small', ud.text)));
    };
    const emptySlot = () => h('div.slot.empty', h('div.slot-plus', '+'),
      h('div', h('b', 'Empty slot'), h('div.muted.small', 'Play an Upgrade card on this ship to fill it.')));
    details.replaceChildren(...[
      h('button.close', { 'aria-label': 'Close details', onclick: closeDetails }, '×'),
      h('div.ship-hero', { style: { '--glow': color.main } }, spriteIcon(`ship:${pirate ? 'frigate' : ship.type}:${pirate ? 'pirate' : ship.owner}`, 270)),
      h('div.title', def.name),
      h('div.type', { style: { color: color.light } }, pirate ? 'Neutral pirate fleet' : `${state.players[ship.owner].name}'s fleet`),
      h('div.hull', { title: `Hull ${ship.hull} of ${def.hull}` },
        h('div.hull-fill', { style: { width: `${pct}%`, background: pct > 66 ? 'var(--good)' : pct > 33 ? 'var(--gold)' : 'var(--bad)' } }),
        h('span', `Hull ${ship.hull} / ${def.hull}`)),
      def.special && h('p.effect', def.special),
      ship.disabled !== undefined && h('div.callout.danger', h('b', 'Disabled by ion'), h('span', 'It cannot move or attack until its owner\'s turn ends.')),
      ship.firedTurn === state.turnNumber && h('div.callout', h('b', 'Has fired'), h('span', 'Each ship fires once per turn.')),
      h('h3', 'Stats'),
      row('Speed', `${st.speed}${st.speed !== def.speed ? ` (base ${def.speed})` : ''}`),
      row('Weapons', weapons),
      row('Shields', st.shields ? String(st.shields) : '—'),
      row('Armor', st.armor ? String(st.armor) : '—'),
      !pirate && row('Command Points', String(def.cp)),
      (st.cloaked || st.pointDefense || st.pierce || st.repairDrones || st.cargoPod) && row('Systems', [
        st.cloaked && 'cloaked', st.pointDefense && 'point defense', st.pierce && 'targeting computer',
        st.repairDrones && 'repair drones', st.cargoPod && 'cargo pod'].filter(Boolean).join(', ')),
      h('div.row', h('span', 'Location'), h('button.linkish', { onclick: () => openDetails(ship.tile) }, tileTitle(state.map.nodes[ship.tile]))),
      !pirate && isTrader(ship) && h('h3', 'Trade route'),
      !pirate && isTrader(ship) && routeSection(ship, mine),
      !pirate && h('h3', `Upgrade slots · ${ship.upgrades.length} of ${slots} used`),
      !pirate && h('div.slots', [...ship.upgrades.map(upgradeSlot), ...Array.from({ length: Math.max(0, slots - ship.upgrades.length) }, emptySlot)]),
      fits.length > 0 && h('h3', 'Fit an upgrade from your hand'),
      fits.length > 0 && h('div.fit-list', fits.map((u) => h('button', {
        onclick: () => { if (dispatch({ type: 'playUpgrade', player: state.active, card: u, ship: id })) say(`${CARDS[state.cards[u].def].name} fitted.`); },
      }, `Fit ${CARDS[state.cards[u].def].name}`))),
    ].filter(Boolean));
    details.classList.add('open');
    return null;
  }

  /** A trader's route: what it runs now, and (on your turn) where it can run to. */
  function routeSection(ship, mine) {
    const route = state.routes.find((r) => r.ship === ship.id);
    const node = state.map.nodes[ship.tile];
    const opts = routeOptions(state, ship);
    const current = route
      ? h('div.route-current', { onmouseenter: () => previewRoute(route.path), onmouseleave: () => previewRoute(null) },
        h('b', route.label),
        h('span.muted.small', plural(route.length, 'jump')),
        blockaded(state, route) ? h('b.small.warn', 'blockaded') : h('b.small.gold', `+${routeIncome(state, route)}/turn`))
      : h('p.muted.small', 'No route yet.');
    if (!mine) return h('div.route-box', current);
    let why = null;
    if (!opts.length) {
      if (node.type === 'home' && node.homeOf === ship.owner) why = 'Leave your home sector first: then a trade node or planet can start a route.';
      else if (!isRouteEnd(node)) why = 'Move onto a trade node or planet to set up a route from here.';
      else why = 'No destination in range (one end must be a trade node, up to 8 jumps).';
    }
    return h('div.route-box',
      current,
      why && h('p.muted.small', why),
      opts.length > 0 && h('div.small.muted', route ? 'Replace it with a route to:' : 'Set up a route to:'),
      opts.length > 0 && h('div.route-opts', opts.map((o) => {
        const income = routeIncome(state, { ship: ship.id, length: o.length });
        const same = route && route.b === o.to && route.a === ship.tile;
        return h(`button.route-opt${same ? '.on' : ''}`, {
          type: 'button',
          disabled: same,
          'data-tip': `tile:${o.to}`,
          onmouseenter: () => previewRoute(o.path),
          onmouseleave: () => previewRoute(null),
          onclick: () => {
            previewRoute(null);
            if (dispatch({ type: 'establishRoute', player: state.active, ship: ship.id, to: o.to })) {
              say(`Trade route set up to ${tileTitle(state.map.nodes[o.to])}: +${income} credit${income === 1 ? '' : 's'} at the start of your turns.`);
              openShip(ship.id);
            }
          },
        },
        h('span.ro-name', tileTitle(state.map.nodes[o.to])),
        h('span.muted.small', `${TYPE_LABEL_SHORT[state.map.nodes[o.to].type] ?? ''} · ${plural(o.length, 'jump')}`),
        h('b.gold', `+${income}`));
      })),
      h('p.muted.small', 'Point at a destination to see the route on the map. The ship must stay on the route, and enemy ships on it blockade it.'));
  }

  function previewRoute(path) {
    routePreview = path;
    board.invalidate();
  }

  function openDetails(tile) {
    openShipId = null;
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
      ships.length > 1 && h('p.muted.small', 'The player with the most total hull here has the upper hand. Planets, stations, homes, trade nodes and intersections stay with their holder through ties and after ships leave.'),
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

  /** In-game confirmation (browser confirm() dialogs are not available everywhere). */
  function askConfirm(title, text, yesLabel, onYes) {
    const wasOpen = overlay.classList.contains('show') ? [...overlay.firstChild.childNodes] : null;
    const back = () => (wasOpen ? showOverlay(wasOpen) : hideOverlay());
    showOverlay([
      h('h2', title),
      h('p.muted', text),
      h('div.dialog-actions',
        h('button.big', { onclick: back }, 'Cancel'),
        h('button.primary.big', { onclick: () => { hideOverlay(); onYes(); } }, yesLabel)),
    ]);
  }

  function hideOverlay() {
    overlay.classList.remove('show');
    overlay.replaceChildren();
  }

  function endTurnDialog() {
    if (locked) return;
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
      const roundsBefore = state.rounds.length;
      hideOverlay();
      mode = { kind: 'idle' };
      closeDetails();
      if (!dispatch({ type: 'endTurn', player: p.id, keep: [...keep] })) return;
      if (state.rounds.length !== roundsBefore) fxp.whenIdle(() => roundSummary(state.rounds.at(-1), nextTurn));
      else fxp.whenIdle(nextTurn);
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

  function roundSummary(rs, then = nextTurn) {
    sound.sfx('round');
    const ranked = [...state.players].sort((a, b) => b.vp - a.vp);
    const end = rs.ending ?? { chance: 0 };
    const over = state.phase === 'over';
    const nextChance = END_CHANCE[state.settings?.length ?? 'standard'][state.round] ?? 0;
    showOverlay([
      h('div.kicker', `End of round ${rs.round}`),
      h('h2', 'Round scoring'),
      h('table.score',
        h('thead', h('tr', h('th', 'Player'), h('th', 'Key planets held'), h('th', 'Agreements'), h('th', 'This round'), h('th', 'Total VP'))),
        h('tbody', ranked.map((p) => {
          const sc = rs.scores.find((x) => x.player === p.id);
          return h('tr',
            h('td', h('span.swatch', { style: { background: PLAYER_COLORS[p.id].main } }), p.name),
            h('td', sc.keys.length ? sc.keys.map((t) => tileTitle(state.map.nodes[t])).join(', ') : '—'),
            h('td', sc.agreements ? `${sc.agreements}` : '—'),
            h('td', sc.vp ? `+${sc.vp}` : '0'),
            h('td', h('b', p.vp)));
        }))),
      h('p.muted.small', 'Key planets score 2 VP each and active trade agreements 1 VP each, every round.'),
      rs.arrivals?.length > 0 && h('div.callout.danger.pirate-callout',
        h('b', 'Pirates warp in!'),
        h('span', `${plural(rs.arrivals.length, 'pirate fleet')} arrived ${placesOf(rs.arrivals)}. They start hunting freighters at the end of round ${pirateRound(state)}.`)),
      !over && pirateWarning(state) && h('div.callout.pirate-callout',
        h('b', 'Pirate signals detected'),
        h('span', `${plural(pirateWarning(state).tiles.length, 'pirate fleet')} will warp in ${placesOf(pirateWarning(state).tiles)} at the end of round ${state.round}. They're marked in red on the board.`)),
      rs.pirates?.length > 0 && h('div',
        h('h3.section', 'Pirate phase'),
        combatLines(rs.pirates)),
      end.chance > 0 && h(`div.ending${end.ends ? '.ends' : ''}`,
        h('div.ending-title', end.ends ? 'IMPERIAL CEASEFIRE' : 'Ceasefire talks fail'),
        h('div', end.ends
          ? (end.chance >= 1 ? 'The final round has been fought. The Empire imposes peace.' : `The Senate votes for peace (${END_ODDS_LABEL[end.chance]} chance). The war is over.`)
          : `The Senate debated a ceasefire (${END_ODDS_LABEL[end.chance]} chance) — but the war goes on.`)),
      !over && nextChance > 0 && h('p.muted.small', `After round ${state.round}: ${END_ODDS_LABEL[nextChance]} chance the game ends.`),
      h('div.dialog-actions', over
        ? h('button.primary.big', { onclick: finalScreen }, 'Final scoring')
        : h('button.primary.big', { onclick: () => { hideOverlay(); then(); } }, `Start round ${state.round}`)),
    ]);
  }

  /** "at Kelea Gate and 1 other spot" / "at 2 spots in open space". */
  function placesOf(tiles) {
    const named = tiles.map((t) => state.map.nodes[t]).filter((n) => n.name).map((n) => n.name);
    const rest = tiles.length - named.length;
    if (!named.length) return `at ${plural(rest, 'spot')} in deep space`;
    return `at ${named.join(', ')}${rest ? ` and ${plural(rest, 'other spot')}` : ''}`;
  }

  function finalScreen() {
    sound.sfx('victory');
    const f = state.final;
    const rows = f.ranking.map((r) => {
      const p = state.players[r.player];
      const ms = p.missions.map((m) => {
        const def = MISSIONS[m.id];
        return h(`span.mission-chip${m.scored ? '.ok' : '.no'}`, { 'data-tip': `mission:${m.id}` }, `${m.scored ? '✔' : '✖'} ${def.name}${m.scored ? ` +${def.vp}` : ''}`);
      });
      return h(`tr${r.place === 1 ? '.winner' : ''}`,
        h('td', h('b', r.place === 1 ? '🏆 1' : r.place)),
        h('td', h('span.swatch', { style: { background: PLAYER_COLORS[p.id].main } }), p.name),
        h('td', p.vpFrom.planets), h('td', { title: `${p.vpFrom.agreements} from agreements, ${p.vpFrom.routes ?? 0} from active routes` }, p.vpFrom.agreements + (p.vpFrom.routes ?? 0)), h('td', p.vpFrom.kills), h('td', p.vpFrom.missions),
        h('td', h('b.total', p.vp)),
        h('td.small', plural(r.keys, 'planet'), ' · ', plural(r.ships, 'ship'), r.tiebreak && r.tiebreak !== 'shared' ? h('div.muted', `won tie on ${r.tiebreak}`) : null),
        h('td', ms));
    });
    const winner = state.players[f.ranking[0].player];
    const winners = f.ranking.filter((r) => r.place === 1).map((r) => state.players[r.player].name);
    const headline = winners.length > 1
      ? `${winners.slice(0, -1).join(', ')} and ${winners.at(-1)} share the win with ${winner.vp} VP`
      : `${winner.name} wins with ${winner.vp} VP`;
    showOverlay([
      h('div.ending.ends', h('div.ending-title', 'IMPERIAL CEASEFIRE'), h('div', `The war ends after round ${f.round}.`)),
      h('h2', { style: { color: PLAYER_COLORS[winner.id].light, marginTop: '14px' } }, headline),
      h('table.score.final',
        h('thead', h('tr', h('th', '#'), h('th', 'Player'), h('th', 'Planets'), h('th', { title: 'Trade agreements each round, plus 1 VP per active trade route at the end' }, 'Trade'), h('th', 'Kills'), h('th', 'Missions'), h('th', 'Total'), h('th', 'Tiebreak'), h('th', 'Secret missions'))),
        h('tbody', rows)),
      h('p.muted.small', 'Ties are broken by most key planets controlled, then most ships on the board.'),
      h('div.dialog-actions',
        h('button', { onclick: hideOverlay }, 'View the board'),
        h('button.primary.big', { onclick: () => { clearGame(); location.hash = ''; } }, 'New game')),
    ]);
  }

  /** Public announcement of completed missions. */
  function announce(notices) {
    sound.sfx('mission');
    if (overlay.classList.contains('show')) return say(notices.map((n) => n.text).join(' '));
    showOverlay([
      h('div.kicker', 'Secret mission revealed'),
      ...notices.map((n) => {
        const def = MISSIONS[n.mission];
        return h('div.mission-reveal',
          spriteIcon(`mission:${n.mission}`, 360),
          h('h2', { style: { color: PLAYER_COLORS[n.player].light } }, `${def.name}  +${def.vp} VP`),
          h('p', `${state.players[n.player].name}: ${def.text}`));
      }),
      h('div.dialog-actions', h('button.primary.big', { onclick: () => { hideOverlay(); render(); } }, 'Continue')),
    ]);
  }

  /** Choose another card from hand (Smuggler's Cache, Refit Dock). */
  function pickCardDialog(title, text, source, onPick) {
    const p = me();
    showOverlay([
      h('h2', title),
      h('p.muted', text),
      h('div.keep-cards', p.hand.filter((u) => u !== source).map((u) => cardFace(state.cards[u].def, {
        owner: p.id, onClick: () => { hideOverlay(); onPick(u); },
      }))),
      h('div.dialog-actions', h('button', { onclick: hideOverlay }, 'Cancel')),
    ]);
  }

  function missionDialog() {
    const p = me();
    const keep = new Set();
    const list = h('div.mission-pick');
    const ok = h('button.primary.big', { disabled: true }, 'Keep these 2');
    const draw = () => {
      list.replaceChildren(...p.missionOffer.map((id) => {
        const def = MISSIONS[id];
        return h(`button.mission-card${keep.has(id) ? '.on' : ''}`, {
          'data-tip': `mission:${id}`,
          onclick: () => {
            if (keep.has(id)) keep.delete(id);
            else if (keep.size < 2) keep.add(id);
            draw();
          },
        },
        spriteIcon(`mission:${id}`, 232),
        h('div.mc-top', h('span.mc-kind', `${def.kind} · ${def.timing === 'immediate' ? 'Immediate' : 'End of game'}`), h('b.mc-vp', `${def.vp} VP`)),
        h('div.mc-name', def.name),
        h('div.mc-text', def.text));
      }));
      ok.disabled = keep.size !== 2;
    };
    ok.onclick = () => {
      if (dispatch({ type: 'chooseMissions', player: p.id, keep: [...keep] })) hideOverlay();
    };
    draw();
    showOverlay([
      h('div.kicker', `${p.name}: secret missions`),
      h('h2', 'Keep 2 of these 3 missions'),
      h('p.muted', 'Missions stay secret until scored. Immediate missions are revealed and scored the moment you complete them; end-of-game missions are revealed at final scoring.'),
      list,
      h('div.dialog-actions', ok),
    ]);
  }

  function combatLines(events) {
    return h('ul.combat-log', events.map((e) => h('li', e)));
  }

  function combatReport(result, after = null) {
    if (!combatOwners.has(HUMAN)) { // CPU against CPU (or pirates): no pop-up
      if (result?.events?.length) say(result.events.at(-1));
      pendingBattle = null;
      return after?.();
    }
    if (pendingBattle && pendingBattle.result === result) {
      const { battle } = pendingBattle;
      pendingBattle = null;
      overlay.replaceChildren(h('div.dialog.battle-dialog'));
      overlay.classList.add('show');
      playBattle(overlay.firstChild, battle, {
        animate: board.animate,
        onDone: () => { hideOverlay(); render(); after?.(); },
      });
      return;
    }
    showOverlay([
      h('div.kicker', 'Combat report'),
      h('h2', result.events.some((e) => e.includes('destroyed')) ? 'Ship destroyed!' : 'Shots fired'),
      combatLines(result.events),
      h('div.dialog-actions', h('button.primary.big', { onclick: () => { hideOverlay(); render(); after?.(); } }, 'Continue')),
    ]);
  }

  /**
   * Something needs an answer from the defender: an attack (reactions), an
   * enemy arriving (ambush) or a trade offer. You answer yours in a dialog;
   * CPU players answer at once. `after` runs once the result has been shown.
   */
  function resolvePending(after = () => {}) {
    const pend = state.pending;
    if (!pend) return after();
    pendingAfter = after;
    if (pend.defender === HUMAN) {
      sound.sfx(pend.kind === 'offer' ? 'turn' : 'error');
      return pend.kind === 'offer' ? offerDialog() : reactionDialog();
    }
    // A CPU defender decides.
    const from = pend.kind === 'offer' ? state.players[pend.from] : null;
    const answer = respondCpu(state, pend.defender);
    if (!dispatch(answer)) dispatch({ ...answer, card: null, accept: false });
    if (pend.kind === 'offer') {
      const d = state.players[pend.defender];
      const ok = state.agreements.some((a) => (a.a === from.id && a.b === d.id) || (a.b === from.id && a.a === d.id));
      say(ok ? `${d.name} accepts: trade agreement signed.` : `${d.name} declines the trade agreement.`, ok ? 'info' : 'error');
      return after();
    }
    const result = state.lastCombat ?? { events: [`${state.players[pend.defender].name} lets the ship pass.`] };
    return fxp.whenIdle(() => combatReport(result, after));
  }

  function offerDialog() {
    const pend = state.pending;
    const from = state.players[pend.from];
    const d = state.players[pend.defender];
    const answer = (accept) => {
      if (!dispatch({ type: 'respondOffer', player: d.id, accept })) return;
      showOverlay([
        h('div.kicker', 'Trade offer'),
        h('h2', accept ? 'Agreement signed' : 'Offer declined'),
        h('p', accept ? `${from.name} and ${d.name} now each earn +1 credit per turn and 1 VP per round while both run a trade route.` : `${d.name} declined ${from.name}'s offer.`),
        h('div.dialog-actions', h('button.primary.big', { onclick: () => { hideOverlay(); render(); pendingAfter(); } }, 'Continue')),
      ]);
    };
    showOverlay([
      h('div.kicker', `${d.name}, respond`),
      h('h2', `${from.name} offers a trade agreement`),
      h('p', 'Both of you get +1 credit at the start of each turn and 1 VP at the end of every round, while you both still run a trade route. Either of you may break it on your own turn for a one-time 2 credits.'),
      h('div.dialog-actions', h('button.big', { onclick: () => answer(false) }, 'Decline'), h('button.primary.big', { onclick: () => answer(true) }, 'Accept')),
    ]);
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
    hideOverlay();
    fxp.whenIdle(() => combatReport(result, pendingAfter));
  }

  /** Start whoever's turn it is now: you, or a CPU opponent. */
  function nextTurn() {
    hideOverlay();
    if (state.phase === 'over') { render(); return finalScreen(); }
    if (state.pending) return resolvePending(nextTurn);
    if (startFx.length) {
      fxp.play(startFx, startFx.prev ?? state, state);
      startFx = [];
    }
    if (state.players[state.active].cpu) return runCpuTurn();
    const p = me();
    locked = false;
    seenHand = new Set(); // your new hand deals in
    render();
    sound.sfx('turn');
    const ev = state.turnStart?.player === p.id ? state.turnStart.events : [];
    say(ev?.length ? `Your turn. ${ev.join(' ')}` : 'Your turn.');
    if (p.missionOffer.length) missionDialog();
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const idle = () => new Promise((r) => fxp.whenIdle(r));
  const until = (fn) => new Promise((r) => fn(r));

  /** Play a CPU opponent's whole turn, one animated action at a time. */
  async function runCpuTurn() {
    if (cpuRunning) return;
    cpuRunning = true;
    locked = true;
    const pid = state.active;
    const cpu = state.players[pid];
    mode = { kind: 'idle' };
    render();
    sound.sfx('turn');
    let count = 0;
    try {
      while (state.phase === 'action' && state.active === pid) {
        await idle();
        await wait(cpuDelay());
        while (overlay.classList.contains('show')) await wait(150); // e.g. a mission reveal you haven't closed yet
        if (state.pending) { await until((r) => resolvePending(r)); continue; }
        let action = nextCpuAction(state, pid);
        if (++count > 60) action = { type: 'endTurn', player: pid, keep: [] }; // safety net
        const roundsBefore = state.rounds.length;
        const before = state;
        if (!dispatch(action)) {
          dispatch({ type: 'endTurn', player: pid, keep: [] });
        } else narrate(cpu, action, before);
        if (['attack', 'move', 'offerAgreement'].includes(action.type)) {
          await idle();
          if (state.pending) await until((r) => resolvePending(r));
          else if (action.type === 'attack' && state.lastCombat) await until((r) => combatReport(state.lastCombat, r));
        }
        if (state.rounds.length !== roundsBefore) {
          await idle();
          if (state.phase === 'over') break;
          await until((r) => roundSummary(state.rounds.at(-1), r));
        }
      }
    } finally {
      cpuRunning = false;
    }
    nextTurn();
  }

  function cpuDelay() {
    return { slow: 1100, normal: 650, fast: 220 }[cpuSpeed()] ?? 650;
  }

  /** Say what a CPU player just did. */
  function narrate(cpu, a, before) {
    const tname = (t) => tileTitle(state.map.nodes[t]);
    const shipName = (id, st = state) => { const sh = st.ships.find((x) => x.id === id); return sh ? (sh.owner === 'pirate' ? 'pirate fleet' : SHIPS[sh.type].name.toLowerCase()) : 'ship'; };
    const whose = (id) => { const sh = before.ships.find((x) => x.id === id); return sh?.owner === HUMAN ? 'your' : sh?.owner === 'pirate' ? 'a' : `${state.players[sh?.owner]?.name ?? ''}'s`; };
    let text = null;
    if (a.type === 'deploy') text = `${cpu.name} deploys a ${CARDS[before.cards[a.card].def].name.toLowerCase()} at ${tname(a.tile)}.`;
    else if (a.type === 'move') text = `${cpu.name} moves a ${shipName(a.ship, before)} to ${tname(a.tile)}.`;
    else if (a.type === 'attack') text = `${cpu.name}'s ${shipName(a.ship, before)} attacks ${whose(a.target)} ${shipName(a.target, before)}!`;
    else if (a.type === 'buy') text = `${cpu.name} buys ${CARDS[before.cards[a.def]?.def ?? a.def].name}.`;
    else if (a.type === 'establishRoute') text = `${cpu.name} sets up a trade route to ${tname(a.to)}.`;
    else if (a.type === 'playUpgrade') text = `${cpu.name} fits ${CARDS[before.cards[a.card].def].name} to a ${shipName(a.ship)}.`;
    else if (a.type === 'repair') text = `${cpu.name} repairs a ${shipName(a.ship)}.`;
    else if (a.type === 'scout') text = `${cpu.name} scouts the market.`;
    else if (a.type === 'endTurn') text = `${cpu.name} ends their turn.`;
    if (text) say(text);
  }

  // ---------------------------------------------------------- render

  function render() {
    const p = me();
    if (mode.kind !== 'attackTarget' && targetPreview.classList.contains('show')) hideTargetPreview();
    roundLabel.textContent = `Round ${state.round}`;
    const order = turnOrder(state);
    orderChips.replaceChildren(...order.map((pid, i) => {
      const done = i < state.turnInRound;
      const pl = state.players[pid];
      const now = pid === state.active && state.phase === 'action';
      return h(`span.order-chip${now ? '.now' : ''}${done ? '.done' : ''}`, {
        style: { borderColor: PLAYER_COLORS[pid].main, color: PLAYER_COLORS[pid].light },
        title: `${pl.name}${pl.cpu ? ' (CPU)' : ' (you)'}: ${done ? 'has played this round' : now ? 'playing now' : 'plays later this round'}`,
      }, pl.cpu ? '' : '★ ', pl.name, h('b', `${pl.vp} VP`));
    }));
    renderModeBar();
    renderHand(p);
    renderSidebar(p);
    renderTable(p);
    if (openShipId !== null) openShip(openShipId);
    else if (openTile !== null) openDetails(openTile);
    board.invalidate();
  }

  /**
   * A ship as a clickable tile: art, owner, hull bar, upgrades and a line of
   * extra info. `lose` flashes that much hull; `badge` adds a corner label.
   */
  function shipChoice(id, { onClick, info = '', lose = 0, badge = null, danger = false, hover = false } = {}) {
    const s = state.ships.find((x) => x.id === id);
    const pirate = s.owner === 'pirate';
    const max = pirate ? PIRATE.hull : SHIPS[s.type].hull;
    const color = pirate ? PIRATE_COLOR : PLAYER_COLORS[s.owner];
    const after = Math.max(0, s.hull - lose);
    const segs = Array.from({ length: max }, (_, i) => h(`span.seg${i >= s.hull ? '.empty' : i >= after ? '.lose' : ''}`, { style: i < after ? { background: color.main } : null }));
    const status = [
      s.disabled !== undefined && 'ION-disabled',
      s.firedTurn === state.turnNumber && 'fired this turn',
      state.routes.some((r) => r.ship === s.id) && 'runs a trade route',
    ].filter(Boolean);
    return h(`button.ship-choice${danger ? '.danger' : ''}${badge === 'DESTROY' ? '.lethal' : ''}`, {
      type: 'button',
      style: { '--owner': color.main },
      'data-tip': `ship:${s.id}`,
      onclick: onClick,
      onmouseenter: () => { pickHover = s.id; if (hover) hoverTarget = s.id; board.invalidate(); },
      onmouseleave: () => { pickHover = null; if (hover) hoverTarget = null; board.invalidate(); },
    },
    badge && h('span.sc-badge', badge),
    h('div.sc-art', spriteIcon(`ship:${shipSprite(s)}:${pirate ? 'pirate' : s.owner}`, 96)),
    h('div.sc-name', h('b', pirate ? 'Pirate fleet' : SHIPS[s.type].name), h('span', pirate ? 'Pirates' : state.players[s.owner].name)),
    h('div.sc-hull', segs, h('span.sc-num', lose ? `${s.hull}→${after}` : `${s.hull}/${max}`)),
    s.upgrades.length > 0 && h('div.sc-ups', s.upgrades.map((u) => h('span.sc-up', { 'data-tip': `card:${state.cards[u].def}` }, CARDS[state.cards[u].def].name))),
    info && h('div.sc-info', info),
    status.length > 0 && h('div.sc-status', status.join(' · ')));
  }

  function renderModeBar() {
    const cancel = h('button', { onclick: () => setMode({ kind: 'idle' }) }, 'Cancel (Esc)');
    let content = null;
    if (mode.kind === 'deploy') {
      const def = CARDS[state.cards[mode.card].def];
      content = [h('span', `Deploy ${def.name.toLowerCase()} (${SHIPS[def.ship].cp} CP): click a highlighted tile.`), cancel];
    } else if (mode.kind === 'moveShip') {
      const bonus = CARDS[state.cards[mode.card].def].speedBonus ?? 0;
      content = mode.pickFrom
        ? [h('span', 'Which ship moves?'), h('div.ship-choices', mode.pickFrom.map((id) => shipChoice(id, {
          onClick: () => chooseShip(mode.card, id),
          info: `Speed ${shipStats(state, state.ships.find((x) => x.id === id)).speed + bonus}`,
        }))), cancel]
        : [h('span', 'Move: click one of your highlighted ships.'), cancel];
    } else if (mode.kind === 'attackShip') {
      content = mode.pickFrom
        ? [h('span', 'Which ship fires?'), h('div.ship-choices', mode.pickFrom.map((id) => {
          const s = state.ships.find((x) => x.id === id);
          const w = shipStats(state, s).weapons;
          return shipChoice(id, { onClick: () => chooseAttacker(mode.card, id), info: w.map((x) => `${x.type} ${x.damage}`).join(' · ') });
        })), cancel]
        : [h('span', 'Attack: click one of your highlighted ships.'), cancel];
    } else if (mode.kind === 'attackTarget') {
      const s = state.ships.find((x) => x.id === mode.ship);
      const weapons = shipStats(state, s).weapons;
      content = [h('span', `${SHIPS[s.type].name} fires at:`), h('div.ship-choices', mode.options.map((o) => {
        const t = o.target;
        const lethal = !o.preview.ion && o.preview.damage >= t.hull;
        return shipChoice(t.id, {
          onClick: () => fireAt(o),
          lose: o.preview.ion ? 0 : o.preview.damage,
          danger: true,
          badge: o.preview.ion ? 'ION' : lethal ? 'DESTROY' : `−${o.preview.damage}`,
          info: `${weapons[o.weapon].type}: ${o.preview.ion ? 'disables it next turn' : describeDamage(o.preview)}`,
          hover: true,
        });
      })), cancel];
    } else if (mode.kind === 'upgrade') {
      const def = CARDS[state.cards[mode.card].def];
      content = mode.pickFrom
        ? [h('span', `Fit ${def.name} to:`), h('div.ship-choices', mode.pickFrom.map((id) => {
          const s = state.ships.find((x) => x.id === id);
          return shipChoice(id, {
            onClick: () => {
              const { card } = mode;
              mode = { kind: 'idle' };
              if (dispatch({ type: 'playUpgrade', player: state.active, card, ship: id })) say(`${def.name} fitted.`);
            },
            info: `${s.upgrades.length} of ${SHIPS[s.type].slots} slots used`,
          });
        })), cancel]
        : [h('span', `Fit ${def.name}: click a highlighted tile with one of your ships.`), cancel];
    } else if (mode.kind === 'repair') {
      const def = CARDS[state.cards[mode.card].def];
      content = [h('span', `${def.name}: click a highlighted tile with a damaged ship (+${def.repair} hull).`), cancel];
    } else if (mode.kind === 'moveDest') {
      const s = state.ships.find((x) => x.id === mode.ship);
      content = [h('span', `Move ${SHIPS[s.type].name.toLowerCase()} (speed ${shipStats(state, s).speed + (CARDS[state.cards[mode.card].def].speedBonus ?? 0)}): click a destination. Badges show movement used, ☁ = nebula damage, ✋ = ships you don\'t control: you must stop there.`), cancel];
    }
    modeBar.replaceChildren(...(content ?? []));
    modeBar.classList.toggle('show', Boolean(content));
    // Ship pickers are tall: slide the map so the ships in question stay visible below them.
    const involved = mode.kind === 'attackTarget'
      ? [state.ships.find((x) => x.id === mode.ship)?.tile, ...mode.options.map((o) => o.target.tile)]
      : (mode.pickFrom ?? []).map((id) => state.ships.find((x) => x.id === id)?.tile);
    const key = `${mode.kind}|${involved.join(',')}`;
    if (modeBar.querySelector('.ship-choices') && key !== clearedFor) {
      clearedFor = key;
      requestAnimationFrame(() => keepClearOfBar(involved.filter((t) => t !== undefined)));
    } else if (!content) clearedFor = null;
  }

  function keepClearOfBar(tiles) {
    if (!tiles.length) return;
    const wrap = boardWrap.getBoundingClientRect();
    const bar = modeBar.getBoundingClientRect();
    const barBottom = bar.bottom - wrap.top + 24; // css px inside the board
    const top = Math.min(...tiles.map((t) => board.toScreen(state.map.nodes[t].x, state.map.nodes[t].y - 14).y / board.dpr));
    if (top >= barBottom) return;
    const shift = Math.min(barBottom - top, wrap.height * 0.45); // css px to move the board down
    board.center.y -= (shift * board.dpr) / board.scale;
    board.invalidate();
  }

  function renderHand(p) {
    const cpuTurn = state.phase === 'action' && state.active !== HUMAN;
    let dealt = 0;
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
      } else if (def.type === CARD_TYPE.UPGRADE && !shipsOf(state, p.id).some((s) => !upgradeCheck(state, s, defId))) {
        cs = 'blocked';
        note = shipsOf(state, p.id).length ? 'No ship can take it (slots or type)' : 'Deploy a ship first';
      } else if (def.command === 'attack' && !shipsOf(state, p.id).some((s) => attackOptions(state, s).length > 0)) {
        cs = 'blocked';
        note = 'No enemy in range of your armed ships';
      } else if (def.repair && !shipsOf(state, p.id).some((s) => s.hull < SHIPS[s.type].hull)) {
        cs = 'blocked';
        note = 'No damaged ship';
      } else if (def.command === 'move' && !shipsOf(state, p.id).some((s) => moveTargets(state, s.id, def.speedBonus).size > 0)) {
        cs = 'blocked';
        note = 'No ship on the board to move';
      }
      if (mode.card === uid) cs = 'selected';
      const el = cardFace(defId, { owner: p.id, state: cs, note, onClick: () => clickCard(uid) });
      if (!seenHand.has(uid)) {
        el.classList.add('deal');
        el.style.animationDelay = `${dealt++ * 70}ms`;
      }
      return el;
    });
    seenHand = new Set(p.hand);
    handBar.replaceChildren(
      h('div.hand-label',
        h('div', { style: { color: PLAYER_COLORS[p.id].light } }, h('b', p.name)),
        cpuTurn
          ? h('div.cpu-turn', { style: { color: PLAYER_COLORS[state.active].light } }, h('span.cpu-dot'), `${state.players[state.active].name} is playing…`)
          : h('div.credits', { title: 'Credits to spend this turn' }, spriteIcon('card:credit', 16), h('b', p.credits), 'credits'),
        h('div.muted.small', cpuTurn ? 'Your hand, for your next turn' : `${p.played.length} card${p.played.length === 1 ? '' : 's'} played`)),
      h('div.hand-cards', cards.length ? cards : h('div.muted', 'No cards left in hand.')),
      h('div.piles',
        h('button.pile', { type: 'button', title: 'View your deck: draw pile, discard pile and cards on the board', onclick: () => deckDialog('deck') }, h('b', p.deck.length), h('span', 'Deck')),
        h('button.pile', { type: 'button', title: 'View your discard pile', onclick: () => deckDialog('discard') }, h('b', p.discard.length), h('span', 'Discard'))),
      h('button.end-turn', { onclick: endTurnDialog, disabled: state.phase === 'over' || locked }, state.phase === 'over' ? 'Game over' : cpuTurn ? 'Opponents\' turn' : 'End turn'));
    handBar.classList.toggle('waiting', cpuTurn);
  }

  /** Every card the active player owns, by where it is. */
  function deckDialog(focus = 'deck') {
    const p = me();
    const TYPE_ORDER = ['credit', 'command', 'ship', 'upgrade', 'reaction', 'utility'];
    const group = (uids) => {
      const counts = new Map();
      for (const u of uids) counts.set(state.cards[u].def, (counts.get(state.cards[u].def) ?? 0) + 1);
      return [...counts].sort((a, b) => TYPE_ORDER.indexOf(CARDS[a[0]].type) - TYPE_ORDER.indexOf(CARDS[b[0]].type) || CARDS[a[0]].name.localeCompare(CARDS[b[0]].name));
    };
    const mini = ([defId, n]) => h(`div.tcard.mini.type-${CARDS[defId].type}`, { 'data-tip': `card:${defId}:${p.id}` },
      n > 1 && h('span.mini-count', `×${n}`),
      spriteIcon(`cardart:${defId}:${p.id}`, 92),
      h('div.tc-name', CARDS[defId].name),
      h('div.tc-foot', h('span.tc-kind', TYPE_WORD[CARDS[defId].type])));
    const section = (id, title, uids, note) => h(`section.deck-section${focus === id ? '.focus' : ''}`, { id: `deck-${id}` },
      h('h3', `${title} · ${uids.length}`),
      note && h('p.muted.small', note),
      uids.length ? h('div.deck-grid', group(uids).map(mini)) : h('p.muted.small', 'Empty.'));
    const ships = shipsOf(state, p.id);
    const onBoard = ships.flatMap((s) => [s.card, ...s.upgrades].filter(Boolean));
    const all = [...p.deck, ...p.hand, ...p.reserve, ...p.played, ...p.discard, ...onBoard];
    const byType = TYPE_ORDER.map((t) => [t, all.filter((u) => CARDS[state.cards[u].def].type === t).length]).filter(([, n]) => n);
    showOverlay([
      h('div.kicker', `${p.name}'s cards`),
      h('h2', `${all.length} cards in total`),
      h('div.deck-summary', byType.map(([t, n]) => h(`span.deck-chip.type-${t}`, `${n} ${TYPE_WORD[t]}`))),
      h('div.deck-sections',
        section('deck', 'Draw pile', p.deck, 'Shuffled: you draw from it in a random order. When it runs out, your discard pile is shuffled in.'),
        section('hand', 'In hand', p.hand),
        p.reserve.length > 0 && section('reserve', 'Kept in reserve', p.reserve, 'Hidden from opponents. Reactions here can answer attacks.'),
        p.played.length > 0 && section('played', 'Played this turn', p.played, 'Goes to the discard pile when your turn ends.'),
        section('discard', 'Discard pile', p.discard),
        h(`section.deck-section${focus === 'board' ? '.focus' : ''}`,
          h('h3', `On the board · ${onBoard.length}`),
          h('p.muted.small', 'Ship cards and fitted upgrades. They return to your discard pile if the ship is destroyed.'),
          ships.length ? h('div.deck-ships', ships.map((s) => h('div.deck-ship',
            h('button.linkish', { onclick: () => { hideOverlay(); openShip(s.id); } }, `${SHIPS[s.type].name} at ${tileTitle(state.map.nodes[s.tile])}`),
            h('div.deck-grid', [s.card, ...s.upgrades].filter(Boolean).map((u) => mini([state.cards[u].def, 1])))))) : h('p.muted.small', 'No ships on the board.'))),
      h('div.dialog-actions', h('button.primary.big', { onclick: hideOverlay }, 'Close')),
    ]);
    overlay.querySelector('.deck-section.focus')?.scrollIntoView({ block: 'start' });
  }

  function cpMeter(pid) {
    const used = cpUsed(state, pid);
    const cap = cpCapacity(state, pid);
    const pct = cap.total ? Math.min(100, (used / cap.total) * 100) : 100;
    return { used, cap, el: h('div.cp-meter', { title: `${used} of ${cap.total} Command Points in use` },
      h('div.cp-fill', { style: { width: `${pct}%`, background: used > cap.total ? 'var(--bad)' : PLAYER_COLORS[pid].main } })) };
  }

  // ---------------------------------------------------------- the card table

  function tableCard(defId, uid, p) {
    const card = CARDS[defId];
    const price = buyPrice(state, p.id, defId);
    const afford = !locked && state.phase === 'action' && p.credits + handCredits(state, p.id) >= price;
    const kind = card.upgradeKind ? `${card.upgradeKind} upgrade` : TYPE_WORD[card.type];
    const scouted = uid && p.scout === uid;
    return h(`button.tcard.type-${card.type}${afford ? '' : '.cant'}${scouted ? '.scouted' : ''}`, {
      type: 'button',
      'data-tip': `card:${defId}:${p.id}:${price}`,
      'aria-label': `${card.name}, costs ${price}. ${card.text}`,
      onclick: () => inspectCard(defId, uid),
    },
    spriteIcon(`cardart:${defId}:${p.id}`, 108),
    h('div.tc-name', card.name),
    h('div.tc-foot', h('span.tc-kind', kind),
      h('span.tc-price', price < card.cost && h('s', card.cost), price)));
  }

  /** Show one card large, with a Buy button. */
  function inspectCard(defId, uid, qty = 1) {
    const p = me();
    const card = CARDS[defId];
    const each = buyPrice(state, p.id, defId);
    const inHand = handCredits(state, p.id);
    const shipyard = !uid; // Shipyard cards never run out: buy several at once
    const maxQty = shipyard ? Math.max(1, Math.min(9, Math.floor((p.credits + inHand) / each))) : 1;
    qty = Math.max(1, Math.min(qty, maxQty));
    const price = each * qty;
    let why = null;
    const pay = !locked && p.credits < price ? autoPayCards(state, p.id, price - p.credits) : [];
    if (locked) why = 'Wait for your turn.';
    else if (state.phase !== 'action') why = 'The game is over.';
    else if (!pay) why = `This costs ${price}. You have ${p.credits} credit${p.credits === 1 ? '' : 's'}${inHand ? ` and ${inHand} more in Credit cards` : ''}.`;
    const payNote = pay?.length
      ? `Buying plays ${pay.map((u) => CARDS[state.cards[u].def].name).join(' + ')} from your hand.`
      : null;
    const scouted = uid && p.scout === uid;
    const buy = () => {
      hideOverlay();
      if (dispatch({ type: 'buy', player: p.id, def: uid ?? defId, autoPay: true, count: qty })) {
        say(qty > 1 ? `Bought ${qty} × ${card.name}. They go to your discard pile.` : `Bought ${card.name}. It goes to your discard pile.`);
      }
    };
    const stepper = shipyard && !locked && state.phase === 'action' && h('div.qty',
      h('span.muted.small', 'Copies'),
      h('button.qty-btn', { 'aria-label': 'One fewer', disabled: qty <= 1, onclick: () => inspectCard(defId, uid, qty - 1) }, '−'),
      h('b.qty-n', qty),
      h('button.qty-btn', { 'aria-label': 'One more', disabled: qty >= maxQty, onclick: () => inspectCard(defId, uid, qty + 1) }, '+'),
      h('span.muted.small', maxQty > 1 ? `You can afford up to ${maxQty}.` : `${each} each`));
    showOverlay([
      h('div.inspect',
        cardLarge(defId, { owner: p.id }),
        h('div.inspect-side',
          h('div.kicker', scouted ? 'Scouted from the market deck' : uid ? 'Market row' : 'Shipyard'),
          scouted && h('p.muted.small', 'Buy it this turn, or it goes to the bottom of the market deck when your turn ends.'),
          h('h2', card.name),
          h('p', card.text),
          each < card.cost && h('p.muted.small', `You control a station: ${card.cost} − 1 = ${each}.`),
          h('p.muted.small', 'Bought cards go to your discard pile and come into your hand when you draw them.'),
          stepper,
          why && h('div.callout.danger', h('span', why)),
          !why && payNote && h('p.small.pay-note', spriteIcon('card:credit', 14), payNote),
          h('div.dialog-actions',
            h('button.big', { onclick: hideOverlay }, 'Close'),
            h('button.primary.big', { disabled: Boolean(why), onclick: buy }, qty > 1 ? `Buy ${qty} for ${price}` : `Buy for ${price}`)))),
    ]);
  }

  function renderTable(p) {
    const discount = hasStation(state, p.id);
    table.replaceChildren(
      h('section.table-section',
        h('div.table-head', h('h2', 'Shipyard'), h('span.muted.small', discount ? 'Station: ships −1' : 'Always for sale')),
        h('div.tcards', SHIPYARD.map((def) => tableCard(def, null, p)))),
      h('section.table-section',
        h('div.table-head', h('h2', 'Market row'),
          h('span.deck-pile', { title: `${state.market.deck.length} cards left in the market deck` }, h('b', state.market.deck.length), ' in deck')),
        h('div.tcards', state.market.row.map((uid) => tableCard(state.cards[uid].def, uid, p)), scoutSlot(p))),
      tableCredits(p),
      h('p.muted.small.table-hint', 'Click a card to look at it and buy it. Credit cards in your hand pay automatically.'));
  }

  /** The face-down market deck: flip its top card once per turn (Scout the market). */
  function scoutSlot(p) {
    if (p.scout) return tableCard(state.cards[p.scout].def, p.scout, p);
    const used = p.scoutTurn === state.turnNumber;
    const why = locked ? 'Wait for your turn'
      : state.phase !== 'action' ? 'The game is over'
        : used ? 'Already scouted this turn'
          : !state.market.deck.length ? 'The market deck is empty' : null;
    return h(`button.tcard.scout${why ? '.cant' : ''}`, {
      type: 'button',
      disabled: Boolean(why),
      'data-tip': 'text:Scout the market|Once per turn, free: flip the top card of the market deck. You can buy it this turn at its normal price; if you don\'t, it goes to the bottom of the deck when your turn ends.',
      onclick: () => {
        if (!dispatch({ type: 'scout', player: p.id })) return;
        sound.sfx('card');
        const uid = me().scout;
        inspectCard(state.cards[uid].def, uid);
      },
    },
    h('div.scout-back', h('span.scout-mark', '?')),
    h('div.tc-name', 'Scout the market'),
    h('div.tc-foot', h('span.tc-kind', why ?? 'Free · once per turn')));
  }

  function tableCredits(p) {
    const inHand = handCredits(state, p.id);
    return h('div.table-credits', spriteIcon('card:credit', 18), h('b', p.credits), 'to spend',
      inHand > 0 && h('span.muted', `+ ${inHand} in hand`),
      inHand > 0 && state.phase === 'action' && h('button.small-btn', {
        onclick: () => { if (dispatch({ type: 'playAllCredits', player: p.id })) say(`Played your Credit cards: ${me().credits} credits to spend.`); },
      }, 'Play all credits'));
  }

  function tradePanel(p) {
    const mine = routesOf(state, p.id);
    const traders = shipsOf(state, p.id).filter((s) => isTrader(s) && routeOptions(state, s).length);
    const deals = state.agreements.filter((a) => a.a === p.id || a.b === p.id);
    const others = state.players.filter((o) => o.id !== p.id);
    return h('div.trade',
      mine.length
        ? h('ul.routes', mine.map((r) => {
          const blocked = blockaded(state, r);
          return h('li', { onclick: () => openDetails(r.a) },
            h('span', r.label), h('span.muted.small', plural(r.length, 'jump')),
            h(`b.small${blocked ? '.warn' : ''}`, blocked ? 'blockaded' : `+${routeIncome(state, r)}/turn`));
        }))
        : h('p.muted.small', 'No trade routes. Move a freighter or blockade runner out of your home and onto a trade node or planet to set one up (one end must be a trade node).'),
      ...traders.map((s) => {
        const opts = routeOptions(state, s);
        const sel = h('select', { 'aria-label': 'Route destination' }, opts.map((o) => h('option', { value: o.to },
          `to ${tileTitle(state.map.nodes[o.to])} · ${plural(o.length, 'jump')} · +${o.length >= 3 ? 2 : 1}`)));
        return h('div.route-setup',
          h('span.small', `${SHIPS[s.type].name} at ${tileTitle(state.map.nodes[s.tile])}:`),
          sel,
          h('button', { disabled: locked || !opts.length, onclick: () => { if (dispatch({ type: 'establishRoute', player: p.id, ship: s.id, to: Number(sel.value) })) say('Trade route set up: income arrives at the start of your turns.'); } },
            state.routes.some((r) => r.ship === s.id) ? 'Replace route' : 'Set up route'));
      }),
      h('div.deals',
        h('div.small.muted', 'Trade agreements'),
        ...others.map((o) => {
          const ag = agreementBetween(state, p.id, o.id);
          const active = ag && activeAgreements(state, p.id).includes(ag);
          const why = offerCheck(state, p.id, o.id);
          return h('div.deal-row',
            h('span', h('span.swatch', { style: { background: PLAYER_COLORS[o.id].main } }), o.name),
            ag
              ? h('span.small', active ? h('b', 'Active · +1/turn, 1 VP/round') : h('span.muted', 'Signed (inactive: a route is missing)'))
              : h('span.small.muted', why ?? 'Can offer'),
            ag
              ? h('button.small-btn', { disabled: locked, title: `Break it for a one-time ${BREAK_BONUS} credits`, onclick: () => askConfirm(`Break your agreement with ${o.name}?`, `You gain ${BREAK_BONUS} credits once. You both lose the +1 credit per turn and 1 VP per round.`, 'Break agreement', () => dispatch({ type: 'breakAgreement', player: p.id, with: o.id })) }, 'Break')
              : h('button.small-btn', { disabled: locked || Boolean(why), onclick: () => { if (dispatch({ type: 'offerAgreement', player: p.id, to: o.id })) resolvePending(); } }, 'Offer'));
        })));
  }

  function missionPanel(p) {
    if (p.missionOffer.length) return h('button.primary', { onclick: missionDialog }, 'Choose your 2 secret missions');
    return h('ul.missions', p.missions.map((m) => {
      const def = MISSIONS[m.id];
      return h(`li${m.scored ? '.scored' : ''}`, { 'data-tip': `mission:${m.id}` },
        spriteIcon(`mission:${m.id}`, 300),
        h('div', h('b', def.name), h('span.muted.small', ` · ${def.timing === 'immediate' ? 'immediate' : 'end of game'} · ${def.vp} VP`)),
        h('div.small.muted', def.text),
        h('div.small', m.scored ? h('b.ok', 'Completed') : `Progress: ${missionProgressText(state, p, m.id)}`));
    }));
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
          ? meter.cap.breakdown.map((b) => h('li', { onclick: () => openDetails(b.tile), 'data-tip': `tile:${b.tile}` },
            h('span', `${CP_LABEL[b.type]} · ${b.label}`), h('b', `+${b.amount}`)))
          : h('li.muted', 'You control no CP-giving tiles.'))),

      h('h2', 'Secret missions'),
      missionPanel(p),
      h('h2', 'Trade'),
      tradePanel(p),

      h('h2', `Fleet on the board (${fleet.length})`),
      fleet.length
        ? h('ul.fleet', fleet.map((s) => h('li', { onclick: () => openShip(s.id), 'data-tip': `ship:${s.id}` },
          spriteIcon(`ship:${s.type}:${s.owner}`, 22),
          h('span', SHIPS[s.type].name),
          h('span.muted.small', tileTitle(state.map.nodes[s.tile])),
          h('b.small', `${s.hull}/${SHIPS[s.type].hull}`))))
        : h('p.muted.small', 'No ships deployed. Play a Ship card to deploy it at your home sector.'),

      h('h2', 'Players'),
      h('table.players',
        h('thead', h('tr', h('th', 'Player'), h('th', 'VP'), h('th', 'CP'), h('th', 'Ships'), h('th', { title: 'Cards held in reserve for reactions (public count)' }, 'Held'), h('th', { title: 'Secret missions: scored / held' }, 'Missions'))),
        h('tbody', state.players.map((pl) => {
          const m = cpMeter(pl.id);
          return h(`tr${pl.id === state.active ? '.active' : ''}`,
            h('td', h('span.swatch', { style: { background: PLAYER_COLORS[pl.id].main } }), pl.name),
            h('td', pl.vp), h('td', `${m.used}/${m.cap.total}`), h('td', shipsOf(state, pl.id).length),
            h('td', pl.id === p.id ? '—' : pl.reserve.length),
            h('td', { title: pl.missions.filter((m) => m.scored).map((m) => MISSIONS[m.id].name).join(', ') }, `${pl.missions.filter((m) => m.scored).length}/${pl.missions.length || pl.missionOffer.length && 2}`));
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
  if (state.phase === 'over') finalScreen();
  else nextTurn();
  window.fleetCommand = {
    get state() { return state; }, board, dispatch, openDetails,
  };
}
