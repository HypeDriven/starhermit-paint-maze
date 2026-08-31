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

// Build a level from its seed.
function buildLevel(seedStr) {
	const n = hashString(seedStr);
	const rand = mulberry32(n);
	// 15x15 grid, walls on all edges initially then randomized (perfect maze via DFS).
	const size = 15;
	const cells = new Array(size * size);
	for (let i = 0; i < size * size; i++) {
		cells[i] = 0b1111; // up,right,down,left all walled
	}
	const visited = new Uint8Array(size * size);
	let stack = [size / 2 | 0]; // start center (7)
	visited[7] = 1;
	while (stack.length > 0) {
		const cur = stack[stack.length - 1];
		const cx = cur % size, cy = (cur - cx) / size;
		let options = [];
		for (let d = 0; d < 4; d++) {
			const nx = cx + DIRS[d].dx, ny = cy + DIRS[d].dy;
			if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
				const ni = ny * size + nx;
				if (!visited[ni]) options.push(d);
			}
		}
		if (options.length === 0) { stack.pop(); continue; }
		const d = options[Math.floor(rand() * options.length)];
		const nx = cx + DIRS[d].dx, ny = cy + DIRS[d].dy;
		cells[cur] &= ~(1 << d);
		cells[ny * size + nx] &= ~(1 << opposite(d));
		visited[ny * size + nx] = 1;
		stack.push(ny * size + nx);
	}
	return { seed: n, size, cells };
}

function hasWall(cells, idx, d) { return ((cells[idx]) & (1 << d)) !== 0; }

// Legal directions to roll from a cell.
function legalDirs(level, idx) {
	const out = [];
	for (let d = 0; d < 4; d++) if (!hasWall(level, idx, d)) out.push(d);
	return out;
}

// Where the ball stops after rolling in direction d from startIdx.
function rollStop(level, startIdx, d) {
	const size = level.size;
	let cx = startIdx % size, cy = (startIdx - cx) / size;
	while (!hasWall(level, cy * size + cx, d)) {
		cx += DIRS[d].dx; cy += DIRS[d].dy;
	}
	return cy * size + cx;
}

// A game state.
function newGame(seedStr) {
	const level = buildLevel(seedStr);
	return {
		schema: SCHEMA_VERSION,
		levelSeed: level.seed,
		size: level.size,
		cells: level.cells.slice(),
		ballIdx: 7,
		painted: new Uint8Array(level.size * level.size), // 0 uncolored,1 colored
		moves: 0,
		turns: 0,
		won: false,
		winReason: null
	};
}

function isPainted(state, idx) { return state.painted[idx] !== 0; }

// Count of uncolored cells.
function remaining(state) {
	let c = 0;
	for (let i = 0; i < state.size * state.size; i++) if (!state.painted[i]) c++;
	return c;
}

// Attempt to roll in direction d. Returns new state or null if illegal.
function tryRoll(state, d) {
	if (hasWall(state.cells, state.ballIdx, d)) return null;
	const stop = rollStop({ size: state.size, cells: state.cells }, state.ballIdx, d);
	// paint every cell traversed including start and stop
	let cx = state.ballIdx % state.size, cy = (state.ballIdx - cx) / state.size;
	state.painted[state.ballIdx] = 1;
	while (!(cx === stop % state.size && cy === ((stop - (stop % state.size)) / state.size))) {
		cx += DIRS[d].dx; cy += DIRS[d].dy;
		const ni = cy * state.size + cx;
		state.painted[ni] = 1;
	}
	state.ballIdx = stop;
	state.moves++;
	state.turns++;
	if (remaining(state) === 0) { state.won = true; state.winReason = 'complete'; }
	return state;
}

function serialize(state) { return JSON.stringify(state); }

module.exports = {
	SCHEMA_VERSION, mulberry32, hashString, DIRS, opposite, buildLevel, hasWall, legalDirs, rollStop, newGame, isPainted, remaining, tryRoll, serialize
};
