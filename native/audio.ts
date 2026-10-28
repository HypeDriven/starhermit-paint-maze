// Sound, as the browser build's src/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.txt) per game event, on the runtime's
// "effects" bus (Options › Audio owns the volumes, the mute and the voice
// limit: the old Settings › Sound volume and the shared options panel). The
// browser build's master gain (0.7 by default) is folded into each sound's
// gain. Clips load once the mixer runs (natively at once, in a browser after
// the first press), one at a time; a sample still loading is silent, as an
// undecoded one was.
import { context, loadClip, play as playClip, type AudioClip } from "starhermit:audio";

/** audio.js SFX. */
export const SFX: Record<string, string> = {
  roll: "roller-slide", stop: "ball-stop", bump: "wall-bump", splat: "paint-splatter", undo: "marble-whoosh",
  hint: "paint-swipe", complete: "level-complete", perfect: "win-chime", world: "paint-finale", finale: "victory-fanfare",
};
const MASTER = 0.7;

const clips = new Map<string, AudioClip>();
const queue = Object.values(SFX);
let loading = false;

/** Each frame: the next clip once the mixer runs. */
export function update(): void {
  if (loading || !queue.length || context.state !== "running") return;
  const name = queue.shift()!;
  loading = true;
  loadClip(`sfx/${name}.opus`).then(
    (c) => { clips.set(name, c); loading = false; },
    (e: unknown) => { console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`); loading = false; },
  );
}

/** audio.js play(event, { rate, gain }). */
export function play(event: keyof typeof SFX, opts: { rate?: number; gain?: number } = {}): void {
  const file = SFX[event];
  const clip = file ? clips.get(file) : undefined;
  if (!clip) return;
  try { playClip(clip, { bus: "effects", gain: (opts.gain ?? 1) * MASTER, pitch: opts.rate ?? 1 }); }
  catch { /* the mixer is full */ }
}
