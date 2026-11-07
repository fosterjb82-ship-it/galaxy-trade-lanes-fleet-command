// Stage 1 screen: Map Lab. Generate maps from shareable seeds, see every
// fairness check, inspect rejected candidates and individual nodes.

import { generateMap, generateCandidate, mapParams } from '../map/generator.js';
import { buildAdjacency, bfs } from '../map/graph.js';
import { randomSeed } from '../rng.js';
import { Board } from '../render/board.js';
import { PLAYER_COLORS } from '../render/sprites.js';
import { h, spriteIcon } from './dom.js';

const TYPE_LABEL = {
  home: 'Home sector',
  key: 'Key planet',
  intersection: 'Lane intersection',
  station: 'Space station',
  trade: 'Trade node',
  empty: 'Empty space',
};

const TYPE_EFFECT = {
  home: 'Starting point; deploy ships here. +6 Command Points.',
  key: '2 VP per round to its controller. +2 Command Points.',
  intersection: 'Choke point. Optional toll: +1 credit per turn.',
  station: 'Deploy here, ships cost 1 less, full repair. +2 CP.',
  trade: 'Endpoint for trade routes.',
  empty: 'Plain space.',
};

const HIDDEN_LABEL = { derelict: 'Derelict (salvage credits)', pirateNest: 'Pirate nest', bonus: 'Bonus (extra cards)' };

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const players = Math.min(6, Math.max(2, Number(params.get('players')) || 4));
  return { seed: params.get('seed') || randomSeed(), players };
}

