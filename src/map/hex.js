// Hex grid maths. Pointy-top hexes in axial coordinates (q, r).
// Board pixel space is measured in *sprite pixels*: each tile sprite is
// TILE_W × TILE_H pixels and tiles sit TILE_W apart horizontally and
// ROW_STEP apart vertically, so pixel-art tiles tessellate exactly.

export const TILE_W = 28;
export const TILE_H = 32;
export const ROW_STEP = 24;

export const DIRS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export const key = (q, r) => `${q},${r}`;

export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function neighbors(q, r) {
  return DIRS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

/** All cells of a hexagon-shaped board of the given radius. */
export function hexagon(radius) {
  const cells = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (Math.abs(q + r) <= radius) cells.push({ q, r });
    }
  }
  return cells;
}

/** Tile centre in board (sprite-pixel) coordinates. */
export function toPixel(q, r) {
  return { x: TILE_W * (q + r / 2), y: ROW_STEP * r };
}

/** Continuous board coordinates -> nearest hex cell. */
export function fromPixel(x, y) {
  const r = y / ROW_STEP;
  const q = x / TILE_W - r / 2;
  return roundHex(q, r);
}

export function roundHex(qf, rf) {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 }; // + 0 turns -0 into 0
}

/**
 * Rotate a cell around the board centre by an angle (radians) and snap it to
 * the grid. Multiples of 60° are exact on a hex grid; other angles snap.
 */
export function rotateCell(cell, angle) {
  // Use true-geometry coordinates (sqrt3 spacing) for the rotation.
  const x = Math.sqrt(3) * (cell.q + cell.r / 2);
  const y = 1.5 * cell.r;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rx = x * c - y * s;
  const ry = x * s + y * c;
  const r = ry / 1.5;
  const q = rx / Math.sqrt(3) - r / 2;
  return roundHex(q + 1e-9, r + 1e-9);
}

/** Cell at a polar position (distance in hex steps) from the centre. */
export function polarCell(angle, dist) {
  const x = Math.cos(angle) * dist * Math.sqrt(3);
  const y = Math.sin(angle) * dist * Math.sqrt(3);
  const r = y / 1.5;
  const q = x / Math.sqrt(3) - r / 2;
  return roundHex(q, r);
}
