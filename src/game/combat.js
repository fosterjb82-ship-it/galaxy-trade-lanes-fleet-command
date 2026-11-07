// Combat maths (DESIGN.md "Combat"). Fixed damage, no dice: players can see
// exactly what an attack will do before committing to it.
//
//   damage = weapon + Attack card bonus − shields − armor − evasive
//
// Lasers are weak against shields (shields apply in full). Cannons punch
// through shields (they ignore up to CANNON_PIERCE points). Missiles reach
// adjacent tiles but are stopped by point defense. Ion weapons deal no damage
// and disable the target for its owner's next turn.

import { shipDef } from './ships.js';
import { hexDistance } from '../map/hex.js';

export const CANNON_PIERCE = 2;
export const EVASIVE_REDUCTION = 2;
export const EMERGENCY_SHIELDS = 3;

/** Upgrade effects on combat stats; the upgrade cards arrive with the market. */
export const UPGRADE_EFFECTS = {};

/** Effective stats for a ship: base ship type plus any upgrades. */
export function shipStats(state, ship) {
  const def = shipDef(ship);
  const stats = {
    weapons: def.weapon ? [{ ...def.weapon }] : [],
    shields: 0,
    armor: def.armor ?? 0,
    speed: def.speed,
    evasive: Boolean(def.evasive),
    pointDefense: false,
    cloaked: false,
    pierce: 0, // ignore this many points of shields/armor (targeting computer)
  };
  for (const u of ship.upgrades ?? []) UPGRADE_EFFECTS[state.cards[u]?.def]?.(stats, def);
  return stats;
}

/**
 * Damage one weapon does to a target.
 * @returns {{ damage: number, raw: number, shields: number, armor: number, evasive: number, ion: boolean }}
 */
export function damageFor(weapon, attackerStats, targetStats, { bonus = 0, extraShields = 0, evasive = false } = {}) {
  if (weapon.type === 'ion') return { damage: 0, raw: 0, shields: 0, armor: 0, evasive: 0, ion: true };
  const raw = weapon.damage + bonus;
  let shields = targetStats.shields + extraShields;
  if (weapon.type === 'cannon') shields = Math.max(0, shields - CANNON_PIERCE);
  let armor = targetStats.armor;
  let pierce = attackerStats.pierce;
  const fromShields = Math.min(pierce, shields);
  shields -= fromShields;
  pierce -= fromShields;
  armor = Math.max(0, armor - pierce);
  const ev = evasive ? EVASIVE_REDUCTION : 0;
  return { damage: Math.max(0, raw - shields - armor - ev), raw, shields, armor, evasive: ev, ion: false };
}

export function tileDistance(state, a, b) {
  return hexDistance(state.map.nodes[a], state.map.nodes[b]);
}

/** Can this weapon on this ship reach that target? */
export function inRange(state, ship, weapon, target, targetStats = shipStats(state, target)) {
  const d = tileDistance(state, ship.tile, target.tile);
  if (targetStats.cloaked && d > 0) return false;
  return d <= (weapon.range ?? 0);
}

/** Why a ship can't attack right now, or null if it can. */
export function cannotAttack(state, ship) {
  if (!shipStats(state, ship).weapons.length) return `${shipDef(ship).name}s are unarmed.`;
  if (ship.disabled) return 'Disabled by an ion strike this turn.';
  if (ship.firedTurn === state.turnNumber) return 'Already fired this turn.';
  return null;
}

/**
 * Every target this ship could attack, with an exact damage preview.
 * @returns {{ target: object, weapon: number, preview: object }[]}
 */
export function attackOptions(state, ship, bonus = 0) {
  if (cannotAttack(state, ship)) return [];
  const mine = shipStats(state, ship);
  const out = [];
  for (const target of state.ships) {
    if (target.owner === ship.owner) continue;
    const ts = shipStats(state, target);
    mine.weapons.forEach((w, i) => {
      if (!inRange(state, ship, w, target, ts)) return;
      out.push({ target, weapon: i, preview: damageFor(w, mine, ts, { bonus }) });
    });
  }
  return out;
}

/** Explain a damage preview in words, e.g. "4 − 1 armor = 3". */
export function describeDamage(p) {
  if (p.ion) return 'Ion: no damage, disables it next turn';
  const parts = [`${p.raw}`];
  if (p.shields) parts.push(`${p.shields} shields`);
  if (p.armor) parts.push(`${p.armor} armor`);
  if (p.evasive) parts.push(`${p.evasive} evasive`);
  return parts.length > 1 ? `${parts.join(' − ')} = ${p.damage}` : `${p.damage}`;
}
