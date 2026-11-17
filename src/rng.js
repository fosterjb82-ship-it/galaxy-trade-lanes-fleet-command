// Seeded random numbers. Every random choice in the game goes through an Rng
// so a seed string reproduces the same map (and, later, the same game).

/** Hash any string to a 32-bit unsigned integer (FNV-1a). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  /** @param {string|number} seed */
  constructor(seed) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** mulberry32: float in [0, 1). */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Shuffle in place and return the array. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Snapshot of internal state so a game can be saved and resumed. */
  save() {
    return this.state;
  }

  static restore(state) {
    const r = new Rng(1);
    r.state = state >>> 0;
    return r;
  }
}

const SEED_WORDS = [
  'ORION', 'VEGA', 'LYRA', 'DRACO', 'CYGNUS', 'HYDRA', 'PERSEUS', 'CORVUS',
  'ARIES', 'NOVA', 'RIGEL', 'SIRIUS', 'ALTAIR', 'DENEB', 'POLLUX', 'ATLAS',
];

/** A short, readable, shareable seed such as "VEGA-4821". */
export function randomSeed() {
  const word = SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${word}-${num}`;
}
