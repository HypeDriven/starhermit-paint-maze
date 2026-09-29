// Sound effects: authored samples from sfx/ decoded through Web Audio. The
// context starts on the first user gesture; missing or undecodable files are
// skipped silently so play never depends on audio.

export const SFX = {
  roll: 'roller-slide', stop: 'ball-stop', bump: 'wall-bump', splat: 'paint-splatter', undo: 'marble-whoosh',
  hint: 'paint-swipe', complete: 'level-complete', perfect: 'win-chime', world: 'paint-finale', finale: 'victory-fanfare',
};

export class Audio {
  constructor(base = 'sfx/') {
    this.base = base;
    this.ctx = null;
    this.gain = null;
    this.buffers = new Map();
    this.volume = 0.7;
  }

  /** Call from a user gesture: creates the context and loads the samples. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.ctx.destination);
    for (const name of new Set(Object.values(SFX))) {
      fetch(this.base + name + '.opus')
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => this.buffers.set(name, buf))
        .catch(() => {});
    }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  play(event, { rate = 1, gain = 1 } = {}) {
    const buf = this.buffers.get(SFX[event]);
    if (!this.ctx || !buf || this.volume === 0) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.gain);
    src.start();
  }
}
