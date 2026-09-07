'use strict';

// Paint Maze — pure deterministic rules engine.
// No rendering, no I/O. Seeded random stream lives here (rules only).

const SCHEMA_VERSION = 1;

function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hashString(str) {
	let h = 5381 >>> 0;
	for (let i = 0; i < str.length; i++) {
		h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
	}
	return h >>> 0;
}

// A single level: grid of cells, each with a wall mask.
// Directions: 0=up(-y),1=right(+x),2=down(+y),3=left(-x)
const DIRS = [
	{ dx: 0, dy: -1 },
	{ dx: 1, dy: 0 },
	{ dx: 0, dy: 1 },
	{ dx: -1, dy: 0 }
];

function opposite(d) { return (d + 2) % 4; }

// The roller always starts at the centre cell of the grid.
function startIndex(size) { const c = (size - 1) / 2 | 0; return c * size + c; }

const SIZE = 13;
const MIN_COVERAGE = 0.8;   // share of the grid that must be paintable
const MAX_CANDIDATES = 400; // generation attempts before relaxing coverage

// One candidate layout: outer border walls plus random interior blockers.
function layout(size, density, rand) {
	const cells = new Array(size * size).fill(0);
	for (let i = 0; i < size * size; i++) {
		const x = i % size, y = (i - x) / size;
		for (let d = 0; d < 4; d++) {
			const nx = x + DIRS[d].dx, ny = y + DIRS[d].dy;
			if (nx < 0 || ny < 0 || nx >= size || ny >= size) cells[i] |= 1 << d;
		}
	}
	for (let i = 0; i < size * size; i++) {
		const x = i % size, y = (i - x) / size;
		for (const d of [1, 2]) { // right and down only: each edge considered once
			const nx = x + DIRS[d].dx, ny = y + DIRS[d].dy;
			if (nx >= size || ny >= size) continue;
			if (rand() < density) {
				cells[i] |= 1 << d;
				cells[ny * size + nx] |= 1 << opposite(d);
			}
		}
	}
	return cells;
}

// Reachable stop positions, the cells they paint, and whether every stop can
// return to the start (strong connectivity => the level can never soft lock).
function analyzeLayout(level, start) {
	const size = level.size;
	const stops = new Uint8Array(size * size);
	const mask = new Uint8Array(size * size);
	const back = new Map(); // stop -> origins, for the reverse reachability pass
	const queue = [start];
	stops[start] = 1;
	mask[start] = 1;
	while (queue.length > 0) {
		const cur = queue.pop();
		for (const d of legalDirs(level, cur)) {
			const path = cellsAlong(level, cur, d);
			for (const i of path) mask[i] = 1;
			const stop = path[path.length - 1];
			if (!back.has(stop)) back.set(stop, []);
			back.get(stop).push(cur);
			if (!stops[stop]) { stops[stop] = 1; queue.push(stop); }
		}
	}
	const reachable = new Uint8Array(size * size);
	const rq = [start];
	reachable[start] = 1;
	let backCount = 1, stopCount = 0;
	while (rq.length > 0) {
		const cur = rq.pop();
		for (const from of back.get(cur) || []) {
			if (!reachable[from]) { reachable[from] = 1; backCount++; rq.push(from); }
		}
	}
	let paintCount = 0;
	for (let i = 0; i < size * size; i++) { if (stops[i]) stopCount++; if (mask[i]) paintCount++; }
	return { mask, paintCount, strong: backCount === stopCount };
}

// Build a level from its seed. Candidates are rejected until one is both
// soft-lock free and covers most of the grid, so play is always completable.
function buildLevel(seedStr) {
	const n = hashString(seedStr);
	const rand = mulberry32(n);
	const size = SIZE;
	const start = startIndex(size);
	let best = null;
	for (let k = 0; k < MAX_CANDIDATES; k++) {
		const density = 0.12 + (k % 7) * 0.02;
		const cells = layout(size, density, rand);
		const level = { seed: n, size, cells };
		const info = analyzeLayout(level, start);
		if (!info.strong) continue;
		level.paintable = info.mask;
		if (info.paintCount / (size * size) >= MIN_COVERAGE) return level;
		if (!best || info.paintCount > best.count) best = { level, count: info.paintCount };
	}
	// Fallback (never hit in practice): best soft-lock-free candidate seen, else
	// a fully open room, which is trivially soft-lock free.
	if (best) return best.level;
	const cells = layout(size, 0, rand);
	const level = { seed: n, size, cells };
	level.paintable = analyzeLayout(level, start).mask;
	return level;
}

