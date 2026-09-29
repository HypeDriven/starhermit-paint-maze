// Local profile (localStorage) plus the cloud-save document shape and merge.

const KEY = 'paint-maze:v2';

export function emptyProfile() {
  return {
    v: 2,
    progress: {}, // levelId -> { best, stars }
    current: null, // { id, dirs } in-progress level
    tutorialSeen: {},
    settings: { locale: null, volume: 0.7, reducedMotion: null, gfx: null },
  };
}

function valid(p) {
  return p && typeof p === 'object' && p.v === 2 && p.progress && typeof p.progress === 'object';
}

export function loadProfile(storage = globalThis.localStorage) {
  try {
    const p = JSON.parse(storage.getItem(KEY));
    if (valid(p)) {
      const d = emptyProfile();
      return { ...d, ...p, settings: { ...d.settings, ...p.settings }, tutorialSeen: p.tutorialSeen || {} };
    }
  } catch { /* unavailable or corrupt: start fresh */ }
  return emptyProfile();
}

export function saveProfile(profile, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(profile)); } catch { /* private mode / full: play continues */ }
}

/** Records a finished level; returns true when it is a new best. */
export function recordResult(profile, id, moves, stars) {
  const prev = profile.progress[id];
  const isBest = !prev || moves < prev.best;
  profile.progress[id] = { best: isBest ? moves : prev.best, stars: Math.max(stars, prev?.stars || 0) };
  return isBest;
}

/** The part of the profile mirrored to the StarHermit cloud save. */
export const cloudDoc = (profile) => ({ v: 2, progress: profile.progress, current: profile.current, tutorialSeen: profile.tutorialSeen });

/** Merges a remote cloud doc into the local profile: best results win; the remote in-progress level is preferred. */
export function mergeRemote(profile, doc) {
  if (!doc || doc.v !== 2 || typeof doc.progress !== 'object') return false;
  for (const [id, r] of Object.entries(doc.progress)) {
    if (!r || !Number.isInteger(r.best) || !Number.isInteger(r.stars)) continue;
    const l = profile.progress[id];
    profile.progress[id] = l ? { best: Math.min(l.best, r.best), stars: Math.max(l.stars, r.stars) } : { best: r.best, stars: r.stars };
  }
  if (doc.current && typeof doc.current.id === 'string' && typeof doc.current.dirs === 'string') profile.current = doc.current;
  if (doc.tutorialSeen && typeof doc.tutorialSeen === 'object') profile.tutorialSeen = { ...profile.tutorialSeen, ...doc.tutorialSeen };
  return true;
}
