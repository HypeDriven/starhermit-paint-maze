'use strict';

// Content: versioned level data, themes, tutorials.
const CONTENT_VERSION = 1;

const THEMES = ['default', 'dawn', 'dusk', 'forest', 'ocean'];

function themeIndex(seedStr) {
	const n = require('./rules').hashString(String(seedStr));
	return THEMES[n % THEMES.length];
}

module.exports = { CONTENT_VERSION, THEMES, themeIndex };