function hasWall(cells, idx, d) { return ((cells[idx]) & (1 << d)) !== 0; }

// Legal directions to roll from a cell.
function legalDirs(level, idx) {
	const out = [];
	for (let d = 0; d < 4; d++) if (!hasWall(level.cells, idx, d)) out.push(d);
	return out;
}

// Where the ball stops after rolling in direction d from startIdx.
function rollStop(level, startIdx, d) {
	const size = level.size;
	let cx = startIdx % size, cy = (startIdx - cx) / size;
	while (!hasWall(level.cells, cy * size + cx, d)) {
		cx += DIRS[d].dx; cy += DIRS[d].dy;
	}
	return cy * size + cx;
}

// Every cell index traversed rolling from startIdx in direction d, start included.
function cellsAlong(level, startIdx, d) {
	const size = level.size;
	const stop = rollStop(level, startIdx, d);
	const out = [startIdx];
	let cur = startIdx;
	while (cur !== stop) {
		cur += DIRS[d].dy * size + DIRS[d].dx;
		out.push(cur);
	}
	return out;
}

// A game state.
function newGame(seedStr) {
	const level = buildLevel(seedStr);
	const start = startIndex(level.size);
	const painted = new Uint8Array(level.size * level.size); // 0 uncolored,1 colored
	painted[start] = 1;
	const state = {
		schema: SCHEMA_VERSION,
		seedStr: String(seedStr),
		levelSeed: level.seed,
		size: level.size,
		cells: level.cells.slice(),
		startIdx: start,
		ballIdx: start,
		painted,
		paintable: level.paintable.slice(),
		moves: 0,
		turns: 0,
		won: false,
		winReason: null
	};
	state.goal = countPaintable(state);
	state.par = solvePar(state);
	return state;
}

function cloneState(state) {
	return Object.assign({}, state, {
		cells: state.cells.slice(),
		painted: state.painted.slice(),
		paintable: state.paintable.slice()
	});
}

// Newly painted cells if the roller went in direction d from here.
function gainOf(state, d) {
	const path = cellsAlong(state, state.ballIdx, d);
	let g = 0;
	for (const i of path) if (!state.painted[i]) g++;
	return g;
}

// Suggested direction: the roll that paints most, otherwise the first step of
// the shortest route to a roll that does. Used for hints and for par.
function bestMove(state) {
	if (state.won) return null;
	const dirs = legalDirs(state, state.ballIdx);
	if (dirs.length === 0) return null;
	let bestD = null, bestG = 0;
	for (const d of dirs) {
		const g = gainOf(state, d);
		if (g > bestG) { bestG = g; bestD = d; }
	}
	if (bestD !== null) return bestD;
	// Nothing gains here: breadth-first over stop positions for the closest one
	// that does, and return the first direction along that route.
	const seen = new Uint8Array(state.size * state.size);
	seen[state.ballIdx] = 1;
	let frontier = dirs.map(d => ({ first: d, at: rollStop(state, state.ballIdx, d) }));
	for (const f of frontier) seen[f.at] = 1;
	for (let depth = 0; depth < state.size * state.size && frontier.length > 0; depth++) {
		const next = [];
		for (const f of frontier) {
			for (const d of legalDirs(state, f.at)) {
				const path = cellsAlong(state, f.at, d);
				for (const i of path) if (!state.painted[i]) return f.first;
				const stop = path[path.length - 1];
				if (!seen[stop]) { seen[stop] = 1; next.push({ first: f.first, at: stop }); }
			}
		}
		frontier = next;
	}
	return dirs[0];
}

// Reference solution length used as par. Null if the solver could not finish.
function solvePar(state) {
	const sim = cloneState(state);
	const cap = state.size * state.size * 4;
	while (!sim.won && sim.moves < cap) {
		const d = bestMove(sim);
		if (d === null || !tryRoll(sim, d)) break;
	}
	return sim.won ? sim.moves : null;
}

