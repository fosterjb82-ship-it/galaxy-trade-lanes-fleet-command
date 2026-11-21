// New game setup: you against 1–5 CPU opponents.

import { randomSeed } from '../rng.js';
import { createGame, applyAction } from '../game/state.js';
import { chooseMissions } from '../game/ai.js';
import { PLAYER_COLORS } from '../render/sprites.js';
import { h, spriteIcon } from './dom.js';
import { loadGame, saveGame } from './storage.js';
import { soundMenu } from './soundmenu.js';

const CPU_NAMES = ['Admiral Vex', 'Commander Orla', 'Captain Rusk', 'Warden Sela', 'Marshal Toren'];
const NAME_KEY = 'fleetcommand.name';

export function mountSetup(root) {
  const saved = loadGame();
  const solo = saved?.players.some((p) => p.cpu);
  let lastName = 'Commander';
  try { lastName = localStorage.getItem(NAME_KEY) || 'Commander'; } catch { /* ignore */ }
  const state = { cpus: 3, name: lastName, seed: randomSeed(), length: 'standard' };

  const seedInput = h('input', { type: 'text', value: state.seed, size: 16, spellcheck: 'false', 'aria-label': 'Map seed' });
  seedInput.addEventListener('input', () => { state.seed = seedInput.value.trim(); renderLinks(); });
  const nameInput = h('input', { type: 'text', value: state.name, maxlength: 18, 'aria-label': 'Your name' });
  nameInput.addEventListener('input', () => { state.name = nameInput.value; });
  const countRow = h('div.segmented');
  const rivals = h('div.names');
  const labLink = h('a.button', { target: '_self' }, 'Preview map in Map Lab');
  const lengthRow = h('div.length-row');
  const LENGTHS = [
    ['standard', 'Standard', '7–10 rounds; the end is uncertain from round 7'],
    ['quick', 'Quick test', '3–4 rounds, to try the ending'],
  ];

  function renderLinks() {
    labLink.href = `#lab&seed=${encodeURIComponent(state.seed || 'ORION-1')}&players=${state.cpus + 1}`;
  }

  function render() {
    countRow.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h(`button${n === state.cpus ? '.on' : ''}`, {
      type: 'button', onclick: () => { state.cpus = n; render(); },
    }, String(n))));
    rivals.replaceChildren(...CPU_NAMES.slice(0, state.cpus).map((name, i) => h('div.name-row.cpu',
      h('span.icon', spriteIcon(`ship:frigate:${i + 1}`, 24)),
      h('span.swatch', { style: { background: PLAYER_COLORS[i + 1].main } }),
      h('span', name), h('span.muted.small', 'CPU'))));
    lengthRow.replaceChildren(...LENGTHS.map(([id, label, hint]) => h(`label.length${state.length === id ? '.on' : ''}`,
      h('input', { type: 'radio', name: 'length', checked: state.length === id, onchange: () => { state.length = id; render(); } }),
      h('span', h('b', label), h('span.muted.small', ` · ${hint}`)))));
    renderLinks();
  }

  const start = () => {
    const you = state.name.trim() || 'Commander';
    try { localStorage.setItem(NAME_KEY, you); } catch { /* ignore */ }
    const players = [{ name: you }, ...CPU_NAMES.slice(0, state.cpus).map((name) => ({ name, cpu: true }))];
    let game = createGame({ seed: state.seed || randomSeed(), players, length: state.length });
    // CPU opponents pick their secret missions straight away.
    for (const p of game.players.filter((x) => x.cpu)) {
      game = applyAction(game, { type: 'chooseMissions', player: p.id, keep: chooseMissions(p) });
    }
    saveGame(game);
    location.hash = '#play';
  };

  root.append(h('div.setup-sound', soundMenu()), h('div.setup',
    h('div.setup-card',
      h('h1', 'Galaxy Trade Lanes'),
      h('div.subtitle', 'Fleet Command · you against the CPU'),
      solo && saved.phase !== 'over' && h('div.saved',
        h('div', h('b', 'Saved game'), h('span.muted', ` · round ${saved.round} · ${saved.players.map((p) => p.name).join(', ')}`)),
        h('a.button.primary', { href: '#play' }, 'Continue')),
      h('h2', 'Your name'),
      h('label.name-row',
        h('span.icon', spriteIcon('ship:fighter:0', 24)),
        h('span.swatch', { style: { background: PLAYER_COLORS[0].main } }),
        nameInput),
      h('h2', 'CPU opponents'),
      countRow,
      rivals,
      h('h2', 'Map seed'),
      h('div.seed-row', seedInput,
        h('button', { type: 'button', onclick: () => { seedInput.value = state.seed = randomSeed(); renderLinks(); } }, 'Random')),
      h('p.muted.small', 'The same seed and number of players always produce the same board.'),
      h('h2', 'Game length'),
      lengthRow,
      h('div.actions', h('button.primary.big', { type: 'button', onclick: start }, solo ? 'Start new game' : 'Start game'), labLink))));
  render();
}
