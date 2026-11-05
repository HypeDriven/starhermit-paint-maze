// The look per graphics level: the browser build's four presets and budgets
// (src/gfx.js PRESET_VALUES / BUDGETS, each tuned to hold 60 FPS on the
// weakest GPU its Auto gave it) keyed by the runtime's quality tier
// (frame().quality), with the particle counts scaled within the tier by the
// level's particle budget over the tier's anchor level (levelSettings(), at most
// 2×). The board is Canvas 2D, so none of the engine's scene effects apply. The
// runtime owns the rest of the old Settings › Graphics tab: Auto and the level
// choice, render scale and the pixel-ratio cap, adaptive resolution, the
// frame-rate limit and readout, the GPU summary. The old per-effect overrides
// are not offered (the runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";

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
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level's settings. */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const p = PRESET[preset], b = BUDGETS[preset];
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  const particles = Math.min(PARTICLE_MAX, Math.round(b.particles * k));
  const confetti = Math.min(particles, Math.round(b.confetti * k));
  return {
    preset, shadows: p.shadows, glow: p.glow,
    particles: Math.round(particles * SHARE[p.particles]),
    confetti: Math.round(confetti * CONFETTI_SHARE[p.particles]),
    blobs: p.ambient ? b.blobs : 0,
  };
}
