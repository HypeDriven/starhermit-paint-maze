// Pure graphics-quality model: presets, per-category overrides, GPU detection,
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

/** Tier for a WebGL unmasked renderer string; touch devices cap at balanced. */
export function detectTier(renderer, { touch = false } = {}) {
  let tier;
  if (!renderer || /swiftshader|llvmpipe|software|basic render/i.test(renderer)) tier = 'low';
  else if (/nvidia|geforce|rtx|radeon rx|radeon pro|apple m\d|arc a\d/i.test(renderer)) tier = 'high';
  else tier = 'balanced';
  if (touch && tier === 'high') tier = 'balanced';
  return tier;
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
export function resolve(saved, detected = 'balanced') {
  const s = sanitize(saved);
  const preset = s.preset === 'auto' ? detected : s.preset;
  const base = PRESET_VALUES[preset];
  const q = { preset, auto: s.preset === 'auto', dprCap: base.dprCap, presetScale: base.scale, renderScale: s.renderScale, adaptive: s.adaptive, showFps: s.showFps };
  for (const k of Object.keys(CATEGORIES)) q[k] = s.overrides[k] || base[k];
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
