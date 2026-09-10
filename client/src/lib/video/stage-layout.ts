// Best-fit tiling for the video stage.
//
// The stage FILLS the window rather than sitting in a fixed-width 16:9 box, so
// the grid can't be a hardcoded column count: with `grid-cols-4` a one-on-one
// call drew a ~240px thumbnail in the middle of an empty page — which is what a
// low-vision user perceives as "a small square with bands above and below it".
//
// Instead, for every possible column count we work out how big a 16:9 tile
// would be in the space actually available and keep the biggest. Two people on
// a wide screen therefore get half the window each; four get a quarter.
export const TILE_ASPECT = 16 / 9;

export interface StageGrid {
  cols: number;
  rows: number;
}

// Ties (two layouts giving the same tile size) go to the one with fewer rows —
// side by side rather than stacked, which is what people expect from a call.
const EPSILON = 0.5;

function tileCount(count: number): number {
  return Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1;
}

// Layout with no measurement to go on (first render, or no ResizeObserver):
// the squarest grid, same rule the server-side recording mixer uses.
export function fallbackGrid(count: number): StageGrid {
  const n = tileCount(count);
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

export function bestGrid(
  count: number,
  width: number,
  height: number,
  aspect: number = TILE_ASPECT,
): StageGrid {
  const n = tileCount(count);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return fallbackGrid(n);
  }
  let best: StageGrid = { cols: 1, rows: n };
  let bestWidth = -1;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    // How wide a 16:9 tile fits in one cell — height-bound on a short stage,
    // width-bound on a tall one.
    const tileWidth = Math.min(width / cols, (height / rows) * aspect);
    const bigger = tileWidth > bestWidth + EPSILON;
    const sameButWider = Math.abs(tileWidth - bestWidth) <= EPSILON && rows < best.rows;
    if (bigger || sameButWider) {
      best = { cols, rows };
      bestWidth = tileWidth;
    }
  }
  return best;
}
