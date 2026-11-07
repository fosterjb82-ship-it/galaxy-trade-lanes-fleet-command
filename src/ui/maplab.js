// Stage 1 screen: Map Lab. Generate hex boards from shareable seeds, see
// every fairness check, inspect rejected candidates, zoom the board and click
// any tile for a details pane.

import { generateMap, generateCandidate, mapParams, allCosts } from '../map/generator.js';
import { randomSeed } from '../rng.js';
import { Board } from '../render/board.js';
import { PLAYER_COLORS } from '../render/sprites.js';
import { h, spriteIcon } from './dom.js';
import { tileDetails } from './details.js';

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const players = Math.min(6, Math.max(2, Number(params.get('players')) || 4));
  return { seed: params.get('seed') || randomSeed(), players };
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
    history.replaceState(null, '', `#lab&seed=${encodeURIComponent(state.seed)}&players=${state.players}`);
    const t0 = performance.now();
    state.map = generateMap(state.seed, state.players);
    state.ms = performance.now() - t0;
    state.viewing = null;
    show(state.map);
  };

  seedInput.addEventListener('keydown', (e) => e.key === 'Enter' && generate());
  playersSelect.addEventListener('change', generate);

  const topbar = h('header.topbar',
    h('div.brand', h('h1', 'Fleet Command'), h('span.stage', 'Map Lab')),
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
    h('span.spacer'),
    h('a.button', { href: '#' }, 'Back to game setup'),
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
    board.select(id);
    const pirates = map.pirates.filter((p) => p.node === id);
    details.replaceChildren(...tileDetails({
      map, id, costs, reveal: state.reveal, pirates, onNavigate: openDetails, onClose: closeDetails,
    }));
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
    if (!location.hash.startsWith('#lab')) return;
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
