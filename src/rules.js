// Paint Maze rules: a ball rolls in a straight line until the next tile is a
// wall, painting every floor tile it passes. A level is solved when every
// floor tile is painted. Pure and deterministic; shared by the game, the
// level generator and the tests.

export const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
export const DIR_KEYS = ['U', 'D', 'L', 'R'];

/** Parses a level ({w, h, rows, start}) into a board with floor indexing. */
export function parseLevel(level) {
  const { w, h, rows } = level;
  if (rows.length !== h || rows.some((r) => r.length !== w)) throw new Error('bad level size');
  const floor = new Int16Array(w * h).fill(-1);
  const cells = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y][x] !== '#') { floor[y * w + x] = cells.length; cells.push(y * w + x); }
    }
  }
  const [sx, sy] = level.start;
  if (floor[sy * w + sx] < 0) throw new Error('start is not floor');
  return { w, h, floor, cells, start: sy * w + sx };
}

export const isFloor = (board, x, y) =>
  x >= 0 && y >= 0 && x < board.w && y < board.h && board.floor[y * board.w + x] >= 0;

/** Fresh play state: ball on the start tile, start tile painted. */
export function createState(board) {
  const painted = new Uint8Array(board.cells.length);
  painted[board.floor[board.start]] = 1;
  return { pos: board.start, painted, remaining: board.cells.length - 1, moves: 0 };
}

/** Tiles the ball would cross rolling `dir` from `pos` (excluding `pos`). */
export function rollPath(board, pos, dir) {
  const [dx, dy] = DIRS[dir];
  let x = pos % board.w, y = (pos - x) / board.w;
  const path = [];
  while (isFloor(board, x + dx, y + dy)) { x += dx; y += dy; path.push(y * board.w + x); }
  return path;
}

export const canRoll = (board, state, dir) => rollPath(board, state.pos, dir).length > 0;
export const legalDirs = (board, state) => DIR_KEYS.filter((d) => canRoll(board, state, d));

/**
 * Rolls the ball. Returns {state, path, newly} — a new state (the input is not
 * mutated), the tiles crossed and the tiles painted for the first time — or
 * null when a wall blocks that direction.
 */
export function roll(board, state, dir) {
  const path = rollPath(board, state.pos, dir);
  if (!path.length) return null;
  const painted = state.painted.slice();
  const newly = [];
  for (const c of path) {
    const i = board.floor[c];
    if (!painted[i]) { painted[i] = 1; newly.push(c); }
  }
  return {
    state: { pos: path[path.length - 1], painted, remaining: state.remaining - newly.length, moves: state.moves + 1 },
    path, newly,
  };
}

export const isComplete = (state) => state.remaining === 0;

/** Star rating for a finished level: 3 at or under par, 2 within par+2, else 1. */
export function starsFor(moves, par) {
  if (moves <= par) return 3;
  if (moves <= par + 2) return 2;
  return 1;
}

/**
 * Breadth-first search for the shortest roll sequence that paints every tile,
 * starting from `state`. Returns a string of directions ('' when already
 * complete), or null when unsolvable or when more than `cap` states were seen.
 */
export function solve(board, state, cap = 200000) {
  const n = board.cells.length;
  const full = (1n << BigInt(n)) - 1n;
  let mask0 = 0n;
  for (let i = 0; i < n; i++) if (state.painted[i]) mask0 |= 1n << BigInt(i);
  if (mask0 === full) return '';
  // Precompute (stop, mask) for every reachable resting position and direction.
  const moves = new Map();
  const movesFrom = (pos) => {
    let m = moves.get(pos);
    if (m) return m;
    m = [];
    for (const d of DIR_KEYS) {
      const path = rollPath(board, pos, d);
      if (!path.length) continue;
      let bits = 0n;
      for (const c of path) bits |= 1n << BigInt(board.floor[c]);
      m.push([d, path[path.length - 1], bits]);
    }
    moves.set(pos, m);
    return m;
  };
  const key = (pos, mask) => pos + ':' + mask.toString(36);
  const parent = new Map([[key(state.pos, mask0), null]]);
  let frontier = [[state.pos, mask0]];
  while (frontier.length) {
    const next = [];
    for (const [pos, mask] of frontier) {
      for (const [d, to, bits] of movesFrom(pos)) {
        const m2 = mask | bits;
        const k = key(to, m2);
        if (parent.has(k)) continue;
        parent.set(k, [key(pos, mask), d]);
        if (m2 === full) {
          let out = '', cur = k;
          while (parent.get(cur)) { const [p, dd] = parent.get(cur); out = dd + out; cur = p; }
          return out;
        }
        if (parent.size > cap) return null;
        next.push([to, m2]);
      }
    }
    frontier = next;
  }
  return null;
}

/** Replays a direction string from the start; returns the final state or null on an illegal roll. */
export function replay(board, dirs) {
  let s = createState(board);
  for (const d of dirs) {
    const r = roll(board, s, d);
    if (!r) return null;
    s = r.state;
  }
  return s;
}

/** Serializable snapshot of a state (for saves). */
export const snapshot = (state) => ({ pos: state.pos, painted: Array.from(state.painted), moves: state.moves });

/** Validates and restores a snapshot against a board; null when it does not fit. */
export function restore(board, snap) {
  if (!snap || !Array.isArray(snap.painted) || snap.painted.length !== board.cells.length) return null;
  if (!Number.isInteger(snap.pos) || board.floor[snap.pos] < 0 || !Number.isInteger(snap.moves) || snap.moves < 0) return null;
  const painted = Uint8Array.from(snap.painted, (v) => (v ? 1 : 0));
  if (!painted[board.floor[snap.pos]]) return null;
  let remaining = 0;
  for (const v of painted) if (!v) remaining++;
  return { pos: snap.pos, painted, remaining, moves: snap.moves };
}
