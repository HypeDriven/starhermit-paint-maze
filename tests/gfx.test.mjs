import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/gfx.js';

test('detectTier: software → low, discrete → high, touch capped at balanced', () => {
  assert.equal(G.detectTier(null), 'low');
  assert.equal(G.detectTier('Google SwiftShader'), 'low');
  assert.equal(G.detectTier('NVIDIA GeForce RTX 4070'), 'high');
  assert.equal(G.detectTier('Apple M2'), 'high');
  assert.equal(G.detectTier('Intel Iris Xe'), 'balanced');
  assert.equal(G.detectTier('Apple M2', { touch: true }), 'balanced');
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
