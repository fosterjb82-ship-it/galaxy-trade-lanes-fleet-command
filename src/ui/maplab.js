// Stage 1 screen: Map Lab. Generate hex boards from shareable seeds, see
// every fairness check, inspect rejected candidates, zoom the board and click
// any tile for a details pane.

import { generateMap, generateCandidate, mapParams, allCosts, enterCost } from '../map/generator.js';
import { neighbors, key } from '../map/hex.js';
import { randomSeed } from '../rng.js';
import { Board } from '../render/board.js';
import { PLAYER_COLORS, tileSpriteKey, featureSpriteKey, sprite } from '../render/sprites.js';
import { h, spriteIcon } from './dom.js';

const TYPE_LABEL = {
  home: 'Home sector',
  key: 'Key planet',
  intersection: 'Lane intersection',
  station: 'Space station',
  trade: 'Trade node',
  empty: 'Open space',
  asteroid: 'Asteroid field',
  nebula: 'Nebula',
  void: 'Void rift',
};

const TYPE_EFFECT = {
  home: 'Your starting point. Deploy ships here.',
  key: 'Worth 2 VP to its controller at the end of every round.',
  intersection: 'A choke point many routes pass through. Controlling it can pay a toll of +1 credit per turn.',
  station: 'Deploy ships here. Ships cost 1 less while you control a station. Ships starting a turn here fully repair.',
  trade: 'Endpoint for trade routes between players.',
  empty: 'Plain space. Nothing here.',
  asteroid: 'Rocky and slow: entering costs 2 movement.',
  nebula: 'Ionised gas: a ship entering takes 1 damage.',
  void: 'Impassable. Ships cannot enter.',
};

const CP_VALUE = { home: 6, key: 2, station: 2 };
const VP_VALUE = { key: '2 per round' };
const HIDDEN_LABEL = { derelict: 'Derelict: salvage credits', pirateNest: 'Pirate nest: spawns a pirate fleet', bonus: 'Bonus cache: draw extra cards' };

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const players = Math.min(6, Math.max(2, Number(params.get('players')) || 4));
  return { seed: params.get('seed') || randomSeed(), players };
}

/** A DOM canvas showing a whole tile (background + feature) as pixel art. */
function tilePreview(node, reveal, cssWidth = 84) {
  const bg = sprite(tileSpriteKey(node));
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.max(1, Math.floor((cssWidth * dpr) / bg.width));
  const c = document.createElement('canvas');
  c.className = 'sprite';
  c.width = bg.width * scale;
  c.height = bg.height * scale;
  c.style.width = `${c.width / dpr}px`;
  c.style.height = `${c.height / dpr}px`;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bg, 0, 0, c.width, c.height);
  const fk = featureSpriteKey(node, { revealHidden: reveal });
  if (fk) {
    const f = sprite(fk);
    const x = (Math.floor(bg.width / 2) - Math.floor(f.width / 2)) * scale;
    const y = (Math.floor(bg.height / 2) - Math.floor(f.height / 2)) * scale;
    ctx.drawImage(f, x, y, f.width * scale, f.height * scale);
  }
  return c;
}

