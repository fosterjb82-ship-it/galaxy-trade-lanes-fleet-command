// Secret missions (DESIGN.md "Mission cards"). Each player is dealt 3 and
// keeps 2. Immediate missions score as soon as they are completed; end-of-game
// missions are checked at final scoring.

import { controlMap, shipsOf } from './state.js';
import { activeRoutes, activeAgreements } from './trade.js';
import { SHIPS } from './ships.js';

const TRADERS = new Set(['freighter', 'runner']);
const playerKills = (p) => p.killLog.filter((k) => k.owner !== 'pirate');
const controlled = (state, pid, type) => [...controlMap(state)].filter(([t, o]) => o === pid && state.map.nodes[t].type === type).length;

/** progress(state, player) -> [current, needed] */
export const MISSIONS = {
  'ace-squadron': {
    name: 'Ace Squadron', kind: 'Combat', timing: 'immediate', vp: 3, text: 'Destroy 3 enemy ships.',
    progress: (s, p) => [playerKills(p).length, 3],
  },
  'big-game-hunter': {
    name: 'Big Game Hunter', kind: 'Combat', timing: 'immediate', vp: 3, text: 'Destroy an enemy destroyer or carrier.',
    progress: (s, p) => [playerKills(p).filter((k) => k.type === 'destroyer' || k.type === 'carrier').length, 1],
  },
  'pirate-purge': {
    name: 'Pirate Purge', kind: 'Combat', timing: 'immediate', vp: 2, text: 'Destroy 2 neutral pirate fleets.',
    progress: (s, p) => [p.killLog.filter((k) => k.owner === 'pirate').length, 2],
  },
  'freighter-raider': {
    name: 'Freighter Raider', kind: 'Combat', timing: 'immediate', vp: 3, text: 'Destroy 2 enemy freighters or blockade runners.',
    progress: (s, p) => [playerKills(p).filter((k) => TRADERS.has(k.type)).length, 2],
  },
  'unbroken-line': {
    name: 'Unbroken Line', kind: 'Combat', timing: 'end', vp: 4, text: 'Lose no more than 2 ships all game.',
    progress: (s, p) => [p.losses, 2], done: (s, p) => p.losses <= 2, progressLabel: (s, p) => `${p.losses} lost (max 2)`,
  },
  'galactic-core': {
    name: 'Galactic Core', kind: 'Territory', timing: 'end', vp: 4, text: 'Control the central key planet.',
    progress: (s, p) => {
      const core = s.map.nodes.find((n) => n.core).id;
      return [controlMap(s).get(core) === p.id ? 1 : 0, 1];
    },
  },
  'twin-worlds': {
    name: 'Twin Worlds', kind: 'Territory', timing: 'immediate', vp: 3, text: 'Control 2 key planets at once.',
    progress: (s, p) => [controlled(s, p.id, 'key'), 2],
  },
  'crossroads-baron': {
    name: 'Crossroads Baron', kind: 'Territory', timing: 'end', vp: 3, text: 'Control 3 lane intersections.',
    progress: (s, p) => [controlled(s, p.id, 'intersection'), 3],
  },
  'station-network': {
    name: 'Station Network', kind: 'Territory', timing: 'end', vp: 3, text: 'Control 2 stations.',
    progress: (s, p) => [controlled(s, p.id, 'station'), 2],
  },
  'deep-strike': {
    name: 'Deep Strike', kind: 'Territory', timing: 'immediate', vp: 3,
    text: "Move a ship into an opponent's home sector and survive until your next turn.",
    progress: (s, p) => [p.deepStrikeDone ? 1 : 0, 1],
  },
  'trade-magnate': {
    name: 'Trade Magnate', kind: 'Economy', timing: 'end', vp: 4, text: 'Have 3 active trade routes.',
    progress: (s, p) => [activeRoutes(s, p.id).length, 3],
  },
  'long-haul': {
    name: 'Long Haul', kind: 'Economy', timing: 'immediate', vp: 2, text: 'Set up a trade route 4+ jumps long.',
    progress: (s, p) => [Math.min(p.longestRoute ?? 0, 4), 4],
  },
  diplomat: {
    name: 'Diplomat', kind: 'Economy', timing: 'end', vp: 3, text: 'Have active trade agreements with 2 different players.',
    progress: (s, p) => [activeAgreements(s, p.id).length, 2], minPlayers: 3,
  },
  'war-chest': {
    name: 'War Chest', kind: 'Economy', timing: 'immediate', vp: 2, text: 'Spend 12+ credits in a single turn.',
    progress: (s, p) => [Math.min(p.bestSpend ?? 0, 12), 12],
  },
  'merchant-fleet': {
    name: 'Merchant Fleet', kind: 'Economy', timing: 'end', vp: 2, text: 'Have 3 freighters or blockade runners on the board.',
    progress: (s, p) => [shipsOf(s, p.id).filter((x) => TRADERS.has(x.type)).length, 3],
  },
  backstabber: {
    name: 'Backstabber', kind: 'Wildcard', timing: 'immediate', vp: 3,
    text: "Break a trade agreement, then destroy one of that player's ships within your next turn.",
    progress: (s, p) => [p.backstabDone ? 1 : 0, 1], minPlayers: 3,
  },
  armada: {
    name: 'Armada', kind: 'Wildcard', timing: 'end', vp: 3, text: 'Have 6+ ships on the board.',
    progress: (s, p) => [shipsOf(s, p.id).length, 6],
  },
  'fully-loaded': {
    name: 'Fully Loaded', kind: 'Wildcard', timing: 'immediate', vp: 2, text: 'Fill every upgrade slot on one ship.',
    progress: (s, p) => [shipsOf(s, p.id).some((x) => SHIPS[x.type].slots > 0 && x.upgrades.length >= SHIPS[x.type].slots) ? 1 : 0, 1],
  },
};

export function missionDone(state, player, id) {
  const m = MISSIONS[id];
  if (m.done) return m.done(state, player);
  const [cur, need] = m.progress(state, player);
  return cur >= need;
}

export function missionProgressText(state, player, id) {
  const m = MISSIONS[id];
  if (m.progressLabel) return m.progressLabel(state, player);
  const [cur, need] = m.progress(state, player);
  return `${Math.min(cur, need)}/${need}`;
}

/** Mission ids in play for this player count (2-player games drop the diplomacy ones). */
export function missionPool(players) {
  return Object.keys(MISSIONS).filter((id) => !MISSIONS[id].minPlayers || players >= MISSIONS[id].minPlayers);
}
