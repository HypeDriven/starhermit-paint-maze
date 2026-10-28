// The look per graphics level: the browser build's four presets and budgets
// (src/gfx.js PRESET_VALUES / BUDGETS, each tuned to hold 60 FPS on the
// weakest GPU its Auto gave it) keyed by the runtime's quality tier
// (frame().quality), with the particle counts scaled within the tier by the
// level (frame().levelIndex), as the browser build scaled them by its hardware
// level (at most 2×). The runtime owns the rest of the old Settings › Graphics
// tab: Auto and the level choice, render scale and the pixel-ratio cap,
// adaptive resolution, the frame-rate limit and readout, the GPU summary. The
// old per-effect overrides are not offered (the runtime's Options choose a
// level).
import type { QualityTier } from "starhermit:engine";

export interface Look {
  preset: QualityTier;
  /** Slab drop shadow, deeper wall shading, the ball's shadow. */
  shadows: boolean;
  /** The ball's halo and the paint sheen. */
  glow: boolean;
  /** Droplet/confetti cap (0: off). */
  particles: number;
  /** Confetti pieces in the level-complete burst. */
  confetti: number;
  /** Drifting paint-haze blobs (0: ambient motion off). */
  blobs: number;
}

const PRESET: Record<QualityTier, { shadows: boolean; glow: boolean; particles: "off" | "low" | "high"; ambient: boolean }> = {
  low: { shadows: false, glow: false, particles: "off", ambient: false },
  balanced: { shadows: true, glow: false, particles: "low", ambient: true },
  high: { shadows: true, glow: true, particles: "high", ambient: true },
  ultra: { shadows: true, glow: true, particles: "high", ambient: true },
};
const BUDGETS: Record<QualityTier, { particles: number; confetti: number; blobs: number }> = {
  low: { particles: 80, confetti: 40, blobs: 3 },
  balanced: { particles: 120, confetti: 60, blobs: 4 },
  high: { particles: 220, confetti: 90, blobs: 7 },
  ultra: { particles: 360, confetti: 140, blobs: 10 },
};
const PARTICLE_MAX = 720;
const SHARE = { off: 0, low: 0.3, high: 1 };
const CONFETTI_SHARE = { off: 0, low: 0.4, high: 1 };
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const p = PRESET[preset], b = BUDGETS[preset];
  // Levels are about 1.64× apart in GPU throughput: counts grow with the level above the tier's first, at most 2×.
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  const particles = Math.min(PARTICLE_MAX, Math.round(b.particles * k));
  const confetti = Math.min(particles, Math.round(b.confetti * k));
  return {
    preset, shadows: p.shadows, glow: p.glow,
    particles: Math.round(particles * SHARE[p.particles]),
    confetti: Math.round(confetti * CONFETTI_SHARE[p.particles]),
    blobs: p.ambient ? b.blobs : 0,
  };
}