export function mountMapLab(root) {
  const initial = readHash();
  const state = { seed: initial.seed, players: initial.players, map: null, viewing: null, reveal: false, labels: true };
  let costs = null; // all-pairs movement cost for the board being shown

  const seedInput = h('input', { type: 'text', value: state.seed, size: 14, 'aria-label': 'Map seed', spellcheck: 'false' });
  const playersSelect = h('select', { 'aria-label': 'Players' },
    [2, 3, 4, 5, 6].map((n) => h('option', { value: n, selected: n === state.players }, `${n} players`)));
  const toast = h('span.toast', 'Link copied');

  const generate = () => {
    state.seed = seedInput.value.trim() || randomSeed();
    seedInput.value = state.seed;
    state.players = Number(playersSelect.value);
    history.replaceState(null, '', `#seed=${encodeURIComponent(state.seed)}&players=${state.players}`);
    const t0 = performance.now();
    state.map = generateMap(state.seed, state.players);
    state.ms = performance.now() - t0;
    state.viewing = null;
    show(state.map);
  };

  seedInput.addEventListener('keydown', (e) => e.key === 'Enter' && generate());
  playersSelect.addEventListener('change', generate);

  const topbar = h('header.topbar',
    h('div.brand', h('h1', 'Fleet Command'), h('span.stage', 'Stage 1 · Map Lab')),
    h('label', 'Seed', seedInput),
    h('label', playersSelect),
    h('button.primary', { onclick: generate }, 'Generate'),
    h('button', { onclick: () => { seedInput.value = randomSeed(); generate(); } }, 'Random seed'),
    h('button', {
      onclick: async () => {
        try { await navigator.clipboard.writeText(location.href); } catch { /* clipboard blocked */ }
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 1400);
      },
    }, 'Copy share link'),
    toast,
  );

  const canvas = h('canvas.board');
  const zoomLabel = h('span.zoom-level', '');
  const zoomControls = h('div.zoom',
    h('button', { title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => board.zoomBy(1) }, '+'),
    zoomLabel,
    h('button', { title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => board.zoomBy(-1) }, '−'),
    h('button.fit', { title: 'Fit board (0)', onclick: () => board.fit() }, 'Fit'));
  const details = h('aside.details', { 'aria-live': 'polite' });
  const boardWrap = h('div.board-wrap', canvas, zoomControls, details,
    h('div.hint', 'Click a tile for details · scroll or + / − to zoom · drag to pan'));
  const sidebar = h('aside.sidebar');
  root.append(topbar, h('div.main', boardWrap, sidebar));

  const board = new Board(canvas);
  board.on('zoom', (s) => { zoomLabel.textContent = `${s}×`; });

  function show(map, { keepView = false } = {}) {
    board.setMap(map, { keepView });
    costs = allCosts(map.nodes);
    closeDetails();
    renderSidebar();
  }

  // ---------------------------------------------------------- details pane

  function closeDetails() {
    board.select(null);
    details.classList.remove('open');
  }

  function openDetails(id) {
    const map = board.map;
    const node = map.nodes[id];
    board.select(id);
    const homes = map.nodes.filter((n) => n.type === 'home').sort((a, b) => a.homeOf - b.homeOf);
    const pirates = map.pirates.filter((p) => p.node === id);
    const at = new Map(map.nodes.map((n) => [key(n.q, n.r), n]));
    const adjacent = neighbors(node.q, node.r).map((c) => at.get(key(c.q, c.r))).filter(Boolean);

    let typeText = TYPE_LABEL[node.type];
    if (node.core) typeText = 'Key planet · Galactic core';
    else if (node.central) typeText = 'Key planet · contested center';
    if (node.type === 'home') typeText = `Home sector · Player ${node.homeOf + 1}`;
    const title = node.name ?? TYPE_LABEL[node.type];
    const cost = enterCost(node.type);

    const row = (label, value) => h('div.row', h('span', label), h('b', value));
    details.replaceChildren(...[
      h('button.close', { 'aria-label': 'Close details', onclick: closeDetails }, '×'),
      h('div.head',
        tilePreview(node, state.reveal),
        h('div',
          h('div.title', title),
          h('div.type', typeText),
          h('div.coords', `Tile ${node.q}, ${node.r}`))),
      h('p.effect', TYPE_EFFECT[node.type]),
      node.core && h('p.effect', 'The Galactic Core mission scores 4 VP for controlling this planet at the end of the game.'),
      node.hidden && h('div.callout',
        h('b', 'Hidden tile'),
        h('span', state.reveal ? HIDDEN_LABEL[node.hiddenContent] : 'Something is out here. It is revealed when a ship arrives.')),
      pirates.length > 0 && h('div.callout.danger',
        h('b', 'Neutral pirate fleet'),
        h('span', `Hull ${pirates[0].hull} / ${pirates[0].maxHull} · Laser ${pirates[0].weapon}. Moves toward freighters at the end of each round.`)),
      h('h3', 'Tile'),
      row('Movement to enter', cost === Infinity ? 'Impassable' : String(cost)),
      CP_VALUE[node.type] && row('Command Points', `+${CP_VALUE[node.type]} capacity`),
      VP_VALUE[node.type] && row('Victory points', VP_VALUE[node.type]),
      row('Controlled by', node.type === 'home' ? `Player ${node.homeOf + 1} (at start)` : 'No one'),
      node.type !== 'void' && h('h3', 'Moves from each home'),
      node.type !== 'void' && h('div.home-dist', homes.map((hm) => h('span.chip', {
        style: { borderColor: PLAYER_COLORS[hm.homeOf].main, color: PLAYER_COLORS[hm.homeOf].light },
      }, `P${hm.homeOf + 1}: ${costs[hm.id][id] === Infinity ? '—' : costs[hm.id][id]}`))),
      h('h3', 'Neighbouring tiles'),
      h('ul.neighbours', adjacent.map((n) => h('li', {
        onclick: () => openDetails(n.id),
        title: 'Show this tile',
      }, spriteIcon(featureSpriteKey(n, { revealHidden: state.reveal }) ?? tileSpriteKey(n), 18),
      h('span', n.name ?? TYPE_LABEL[n.type]),
      h('span.muted', n.name ? TYPE_LABEL[n.type] : '')))),
    ].filter(Boolean));
    details.classList.add('open');
  }

  board.on('click', (id) => {
    if (id === null || id === board.selected) closeDetails();
    else openDetails(id);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape') closeDetails();
    if (e.key === '+' || e.key === '=') board.zoomBy(1);
    if (e.key === '-' || e.key === '_') board.zoomBy(-1);
    if (e.key === '0') board.fit();
  });

  // ---------------------------------------------------------- sidebar

  function viewCandidate(attempt) {
    if (state.viewing === attempt || attempt === null) {
      state.viewing = null;
      show(state.map, { keepView: true });
    } else {
      state.viewing = attempt;
      show(generateCandidate(state.seed, state.players, attempt), { keepView: true });
    }
  }

  function renderSidebar() {
    const map = state.map;
    const shown = board.map;
    const p = mapParams(state.players);
    const failing = shown.checks.filter((c) => !c.pass);
    const count = (pred) => shown.nodes.filter(pred).length;

    const banner = state.viewing === null
      ? h('div.banner.good', '✔ Fair map', h('small',
        map.rejected.length === 0
          ? `first candidate passed · ${state.ms.toFixed(0)} ms`
          : `attempt ${map.attempt + 1} · ${map.rejected.length} rejected · ${state.ms.toFixed(0)} ms`))
      : h('div.banner.bad', `✖ Rejected candidate #${state.viewing + 1}`,
        h('small', `${failing.length} check${failing.length === 1 ? '' : 's'} failed`));

    const legend = [
      ['home:0', 'Home sector', count((n) => n.type === 'home')],
      ['core', 'Galactic core', count((n) => n.core)],
      ['key:0', 'Key planet', count((n) => n.type === 'key' && !n.core)],
      ['station', 'Space station', count((n) => n.type === 'station')],
      ['trade', 'Trade node', count((n) => n.type === 'trade')],
      ['intersection', 'Intersection', count((n) => n.type === 'intersection')],
      ['tile:asteroid:0', 'Asteroid field', count((n) => n.type === 'asteroid')],
      ['tile:nebula:0', 'Nebula', count((n) => n.type === 'nebula')],
      ['tile:void:0', 'Void rift', count((n) => n.type === 'void')],
      ['hidden', 'Hidden tile', count((n) => n.hidden)],
      ['tile:empty:0', 'Open space', count((n) => n.type === 'empty' && !n.hidden)],
      ['ship:frigate:pirate', 'Pirate fleet', shown.pirates.length],
    ];

    sidebar.replaceChildren(...[
      banner,
      h('h2', 'Fairness checks'),
      h('ul.checks', shown.checks.map((c) => h(`li.${c.pass ? 'pass' : 'fail'}`,
        h('span.mark', c.pass ? '✔' : '✖'), h('span.label', c.label), h('span.detail', c.detail)))),

      h('h2', 'Generation'),
      h('div.small.muted', { style: { marginBottom: '8px' } },
        map.rejected.length
          ? 'Candidates that failed a check were discarded. Click one to see why:'
          : 'The first candidate for this seed passed every check.'),
      map.rejected.length > 0 && h('div.rejects',
        map.rejected.map((r) => h(`button${state.viewing === r.attempt ? '.active' : ''}`, {
          title: `Failed: ${r.failed.join(', ')}`,
          onclick: () => viewCandidate(r.attempt),
        }, `#${r.attempt + 1}`)),
        state.viewing !== null && h('button', { onclick: () => viewCandidate(null) }, 'Back to accepted map')),

      h('h2', 'Board contents'),
      h('div.legend', legend.map(([k, label, n]) => h('div.item',
        h('div.icon', spriteIcon(k, 28)), label, h('span.count', n)))),
      h('div.small.muted', { style: { marginTop: '10px' } },
        `${shown.nodes.length} hex tiles (radius ${shown.radius}). ` +
        (shown.plan ? `Each home's own key planet is ${shown.plan.key} moves away and its station ${shown.plan.station}. ` : '') +
        `${p.centralCount} contested central planet${p.centralCount > 1 ? 's' : ''}.`),

      h('h2', 'Players'),
      h('div.legend', Array.from({ length: state.players }, (_, i) => h('div.item',
        h('div.icon', spriteIcon(`ship:fighter:${i}`, 26)),
        h('span', { style: { color: PLAYER_COLORS[i].light, fontWeight: 600 } }, `P${i + 1} ${PLAYER_COLORS[i].name}`)))),

      h('h2', 'View'),
      h('div.toggles',
        h('label', h('input', {
          type: 'checkbox', checked: state.labels,
          onchange: (e) => { state.labels = e.target.checked; board.setOptions({ showLabels: state.labels }); },
        }), 'Show tile names (when zoomed in)'),
        h('label', h('input', {
          type: 'checkbox', checked: state.reveal,
          onchange: (e) => {
            state.reveal = e.target.checked;
            board.setOptions({ revealHidden: state.reveal });
            if (board.selected !== null) openDetails(board.selected);
          },
        }), 'Reveal hidden tiles (debug)')),
    ].filter(Boolean));
  }

  window.addEventListener('hashchange', () => {
    const next = readHash();
    if (next.seed !== state.seed || next.players !== state.players) {
      seedInput.value = next.seed;
      playersSelect.value = String(next.players);
      generate();
    }
  });

  generate();
  // Expose for debugging and automated checks.
  window.fleetCommand = { state, board, openDetails };
}
