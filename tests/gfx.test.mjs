/**
 * Paint Maze — graphics quality model tests (dev only, not shipped).
 * node --test tests/gfx.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gfx = require(path.join(ROOT, 'gfx.js'));

test('detectPreset maps GPU strings to presets', () => {
	assert.equal(gfx.detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
	assert.equal(gfx.detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
	assert.equal(gfx.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
	assert.equal(gfx.detectPreset('Apple M2'), 'high');
	assert.equal(gfx.detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
	assert.equal(gfx.detectPreset('Adreno (TM) 650'), 'balanced');
	assert.equal(gfx.detectPreset(''), 'balanced');
	// Touch/mobile devices cap Auto at Balanced.
	assert.equal(gfx.detectPreset('Apple M2', true), 'balanced');
	assert.equal(gfx.detectPreset('SwiftShader', true), 'low');
});

test('resolve: auto follows detection, explicit preset wins', () => {
	const auto = gfx.resolve({}, 'high');
	assert.equal(auto.preset, 'high');
	assert.equal(auto.auto, true);
	assert.equal(auto.shadows, gfx.presetTier('high', 'shadows'));
	const low = gfx.resolve({ preset: 'low' }, 'high');
	assert.equal(low.preset, 'low');
	assert.equal(low.auto, false);
	assert.equal(low.post, false, 'Low renders without post-processing');
	assert.equal(low.dprCap, 1);
	assert.equal(gfx.resolve({ preset: 'bogus' }, undefined).preset, 'balanced');
});

test('resolve: per-category overrides and invalid values', () => {
	const r = gfx.resolve({ preset: 'low', bloom: 'on', shadows: 'nope' }, 'low');
	assert.equal(r.bloom, 'on');
	assert.equal(r.shadows, 'off', 'invalid tier falls back to the preset');
	assert.equal(r.post, true, 'bloom needs the post chain');
	for (const cat of Object.keys(gfx.CATEGORIES)) {
		for (const p of gfx.PRESETS) assert.ok(gfx.CATEGORIES[cat].includes(gfx.presetTier(p, cat)), `${p}.${cat}`);
	}
});

test('resolve: render scale clamps to 50–200%', () => {
	assert.equal(gfx.resolve({ preset: 'high', render_scale: 5 }).renderScale, 2);
	assert.equal(gfx.resolve({ preset: 'high', render_scale: 0.1 }).renderScale, 0.5);
	assert.equal(gfx.resolve({ preset: 'high', render_scale: 1.5 }).scale, 1.5);
	assert.equal(gfx.resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
	assert.equal(gfx.resolve({}).adaptive, true);
	assert.equal(gfx.resolve({}).showFps, false);
});

test('choosePreset clears overrides but keeps scale and toggles', () => {
	const s = gfx.choosePreset({ preset: 'low', bloom: 'on', ao: 'high', render_scale: 1.5, adaptive: false, show_fps: true }, 'high');
	assert.deepEqual(s, { preset: 'high', render_scale: 1.5, adaptive: false, show_fps: true });
	assert.equal(gfx.choosePreset({}, 'auto').preset, 'auto');
});

test('describe summarises cost', () => {
	const d = gfx.describe(gfx.resolve({ preset: 'high' }), [800, 600]);
	assert.match(d, /2048² shadows/);
	assert.match(d, /SMAA/);
	assert.match(d, /800×600 px/);
	assert.match(gfx.describe(gfx.resolve({ preset: 'low' })), /no shadows/);
});
