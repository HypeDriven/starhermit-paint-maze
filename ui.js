'use strict';

// UI: responsive DOM shell, input, persistence, overlays, accessibility mirror.
const rules = require('./rules');
const render = require('./render');
const audio = require('./audio');

const SAVE_KEY = 'paint-maze:v1:save';
const BEST_KEY = 'paint-maze:v1:best';
const UNDO_LIMIT = 200;
const DIR_NAME = ['up', 'right', 'down', 'left'];

let el = {};
let _state = null;
let history = [];
let started = false;

function $(id) { return document.getElementById(id); }

function store(key, value) {
	try { window.localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
}
function load(key) {
	try { return window.localStorage.getItem(key); } catch (e) { return null; }
}

function bestScores() {
	try { return JSON.parse(load(BEST_KEY) || '{}') || {}; } catch (e) { return {}; }
}

function bestFor(seed) {
	const v = bestScores()[seed];
	return Number.isFinite(v) ? v : null;
}

function recordBest(state) {
	const scores = bestScores();
	const prev = scores[state.seedStr];
	if (!Number.isFinite(prev) || state.moves < prev) {
		scores[state.seedStr] = state.moves;
		store(BEST_KEY, JSON.stringify(scores));
	}
}

function init() {
	el = {
		canvas: $('game-canvas'),
		score: $('hud-score'),
		moves: $('hud-moves'),
		par: $('hud-par'),
		best: $('hud-best'),
		status: $('status-line'),
		board: $('board-description'),
		overlay: $('overlay'),
		overlayTitle: $('overlay-title'),
		overlayBody: $('overlay-body'),
		up: $('btn-up'), down: $('btn-down'), left: $('btn-left'), right: $('btn-right'),
		undo: $('btn-undo'), hint: $('btn-hint'), restart: $('btn-restart'),
		next: $('btn-new'), overlayNext: $('btn-overlay-next'),
		help: $('how-to-play')
	};
	const ok = render.init(el.canvas);
	if (!ok) showStatus('Graphics could not start on this device.');
	return ok;
}

function showStatus(text) { if (el.status) el.status.textContent = text; }

// The rules panel starts open so a first-time player sees them before the
// board; once they have rolled (now or in a restored save) it folds away.
function collapseHelp() { if (el.help) el.help.open = false; }

function stateRef() { return _state; }
function setState(s) { _state = s; history = []; }

function randomSeed() {
	return 'pm-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
}

function startGame(seedStr) {
	setState(rules.newGame(seedStr));
	persist();
	render.update(_state);
	refresh();
	hideOverlay();
	showStatus('Roll the paint ball to cover every open floor tile.');
}

function persist() {
	if (_state) store(SAVE_KEY, rules.serialize(_state));
}

function restore() {
	const saved = rules.deserialize(load(SAVE_KEY));
	if (!saved) return false;
	setState(saved);
	return true;
}

// One line of text describing the board for screen readers and for players who
// cannot read the canvas.
function describeBoard() {
	const s = _state;
	if (!s) return '';
	const size = s.size;
	const x = s.ballIdx % size, y = (s.ballIdx - x) / size;
	const dirs = rules.legalDirs(s, s.ballIdx).map(d => DIR_NAME[d]);
	return `Roller at column ${x + 1}, row ${y + 1}. `
		+ `${rules.painted(s)} of ${s.goal} tiles painted. `
		+ `Rolls available: ${dirs.length ? dirs.join(', ') : 'none'}.`;
}

function refresh() {
	const s = _state;
	if (!s) return;
	if (el.score) el.score.textContent = String(rules.remaining(s));
	if (el.moves) el.moves.textContent = String(s.moves);
	if (el.par) el.par.textContent = s.par === null || s.par === undefined ? '—' : String(s.par);
	const best = bestFor(s.seedStr);
	if (el.best) el.best.textContent = best === null ? '—' : String(best);
	if (el.board) el.board.textContent = describeBoard();
	if (el.undo) el.undo.disabled = history.length === 0;
	for (let d = 0; d < 4; d++) {
		const btn = [el.up, el.right, el.down, el.left][d];
		if (!btn) continue;
		const legal = !s.won && !rules.hasWall(s.cells, s.ballIdx, d);
		btn.disabled = !legal;
		btn.setAttribute('aria-disabled', String(!legal));
	}
	if (el.hint) el.hint.disabled = s.won;
}

function showOverlay(title, body) {
	if (!el.overlay) return;
	if (el.overlayTitle) el.overlayTitle.textContent = title;
	if (el.overlayBody) el.overlayBody.textContent = body;
	el.overlay.hidden = false;
	if (el.overlayNext) el.overlayNext.focus();
}

function hideOverlay() { if (el.overlay) el.overlay.hidden = true; }

function onWin() {
	const s = _state;
	recordBest(s);
	const par = s.par;
	const verdict = par === null || par === undefined ? ''
		: s.moves <= par ? ' That beats par!' : ` Par is ${par}.`;
	showStatus('Complete!');
	showOverlay('Maze painted!', `${s.goal} tiles in ${s.moves} moves.${verdict}`);
	audio.playEvent('win');
	refresh(); // pick up the freshly recorded best score
}

// Attempt a roll in direction d. Returns true if it was legal.
function tryDirection(d) {
	const s = _state;
	if (!s || s.won) return false;
	if (rules.hasWall(s.cells, s.ballIdx, d)) {
		showStatus(`A wall blocks the roll ${DIR_NAME[d]}.`);
		return false;
	}
	const snapshot = rules.serialize(s);
	const before = rules.painted(s);
	if (!rules.tryRoll(s, d)) return false;
	history.push(snapshot);
	if (history.length > UNDO_LIMIT) history.shift();
	collapseHelp();
	const gained = rules.painted(s) - before;
	persist();
	render.update(s);
	refresh();
	if (s.won) {
		onWin();
	} else {
		showStatus(`Rolled ${DIR_NAME[d]}, painted ${gained} tile${gained === 1 ? '' : 's'}. `
			+ `${rules.remaining(s)} left.`);
		audio.playEvent('move');
	}
	return true;
}

function undo() {
	if (history.length === 0) return false;
	const prev = rules.deserialize(history.pop());
	if (!prev) return false;
	_state = prev;
	persist();
	hideOverlay();
	render.update(_state);
	refresh();
	showStatus('Undid the last roll.');
	return true;
}

function restart() {
	if (!_state) return;
	startGame(_state.seedStr);
	showStatus('Maze reset.');
}

function newMaze() {
	startGame(randomSeed());
	showStatus('New maze.');
}

function hint() {
	const s = _state;
	if (!s || s.won) return null;
	const d = rules.bestMove(s);
	if (d === null) return null;
	showStatus(`Hint: try rolling ${DIR_NAME[d]}.`);
	const btn = [el.up, el.right, el.down, el.left][d];
	if (btn) {
		btn.classList.add('hinted');
		setTimeout(() => btn.classList.remove('hinted'), 1200);
	}
	return d;
}

function onKey(e) {
	if (e.metaKey || e.ctrlKey || e.altKey) return;
	const k = e.key;
	let handled = true;
	if (k === 'ArrowUp' || k === 'w' || k === 'W') tryDirection(0);
	else if (k === 'ArrowRight' || k === 'd' || k === 'D') tryDirection(1);
	else if (k === 'ArrowDown' || k === 's' || k === 'S') tryDirection(2);
	else if (k === 'ArrowLeft' || k === 'a' || k === 'A') tryDirection(3);
	else if (k === 'u' || k === 'U' || (k === 'z' && !e.shiftKey)) undo();
	else if (k === 'r' || k === 'R') restart();
	else if (k === 'h' || k === 'H') hint();
	else if (k === 'Escape') hideOverlay();
	else handled = false;
	if (handled) e.preventDefault();
}

// Swipe support on the board: direction comes from the dominant axis.
const SWIPE_MIN = 24;
let touchStart = null;

function onPointerDown(e) {
	touchStart = { x: e.clientX, y: e.clientY };
	if (e.pointerId !== undefined && el.canvas.setPointerCapture) {
		try { el.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
	}
}

function onPointerUp(e) {
	if (!touchStart) return;
	const dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
	touchStart = null;
	if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
	if (Math.abs(dx) > Math.abs(dy)) tryDirection(dx > 0 ? 1 : 3);
	else tryDirection(dy > 0 ? 2 : 0);
}

function onPointerCancel() { touchStart = null; }

function onResize() { render.resize(); }

function bind() {
	const press = (node, fn) => {
		if (!node) return;
		node.addEventListener('click', (e) => { e.preventDefault(); fn(); });
	};
	press(el.up, () => tryDirection(0));
	press(el.right, () => tryDirection(1));
	press(el.down, () => tryDirection(2));
	press(el.left, () => tryDirection(3));
	press(el.undo, undo);
	press(el.hint, hint);
	press(el.restart, restart);
	press(el.next, newMaze);
	press(el.overlayNext, newMaze);
	window.addEventListener('keydown', onKey);
	window.addEventListener('resize', onResize);
	window.addEventListener('orientationchange', onResize);
	if (el.canvas) {
		el.canvas.addEventListener('pointerdown', onPointerDown);
		el.canvas.addEventListener('pointerup', onPointerUp);
		el.canvas.addEventListener('pointercancel', onPointerCancel);
	}
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) render.stop(); else render.start();
	});
}

// Boot: restore a save if one is present, otherwise start a fresh maze.
function start() {
	if (started) return;
	started = true;
	init();
	bind();
	if (restore()) {
		if (_state.moves > 0 || _state.won) collapseHelp();
		render.update(_state);
		refresh();
		showStatus(_state.won ? 'Maze already complete — start a new one.' : 'Resumed your saved maze.');
		if (_state.won) showOverlay('Maze painted!', `${_state.goal} tiles in ${_state.moves} moves.`);
	} else {
		startGame(randomSeed());
	}
	render.resize();
	render.start();
}

module.exports = {
	init, bind, start, showStatus, tryDirection, undo, restart, newMaze, hint,
	stateRef, setState, refresh, describeBoard, onKey, onResize
};
