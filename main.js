'use strict';

// Entry point: exposes the boot hook the page calls and a small inspection API
// (used by the dev end-to-end test and by anyone debugging in the console).
const rules = require('./rules');
const ui = require('./ui');

const api = {
	start: () => ui.start(),
	rules,
	state: () => ui.stateRef(),
	hint: () => {
		const s = ui.stateRef();
		return s ? rules.bestMove(s) : null;
	}
};

if (typeof window !== 'undefined') {
	window.__paintMaze = api;
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', api.start, { once: true });
	} else {
		api.start();
	}
}

module.exports = api;
