import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// src/gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../src/gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
const G = await import('../src/gfx.js');

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test('hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  assert.equal(G.detectTier(null, DESK), 'low', 'no WebGL');
  assert.equal(G.detectTier('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', DESK), 'low');
  assert.equal(G.detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(G.detectTier('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(G.detectTier('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', DESK), 'low');
  assert.equal(G.detectTier('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(G.detectTier('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(G.detectTier('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(G.detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(G.detectTier('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  for (const [p, lv] of Object.entries(G.LEVELS)) assert.equal(G.presetForLevel(lv), p);
  assert.equal(G.presetForLevel(3), 'low');
  assert.equal(G.presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most; software GPUs stay Low', () => {
  assert.equal(G.detectTier('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(G.detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(G.detectTier('Apple M2', PHONE), 'balanced');
  assert.equal(G.detectTier('SwiftShader', PHONE), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = ['particles', 'confetti', 'blobs'];
  for (const p of G.PRESETS) for (const k of keys) assert.ok(G.BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < G.PRESETS.length; i++) for (const k of keys) assert.ok(G.BUDGETS[G.PRESETS[i]][k] >= G.BUDGETS[G.PRESETS[i - 1]][k], `${G.PRESETS[i]}.${k}`);
  assert.deepEqual(G.resolve({ preset: 'high' }, 'low', 10).budget, G.BUDGETS.high, 'floor level = the tuned budget');
  assert.deepEqual(G.resolve({ preset: 'ultra' }, 'low', 0).budget, G.resolve({ preset: 'ultra' }, 'ultra', 17).budget);
  assert.ok(G.budgetFor('balanced', 9).particles > G.budgetFor('balanced', 4).particles, 'counts scale up within the preset');
  assert.ok(G.budgetFor('ultra', 20).particles <= G.PARTICLE_MAX);
  assert.equal(G.particleCap(G.resolve({ preset: 'high' }, 'low', 10)), G.BUDGETS.high.particles);
  assert.equal(G.particleCap(G.resolve({ preset: 'low' }, 'low', 0)), 0, 'Low: particles off');
  assert.equal(G.resolve({}, 'low', 0).level, 0);
});

test('resolve: auto follows the detected tier; overrides win; invalid values are dropped', () => {
  assert.equal(G.resolve({}, 'high').preset, 'high');
  assert.equal(G.resolve({ preset: 'low' }, 'high').shadows, 'off');
  const q = G.resolve({ preset: 'low', overrides: { glow: 'on', particles: 'nope', bogus: 'on' } });
  assert.equal(q.glow, 'on');
  assert.equal(q.particles, 'off');
  assert.equal(q.bogus, undefined);
});

test('choosePreset clears overrides and keeps scale and toggles', () => {
  const s = G.choosePreset({ preset: 'low', overrides: { glow: 'on' }, renderScale: 1.5, showFps: true }, 'ultra');
  assert.deepEqual(s.overrides, {});
  assert.equal(s.preset, 'ultra');
  assert.equal(s.renderScale, 1.5);
  assert.equal(s.showFps, true);
});

test('render scale is clamped and pixel ratio respects the preset cap', () => {
  assert.equal(G.sanitize({ renderScale: 9 }).renderScale, 2);
  assert.equal(G.sanitize({ renderScale: 0.1 }).renderScale, 0.5);
  assert.equal(G.pixelRatio(G.resolve({ preset: 'low' }), 3), 1);
  assert.equal(G.pixelRatio(G.resolve({ preset: 'balanced' }), 3), 1.5);
  assert.equal(G.pixelRatio(G.resolve({ preset: 'ultra' }), 2), 2.5);
});

test('adaptive resolution steps down when slow and back up when fast', () => {
  assert.equal(G.adaptStep(40, 1), 0.9);
  assert.equal(G.adaptStep(40, 0.6), 0.6);
  assert.equal(G.adaptStep(10, 0.9), 0.95);
  assert.equal(G.adaptStep(20, 0.8), 0.8);
});