export function mountMapLab(root) {
  const initial = readHash();
  const state = { seed: initial.seed, players: initial.players, map: null, viewing: null, reveal: false, labels: true };

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
    board.setMap(state.map);
    renderSidebar();
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
  const inspector = h('div.inspector');
  const boardWrap = h('div.board-wrap', canvas, inspector,
    h('div.hint', 'Scroll to zoom · drag to pan · hover a node for details'));
  const sidebar = h('aside.sidebar');
  root.append(topbar, h('div.main', boardWrap, sidebar));

  const board = new Board(canvas);

  // ---------------------------------------------------------- inspector

  board.on('hover', (id, e) => {
    const map = board.map;
    if (id === null || !map) {
      inspector.style.display = 'none';
      return;
    }
    const node = map.nodes[id];
    const adj = buildAdjacency(map.nodes.length, map.lanes);
    const dist = bfs(adj, id);
    const homes = map.nodes.filter((n) => n.type === 'home');
    const lanes = map.lanes.filter((l) => l.a === id || l.b === id);
    const hazards = lanes.filter((l) => l.hazard).map((l) => l.hazard);
    const pirates = map.pirates.filter((p) => p.node === id);
    let typeText = TYPE_LABEL[node.type];
    if (node.core) typeText = 'Key planet · Galactic core';
    else if (node.central) typeText = 'Key planet · contested center';
    if (node.type === 'home') typeText = `Home sector · Player ${node.homeOf + 1}`;
    inspector.replaceChildren(...[
      h('div.title', node.name),
      h('div.type', typeText),
      h('div.small.muted', { style: { marginBottom: '6px' } }, TYPE_EFFECT[node.type]),
      node.hidden && h('div.row', 'Hidden', h('b', state.reveal ? HIDDEN_LABEL[node.hiddenContent] : 'Revealed when a ship arrives')),
      h('div.row', 'Exit lanes', h('b', lanes.length + (hazards.length ? ` (${hazards.join(', ')})` : ''))),
      pirates.length > 0 && h('div.row', 'Pirate fleet', h('b', `Hull ${pirates[0].hull}, laser ${pirates[0].weapon}`)),
      h('div.row', 'Jumps from homes', h('b', homes.map((hm) => dist[hm.id]).join(' / '))),
    ].filter(Boolean));
    inspector.style.display = 'block';
    const r = boardWrap.getBoundingClientRect();
    const x = e.clientX - r.left + 16;
    const y = e.clientY - r.top + 16;
    inspector.style.left = `${Math.min(x, r.width - 290)}px`;
    inspector.style.top = `${Math.min(y, r.height - inspector.offsetHeight - 10)}px`;
  });

  // ---------------------------------------------------------- sidebar

  function viewCandidate(attempt) {
    if (state.viewing === attempt || attempt === null) {
      state.viewing = null;
      board.setMap(state.map);
    } else {
      state.viewing = attempt;
      board.setMap(generateCandidate(state.seed, state.players, attempt));
    }
    renderSidebar();
  }

  function renderSidebar() {
    const map = state.map;
    const shown = board.map;
    const p = mapParams(state.players);
    const failing = shown.checks.filter((c) => !c.pass);
    const counts = {};
    for (const n of shown.nodes) counts[n.type] = (counts[n.type] ?? 0) + 1;
    const hidden = shown.nodes.filter((n) => n.hidden).length;
    const hazards = shown.lanes.filter((l) => l.hazard);

    const banner = state.viewing === null
      ? h('div.banner.good', '✔ Fair map', h('small',
        map.rejected.length === 0
          ? `first candidate passed · ${state.ms.toFixed(0)} ms`
          : `attempt ${map.attempt + 1} · ${map.rejected.length} rejected · ${state.ms.toFixed(0)} ms`))
      : h('div.banner.bad', `✖ Rejected candidate #${state.viewing + 1}`,
        h('small', `${failing.length} check${failing.length === 1 ? '' : 's'} failed`));

    const legend = [
      ['home:0', 'Home sector', counts.home],
      ['core', 'Galactic core', shown.nodes.filter((n) => n.core).length],
      ['key:0', 'Key planet', (counts.key ?? 0) - shown.nodes.filter((n) => n.core).length],
      ['station', 'Space station', counts.station],
      ['trade', 'Trade node', counts.trade],
      ['intersection', 'Intersection', counts.intersection],
      ['empty', 'Empty space', (counts.empty ?? 0) - hidden],
      ['hidden', 'Hidden node', hidden],
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

      h('h2', 'Map contents'),
      h('div.legend', legend.map(([key, label, count]) => h('div.item',
        h('div.icon', spriteIcon(key, 30)), label, h('span.count', count ?? 0)))),
      h('div.small.muted', { style: { marginTop: '10px' } },
        `${shown.nodes.length} nodes · ${shown.lanes.length} lanes · ` +
        `${hazards.filter((l) => l.hazard === 'asteroid').length} asteroid, ` +
        `${hazards.filter((l) => l.hazard === 'nebula').length} nebula lanes`),
      shown.plan && h('div.small.muted',
        `Each home: key planet ${shown.plan.key} jumps, station ${shown.plan.station} jumps away. ` +
        `${p.centralCount} contested central planet${p.centralCount > 1 ? 's' : ''}.`),

      h('h2', 'Players'),
      h('div.legend', Array.from({ length: state.players }, (_, i) => h('div.item',
        h('div.icon', spriteIcon(`ship:fighter:${i}`, 28)),
        h('span', { style: { color: PLAYER_COLORS[i].light, fontWeight: 600 } }, `P${i + 1} ${PLAYER_COLORS[i].name}`)))),

      h('h2', 'View'),
      h('div.toggles',
        h('label', h('input', {
          type: 'checkbox', checked: state.labels,
          onchange: (e) => { state.labels = e.target.checked; board.setOptions({ showLabels: state.labels }); },
        }), 'Show node names'),
        h('label', h('input', {
          type: 'checkbox', checked: state.reveal,
          onchange: (e) => { state.reveal = e.target.checked; board.setOptions({ revealHidden: state.reveal }); },
        }), 'Reveal hidden nodes (debug)')),
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
  window.fleetCommand = { state, board };
}
