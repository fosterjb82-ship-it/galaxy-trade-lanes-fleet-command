// New game setup: player count, names, map seed.

import { randomSeed } from '../rng.js';
import { createGame } from '../game/state.js';
import { PLAYER_COLORS } from '../render/sprites.js';
import { h, spriteIcon } from './dom.js';
import { loadGame, saveGame } from './storage.js';

export function mountSetup(root) {
  const saved = loadGame();
  const state = { count: 4, names: PLAYER_COLORS.map((c, i) => `Player ${i + 1}`), seed: randomSeed(), length: 'standard' };

  const seedInput = h('input', { type: 'text', value: state.seed, size: 16, spellcheck: 'false', 'aria-label': 'Map seed' });
  seedInput.addEventListener('input', () => { state.seed = seedInput.value.trim(); renderLinks(); });
  const countRow = h('div.segmented');
  const namesBox = h('div.names');
  const labLink = h('a.button', { target: '_self' }, 'Preview map in Map Lab');
  const lengthRow = h('div.length-row');
  const LENGTHS = [
    ['standard', 'Standard', '7–10 rounds; the end is uncertain from round 7'],
    ['quick', 'Quick test', '3–4 rounds, to try the ending'],
  ];

  function renderLinks() {
    labLink.href = `#lab&seed=${encodeURIComponent(state.seed || 'ORION-1')}&players=${state.count}`;
  }

  function render() {
    countRow.replaceChildren(...[2, 3, 4, 5, 6].map((n) => h(`button${n === state.count ? '.on' : ''}`, {
      type: 'button', onclick: () => { state.count = n; render(); },
    }, String(n))));
    namesBox.replaceChildren(...Array.from({ length: state.count }, (_, i) => {
      const input = h('input', { type: 'text', value: state.names[i], 'aria-label': `Name of player ${i + 1}`, maxlength: 18 });
      input.addEventListener('input', () => { state.names[i] = input.value; });
      return h('label.name-row',
        h('span.icon', spriteIcon(`ship:fighter:${i}`, 24)),
        h('span.swatch', { style: { background: PLAYER_COLORS[i].main } }),
        input);
    }));
    lengthRow.replaceChildren(...LENGTHS.map(([id, label, hint]) => h(`label.length${state.length === id ? '.on' : ''}`,
      h('input', { type: 'radio', name: 'length', checked: state.length === id, onchange: () => { state.length = id; render(); } }),
      h('span', h('b', label), h('span.muted.small', ` · ${hint}`)))));
    renderLinks();
  }

  const start = () => {
    const players = state.names.slice(0, state.count).map((n, i) => n.trim() || `Player ${i + 1}`);
    const seed = state.seed || randomSeed();
    const game = createGame({ seed, players, length: state.length });
    saveGame(game);
    location.hash = '#play';
  };

  root.append(h('div.setup',
    h('div.setup-card',
      h('h1', 'Galaxy Trade Lanes'),
      h('div.subtitle', 'Fleet Command · hot-seat prototype'),
      saved && h('div.saved',
        h('div', h('b', 'Saved game'), h('span.muted', ` · round ${saved.round} · ${saved.players.map((p) => p.name).join(', ')}`)),
        h('a.button.primary', { href: '#play' }, 'Continue')),
      h('h2', 'Players'),
      countRow,
      namesBox,
      h('h2', 'Map seed'),
      h('div.seed-row', seedInput,
        h('button', { type: 'button', onclick: () => { seedInput.value = state.seed = randomSeed(); renderLinks(); } }, 'Random')),
      h('p.muted.small', 'The same seed and player count always produce the same board.'),
      h('h2', 'Game length'),
      lengthRow,
      h('div.actions', h('button.primary.big', { type: 'button', onclick: start }, saved ? 'Start new game' : 'Start game'), labLink))));
  render();
}
