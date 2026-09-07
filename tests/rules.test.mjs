/**
 * Paint Maze — rules engine tests (dev only, not shipped).
 * Pure Node, no dependencies: node tests/rules.test.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = require(path.join(ROOT, 'rules.js'));

let failures = 0;
const check = (name, fn) => {
	try {
		fn();
		console.log(`ok - ${name}`);
	} catch (e) {
		failures++;
		console.error(`FAIL - ${name}: ${e.message}`);
	}
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const SEEDS = Array.from({ length: 25 }, (_, i) => `test-seed-${i}`);

check('levels are deterministic for a seed', () => {
	const a = rules.newGame('same-seed');
	const b = rules.newGame('same-seed');
	assert(rules.serialize(a) === rules.serialize(b), 'two builds of one seed differ');
	const c = rules.newGame('other-seed');
	assert(rules.serialize(a) !== rules.serialize(c), 'different seeds produced identical levels');
});

check('walls are symmetric and the border is closed', () => {
	for (const seed of SEEDS) {
		const s = rules.newGame(seed);
		for (let i = 0; i < s.size * s.size; i++) {
			const x = i % s.size, y = (i - x) / s.size;
			for (let d = 0; d < 4; d++) {
				const nx = x + rules.DIRS[d].dx, ny = y + rules.DIRS[d].dy;
				if (nx < 0 || ny < 0 || nx >= s.size || ny >= s.size) {
					assert(rules.hasWall(s.cells, i, d), `${seed}: open border at ${x},${y} dir ${d}`);
				} else {
					const j = ny * s.size + nx;
					assert(rules.hasWall(s.cells, i, d) === rules.hasWall(s.cells, j, rules.opposite(d)),
						`${seed}: asymmetric wall at ${x},${y} dir ${d}`);
				}
			}
		}
	}
});

check('rolls stop at a wall and paint the whole corridor', () => {
	const s = rules.newGame('roll-seed');
	const d = rules.legalDirs(s, s.ballIdx)[0];
	const path = rules.cellsAlong(s, s.ballIdx, d);
	assert(path.length >= 2, 'a legal roll moved nowhere');
	rules.tryRoll(s, d);
	assert(s.ballIdx === path[path.length - 1], 'roller did not stop at the corridor end');
	for (const i of path) assert(rules.isPainted(s, i), 'a traversed cell was left unpainted');
	assert(rules.hasWall(s.cells, s.ballIdx, d), 'roller stopped without a wall ahead');
	assert(s.moves === 1 && s.turns === 1, 'move/turn counters did not advance');
});

check('illegal rolls are rejected and change nothing', () => {
	const s = rules.newGame('illegal-seed');
	const blocked = [0, 1, 2, 3].filter((d) => rules.hasWall(s.cells, s.ballIdx, d));
	const before = rules.serialize(s);
	for (const d of blocked) assert(rules.tryRoll(s, d) === null, 'a walled roll was accepted');
	assert(rules.serialize(s) === before, 'a rejected roll mutated the state');
});

check('every generated level is completable and free of soft locks', () => {
	for (const seed of SEEDS) {
		const s = rules.newGame(seed);
		assert(s.goal >= 0.8 * s.size * s.size, `${seed}: only ${s.goal} of ${s.size * s.size} tiles paintable`);
		assert(Number.isFinite(s.par), `${seed}: no reference solution found`);
		// Wander randomly first, then finish: proves no reachable position strands
		// the player (soft lock) regardless of how badly they played.
		const rand = rules.mulberry32(rules.hashString(seed));
		for (let i = 0; i < 40 && !s.won; i++) {
			const dirs = rules.legalDirs(s, s.ballIdx);
			rules.tryRoll(s, dirs[Math.floor(rand() * dirs.length)]);
		}
		let guard = 0;
		while (!s.won && guard++ < s.size * s.size * 6) rules.tryRoll(s, rules.bestMove(s));
		assert(s.won, `${seed}: could not finish after random play (remaining ${rules.remaining(s)})`);
		assert(rules.remaining(s) === 0, `${seed}: won with ${rules.remaining(s)} tiles unpainted`);
		assert(s.winReason === 'complete', `${seed}: unexpected win reason ${s.winReason}`);
	}
});

check('rolls after the win are refused', () => {
	const s = rules.newGame('win-seed');
	let guard = 0;
	while (!s.won && guard++ < 2000) rules.tryRoll(s, rules.bestMove(s));
	assert(s.won, 'solver failed to win');
	const before = rules.serialize(s);
	for (let d = 0; d < 4; d++) assert(rules.tryRoll(s, d) === null, 'a roll was accepted after the win');
	assert(rules.serialize(s) === before, 'state changed after the win');
});

check('save/load round-trips and rejects corrupt payloads', () => {
	const s = rules.newGame('save-seed');
	rules.tryRoll(s, rules.bestMove(s));
	rules.tryRoll(s, rules.bestMove(s));
	const json = rules.serialize(s);
	const back = rules.deserialize(json);
	assert(back !== null && rules.serialize(back) === json, 'round-trip lost state');
	assert(rules.deserialize('not json') === null, 'garbage accepted');
	assert(rules.deserialize(JSON.stringify({ schema: 999 })) === null, 'wrong schema accepted');
	const truncated = JSON.parse(json);
	truncated.painted = truncated.painted.slice(0, 5);
	assert(rules.deserialize(JSON.stringify(truncated)) === null, 'truncated save accepted');
	const oob = JSON.parse(json);
	oob.ballIdx = 99999;
	assert(rules.deserialize(JSON.stringify(oob)) === null, 'out-of-range roller accepted');
	const openBorder = JSON.parse(json);
	openBorder.cells[0] &= ~1;
	assert(rules.deserialize(openBorder) === null, 'open outer border accepted');
	const fractional = JSON.parse(json);
	fractional.ballIdx = 2.5;
	assert(rules.deserialize(fractional) === null, 'fractional roller position accepted');
	const asymmetric = JSON.parse(json);
	asymmetric.cells[0] ^= 2;
	assert(rules.deserialize(asymmetric) === null, 'asymmetric wall accepted');
});

check('hints always suggest a legal roll that leads to progress', () => {
	for (const seed of SEEDS.slice(0, 8)) {
		const s = rules.newGame(seed);
		let guard = 0;
		while (!s.won && guard++ < s.size * s.size * 6) {
			const d = rules.bestMove(s);
			assert(d !== null, `${seed}: no hint offered mid-game`);
			assert(!rules.hasWall(s.cells, s.ballIdx, d), `${seed}: hint pointed into a wall`);
			rules.tryRoll(s, d);
		}
		assert(s.won, `${seed}: following hints did not finish the maze`);
		assert(rules.bestMove(s) === null, `${seed}: hint offered after the win`);
	}
});

console.log(failures === 0 ? '\nRULES PASS' : `\nRULES FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
