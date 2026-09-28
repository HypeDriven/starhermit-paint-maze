'use strict';

// Graphics quality model: presets, per-category overrides, GPU detection and a
// cost summary. Pure (no three.js), so the settings panel and the renderer
// agree on what a setting means.

const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category -> allowed tiers, cheapest first.
const CATEGORIES = {
	shadows: ['off', 'low', 'medium', 'high'],
	ao: ['off', 'on', 'high'],
	bloom: ['off', 'on'],
	grade: ['off', 'on'],
	antialias: ['fxaa', 'smaa', 'msaa'],
	reflections: ['off', 'on'],
	detail: ['plain', 'detailed'],
	particles: ['off', 'low', 'high'],
	motion: ['off', 'on']
};

// Each preset is a row of tiers, a render scale (multiplies the capped device
// pixel ratio) and the device-pixel-ratio cap itself.
const TABLE = {
	low: { scale: 1, dprCap: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', detail: 'plain', particles: 'off', motion: 'off' },
	balanced: { scale: 1, dprCap: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', detail: 'detailed', particles: 'low', motion: 'on' },
	high: { scale: 1, dprCap: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', detail: 'detailed', particles: 'high', motion: 'on' },
	ultra: { scale: 1.25, dprCap: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', detail: 'detailed', particles: 'high', motion: 'on' }
};

const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

/** Best preset for this GPU, from the unmasked renderer string when exposed. */
function detectPreset(gpu, mobile) {
	const g = String(gpu || '').toLowerCase();
	let p = 'balanced';
	if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
	else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?! graphics)|apple m\d/.test(g)) p = 'high';
	// Touch/mobile devices cap Auto at Balanced.
	if (mobile && p === 'high') p = 'balanced';
	return p;
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
function resolve(saved, detected) {
	const s = saved || {};
	const auto = !PRESETS.includes(s.preset);
	const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
	const row = TABLE[preset];
	const renderScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
	const out = { preset, auto, renderScale, scale: row.scale * renderScale, dprCap: row.dprCap };
	for (const cat of Object.keys(CATEGORIES)) {
		out[cat] = CATEGORIES[cat].includes(s[cat]) ? s[cat] : row[cat];
	}
	out.adaptive = s.adaptive !== false;
	out.showFps = !!s.show_fps;
	// Post-processing runs only when something needs it; otherwise canvas MSAA is used.
	out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on'
		|| out.antialias === 'fxaa' || out.antialias === 'smaa';
	return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
function presetTier(preset, cat) {
	return TABLE[preset] ? TABLE[preset][cat] : undefined;
}

/** Saved settings after choosing a preset: overrides are cleared. */
function choosePreset(saved, preset) {
	const s = saved || {};
	const out = { preset: PRESETS.includes(preset) ? preset : 'auto' };
	for (const k of ['render_scale', 'adaptive', 'show_fps']) if (k in s) out[k] = s[k];
	return out;
}

/** Short cost summary; `t` optionally translates the fixed words. */
function describe(r, pixels, t) {
	const tr = t || ((k) => DESCRIBE_EN[k]);
	const parts = [
		r.shadows === 'off' ? tr('noShadows') : `${SHADOW_MAP[r.shadows]}² ${tr('shadows')}`,
		r.ao === 'off' ? null : r.ao === 'high' ? tr('fullAo') : tr('ao'),
		r.bloom === 'on' ? tr('bloom') : null,
		r.reflections === 'on' ? tr('reflections') : null,
		r.antialias.toUpperCase(),
		pixels ? `${pixels[0]}×${pixels[1]} px` : null
	];
	return parts.filter(Boolean).join(' · ');
}

const DESCRIBE_EN = {
	noShadows: 'no shadows', shadows: 'shadows', fullAo: 'full ambient occlusion',
	ao: 'ambient occlusion', bloom: 'bloom', reflections: 'reflections'
};

module.exports = { PRESETS, CATEGORIES, TABLE, SHADOW_MAP, detectPreset, resolve, presetTier, choosePreset, describe };