function isPainted(state, idx) { return state.painted[idx] !== 0; }
function isPaintable(state, idx) { return state.paintable[idx] !== 0; }

function countPaintable(state) {
	let c = 0;
	for (let i = 0; i < state.size * state.size; i++) if (state.paintable[i]) c++;
	return c;
}

// Count of paintable cells still uncolored.
function remaining(state) {
	let c = 0;
	for (let i = 0; i < state.size * state.size; i++) if (state.paintable[i] && !state.painted[i]) c++;
	return c;
}

function painted(state) { return countPaintable(state) - remaining(state); }

// Attempt to roll in direction d. Returns the state or null if illegal.
function tryRoll(state, d) {
	if (state.won) return null;
	if (hasWall(state.cells, state.ballIdx, d)) return null;
	const path = cellsAlong({ size: state.size, cells: state.cells }, state.ballIdx, d);
	for (const i of path) state.painted[i] = 1;
	state.ballIdx = path[path.length - 1];
	state.moves++;
	state.turns++;
	if (remaining(state) === 0) { state.won = true; state.winReason = 'complete'; }
	return state;
}

function serialize(state) {
	return JSON.stringify({
		schema: state.schema,
		seedStr: state.seedStr,
		levelSeed: state.levelSeed,
		size: state.size,
		cells: Array.from(state.cells),
		startIdx: state.startIdx,
		ballIdx: state.ballIdx,
		painted: Array.from(state.painted),
		paintable: Array.from(state.paintable),
		moves: state.moves,
		turns: state.turns,
		won: state.won,
		winReason: state.winReason,
		goal: state.goal,
		par: state.par
	});
}

// Rebuild a state from serialize(). Returns null when the payload is unusable
// (wrong schema, truncated arrays, out-of-range ball) so saves never corrupt play.
function deserialize(json) {
	let o;
	try { o = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; }
	if (!o || o.schema !== SCHEMA_VERSION) return null;
	const size = o.size | 0;
	if (!Number.isInteger(o.size) || size < 1 || size > 64 || !Array.isArray(o.cells) || o.cells.length !== size * size) return null;
	if (!Array.isArray(o.painted) || o.painted.length !== size * size) return null;
	if (!Array.isArray(o.paintable) || o.paintable.length !== size * size) return null;
	if (!Number.isInteger(o.ballIdx) || !(o.ballIdx >= 0 && o.ballIdx < size * size)) return null;
	if (o.cells.some(v => !Number.isInteger(v) || v < 0 || v > 15)) return null;
	if (o.painted.some(v => v !== 0 && v !== 1) || o.paintable.some(v => v !== 0 && v !== 1)) return null;
	if (!o.paintable[o.ballIdx]) return null;
	for (let i = 0; i < size * size; i++) {
		const x = i % size, y = Math.floor(i / size);
		for (let d = 0; d < 4; d++) {
			const nx = x + DIRS[d].dx, ny = y + DIRS[d].dy;
			const wall = hasWall(o.cells, i, d);
			if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
				if (!wall) return null;
			} else if (wall !== hasWall(o.cells, ny * size + nx, opposite(d))) return null;
		}
	}
	const state = {
		schema: SCHEMA_VERSION,
		seedStr: String(o.seedStr || ''),
		levelSeed: o.levelSeed >>> 0,
		size,
		cells: o.cells.slice(),
		startIdx: o.startIdx >= 0 && o.startIdx < size * size ? o.startIdx : startIndex(size),
		ballIdx: o.ballIdx,
		painted: Uint8Array.from(o.painted),
		paintable: Uint8Array.from(o.paintable),
		moves: Math.max(0, o.moves | 0),
		turns: Math.max(0, o.turns | 0),
		won: !!o.won,
		winReason: o.winReason || null
	};
	state.goal = countPaintable(state);
	state.par = Number.isFinite(o.par) ? o.par : null;
	if (remaining(state) === 0) { state.won = true; state.winReason = state.winReason || 'complete'; }
	return state;
}

module.exports = {
	SCHEMA_VERSION, mulberry32, hashString, DIRS, opposite, startIndex, buildLevel, hasWall, legalDirs,
	rollStop, cellsAlong, newGame, cloneState, isPainted, isPaintable, countPaintable, remaining,
	painted, gainOf, bestMove, tryRoll, serialize, deserialize
};
