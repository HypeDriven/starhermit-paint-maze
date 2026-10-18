// Pure graphics-quality model: presets, per-category overrides, StarHermit hardware-level
// detection, per-preset effect budgets,
// pixel ratio and adaptive resolution. No DOM access, so it is unit-tested.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

export const CATEGORIES = {
  shadows: ['off', 'on'],
  glow: ['off', 'on'],
  particles: ['off', 'low', 'high'],
  ambient: ['off', 'on'],
};

const PRESET_VALUES = {
  low: { shadows: 'off', glow: 'off', particles: 'off', ambient: 'off', dprCap: 1, scale: 1 },
  balanced: { shadows: 'on', glow: 'off', particles: 'low', ambient: 'on', dprCap: 1.5, scale: 1 },
  high: { shadows: 'on', glow: 'on', particles: 'high', ambient: 'on', dprCap: 2, scale: 1 },
  ultra: { shadows: 'on', glow: 'on', particles: 'high', ambient: 'on', dprCap: 3, scale: 1.25 },
};

export const PARTICLE_BUDGET = { off: 0, low: 60, high: 220 };

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX
// 5090; src/gpu-level.js → window.StarHermitGpu, a classic script loaded before the game): Low from 0,
// Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are capped at level 9.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string (null = no WebGL) plus detectSystem() facts. */
export function detectLevel(renderer, system) {
  const G = gpuApi();
  const sys = { webgl: true, webgl2: true, ...(system || {}), gpu: String(renderer || '') };
  if (!renderer) sys.webgl = false;
  return G ? G.detectLevel(sys) : (renderer ? LEVELS.balanced : 0);
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Auto preset for a renderer string (the hardware level already caps phones/tablets at Balanced). */
export function detectTier(renderer, system) {
  return presetForLevel(detectLevel(renderer, system));
}

/*
 * Per-preset effect budget for the 2D canvas. Each preset holds 60 FPS on the weakest GPU Auto gives it
 * (Low → level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Board, tiles,
 * swipe/tap areas and rules are identical on every preset — only visuals change.
 *   particles  droplet/confetti cap at Particles "high" (low: 30 %), scaled with the level
 *   confetti   confetti pieces in the level-complete burst at Particles "high" (low: 40 %)
 *   blobs      drifting haze blobs (Ambient on)
 * Settled paint is cached in an offscreen layer on every preset; only tiles still spreading, the
 * ball, hint, particles and the finish wave are drawn per frame.
 */
export const BUDGETS = {
  low: { particles: 80, confetti: 40, blobs: 3 },
  balanced: { particles: 120, confetti: 60, blobs: 4 },
  high: { particles: 220, confetti: 90, blobs: 7 },
  ultra: { particles: 360, confetti: 140, blobs: 10 },
};
export const PARTICLE_MAX = 720;
const PARTICLE_SHARE = { off: 0, low: 0.3, high: 1 };

/** A preset's concrete budget for a hardware level (counts scale ≤ 2× within the preset). */
export function budgetFor(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  b.particles = Math.min(PARTICLE_MAX, Math.round(b.particles * k));
  b.confetti = Math.min(b.particles, Math.round(b.confetti * k));
  return b;
}

/** Live particle cap for resolved quality (Particles tier share of the preset's budget). */
export function particleCap(q) {
  return Math.round((q.budget?.particles ?? PARTICLE_BUDGET.high) * (PARTICLE_SHARE[q.particles] ?? 0));
}

export const defaults = () => ({ preset: 'auto', overrides: {}, renderScale: 1, adaptive: false, showFps: false });

/** Normalizes a saved settings object, dropping anything invalid. */
export function sanitize(saved) {
  const d = defaults();
  if (!saved || typeof saved !== 'object') return d;
  if (saved.preset === 'auto' || PRESETS.includes(saved.preset)) d.preset = saved.preset;
  if (saved.overrides && typeof saved.overrides === 'object') {
    for (const [k, v] of Object.entries(saved.overrides)) if (CATEGORIES[k]?.includes(v)) d.overrides[k] = v;
  }
  if (Number.isFinite(saved.renderScale)) d.renderScale = Math.min(2, Math.max(0.5, saved.renderScale));
  d.adaptive = !!saved.adaptive;
  d.showFps = !!saved.showFps;
  return d;
}

/** Resolves settings + detected tier into the effective quality. */
export function resolve(saved, detected = 'balanced', level) {
  const s = sanitize(saved);
  const preset = s.preset === 'auto' ? detected : s.preset;
  const base = PRESET_VALUES[preset];
  const q = { preset, auto: s.preset === 'auto', dprCap: base.dprCap, presetScale: base.scale, renderScale: s.renderScale, adaptive: s.adaptive, showFps: s.showFps };
  for (const k of Object.keys(CATEGORIES)) q[k] = s.overrides[k] || base[k];
  q.level = Number.isFinite(level) ? level : LEVELS[preset];
  q.budget = budgetFor(preset, q.level);
  return q;
}

export const presetValue = (preset, cat) => PRESET_VALUES[preset][cat];

/** Choosing a preset clears per-category overrides but keeps scale and toggles. */
export function choosePreset(saved, preset) {
  const s = sanitize(saved);
  s.preset = preset;
  s.overrides = {};
  return s;
}

/** Backing-store pixel ratio for a device pixel ratio and adaptive scale. */
export function pixelRatio(q, dpr = 1, adaptiveScale = 1) {
  return Math.max(0.5, Math.min(dpr, q.dprCap) * q.presetScale * q.renderScale * adaptiveScale);
}

/** Adaptive resolution step from an average frame time (ms). */
export function adaptStep(avgMs, scale) {
  if (avgMs > 26) return Math.max(0.6, +(scale - 0.1).toFixed(2));
  if (avgMs < 14) return Math.min(1, +(scale + 0.05).toFixed(2));
  return scale;
}

/** Enabled effect category names, for the summary line. */
export const activeEffects = (q) => Object.keys(CATEGORIES).filter((k) => q[k] !== 'off');
