'use strict';

// UI: responsive DOM shell, focus, settings, overlays, accessibility mirror.
const rules = require('./rules');
const render = require('./render');
const audio = require('./audio');

let canvasEl = null;
let hudScoreEl = null;
let hudMovesEl = null;
let statusEl = null;
let overlayEl = null;
let btnUp, btnDown, btnLeft, btnRight, btnPause, btnHelp;

function init() {
	canvasEl = document.getElementById('game-canvas');
	hudScoreEl = document.getElementById('hud-score');
	hudMovesEl = document.getElementById('hud-moves');
	statusEl = document.getElementById('status-line');
	overlayEl = document.getElementById('overlay');
	btnUp = document.getElementById('btn-up');
	btnDown = document.getElementById('btn-down');
	btnLeft = document.getElementById('btn-left');
	btnRight = document.getElementById('btn-right');
	btnPause = document.getElementById('btn-pause');
	btnHelp = document.getElementById('btn-help');

	render.init(canvasEl);
}

function showStatus(text) { if (statusEl) statusEl.textContent = text; }

// Attempt a roll in direction d. Returns true if legal.
function tryDirection(d) {
	const before = rules.serialize(stateRef());
	if (!rules.tryRoll(stateRef(), d)) return false;
	afterChange(before);
	return true;
}

let _state = null;
function stateRef() { return _state; }
function setState(s) { _state = s; }

function afterChange(beforeJson) {
	const s = _state;
	hudScoreEl.textContent = String(rules.remaining(s));
	hudMovesEl.textContent = String(s.moves);
	if (s.won) {
		showStatus('Complete!');
		audio.playEvent('win');
	} else if (beforeJson !== rules.serialize(s)) {
		audio.playEvent('move');
	}
	render.update(s);
}

function onKey(e) {
	const k = e.key;
	if (k === 'ArrowUp' || k === 'w') { tryDirection(0); }
	else if (k === 'ArrowRight' || k === 'd') { tryDirection(1); }
	else if (k === 'ArrowDown' || k === 's') { tryDirection(2); }
	else if (k === 'ArrowLeft' || k === 'a') { tryDirection(3); }
}

function onPointer(e) {
	const t = e.target;
	if (!t) return;
	if (t.id === 'btn-up') tryDirection(0);
	else if (t.id === 'btn-down') tryDirection(2);
	else if (t.id === 'btn-left') tryDirection(3);
	else if (t.id === 'btn-right') tryDirection(1);
}

function onResize() { render.resize(window.innerWidth, window.innerHeight); }

module.exports = { init, showStatus, tryDirection, stateRef, setState, afterChange, onKey, onPointer, onResize };
