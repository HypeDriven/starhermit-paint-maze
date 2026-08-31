'use strict';

// Audio: Web Audio API buses, event mapping, authored sample playback.
let ctx = null;
const busGain = {};

// Authored one-shot samples (see sfx/manifest.json) backing existing events.
const EVENT_SFX = {
	move: ['ball-roll', 'ball-stop', 'paint-swipe', 'paint-splatter', 'roller-slide', 'marble-whoosh', 'wall-bump', 'wet-trail'],
	win: ['win-chime', 'victory-fanfare', 'level-complete', 'paint-finale']
};
const buffers = {}; // name -> AudioBuffer once decoded
const pending = {}; // name -> in-flight decode Promise
const failed = {};  // name -> true after fetch/decode failure
let rotation = 0;

function ensureCtx() {
	if (!ctx) {
		ctx = new (window.AudioContext || window.webkitAudioContext)();
	}
	return ctx;
}

// Effects bus: every event sound routes through here.
function fxBus(c) {
	if (!busGain.fx) {
		busGain.fx = c.createGain();
		busGain.fx.gain.value = 0.3;
		busGain.fx.connect(c.destination);
	}
	return busGain.fx;
}

// Lazy-fetch and decode sfx/<name>.opus; cache buffer, promise, or failure.
function loadSample(c, name) {
	if (buffers[name] || failed[name]) return;
	if (!pending[name]) {
		pending[name] = fetch('sfx/' + name + '.opus')
			.then(res => {
				if (!res.ok) throw new Error('sfx fetch failed: ' + name);
				return res.arrayBuffer();
			})
			.then(data => c.decodeAudioData(data))
			.then(buf => { buffers[name] = buf; })
			.catch(() => { failed[name] = true; });
	}
}

// Play a decoded sample through the effects bus. Returns false if unavailable.
function playSample(c, name) {
	const buf = buffers[name];
	if (!buf) return false;
	const src = c.createBufferSource();
	src.buffer = buf;
	src.connect(fxBus(c));
	src.start();
	return true;
}

// Procedural fallback, used while a sample is loading or after failure.
function synthesize(c, name) {
	const osc = c.createOscillator();
	osc.type = 'sine';
	osc.frequency.value = name === 'win' ? 880 : name === 'move' ? 440 : 660;
	osc.connect(fxBus(c));
	osc.start(c.currentTime);
	osc.stop(c.currentTime + 0.15);
}

function playEvent(name) {
	const c = ensureCtx();
	const names = EVENT_SFX[name];
	if (names) {
		names.forEach(n => loadSample(c, n));
		const chosen = names[rotation++ % names.length];
		if (playSample(c, chosen)) return;
	}
	synthesize(c, name);
}

module.exports = { ensureCtx, playEvent };
