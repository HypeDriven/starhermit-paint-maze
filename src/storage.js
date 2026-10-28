// The player's progress document and its merge rules. Pure: shared by the
// engine client (native/platform.ts keeps it as the engine save, on the device
// and in the account's cloud slot) and the Node tests. The document is the
// browser build's cloud-save shape ({ v: 2, progress, current, tutorialSeen }),
// so the slot that build wrote (game:<slug>) reads as is.

export function emptyProfile() {
  return {
    v: 2,
    progress: {}, // levelId -> { best, stars }
    current: null, // { id, dirs } in-progress level
    tutorialSeen: {},
  };
}

const validDoc = (d) => !!d && typeof d === 'object' && d.v === 2 && !!d.progress && typeof d.progress === 'object';

/** Records a finished level; returns true when it is a new best. */
export function recordResult(profile, id, moves, stars) {
  const prev = profile.progress[id];
  const isBest = !prev || moves < prev.best;
  profile.progress[id] = { best: isBest ? moves : prev.best, stars: Math.max(stars, prev?.stars || 0) };
  return isBest;
}

/** The saved document (engine save data and the old cloud-save shape). */
export const cloudDoc = (profile) => ({ v: 2, progress: profile.progress, current: profile.current, tutorialSeen: profile.tutorialSeen });

/** Merges a remote doc into the local profile: best results win; this device's in-progress level is kept (the remote one is used only when there is none). */
export function mergeRemote(profile, doc) {
  if (!validDoc(doc)) return false;
  for (const [id, r] of Object.entries(doc.progress)) {
    if (!r || !Number.isInteger(r.best) || !Number.isInteger(r.stars)) continue;
    const l = profile.progress[id];
    profile.progress[id] = l ? { best: Math.min(l.best, r.best), stars: Math.max(l.stars, r.stars) } : { best: r.best, stars: r.stars };
  }
  if (!profile.current && doc.current && typeof doc.current.id === 'string' && typeof doc.current.dirs === 'string') profile.current = { id: doc.current.id, dirs: doc.current.dirs };
  if (doc.tutorialSeen && typeof doc.tutorialSeen === 'object') profile.tutorialSeen = { ...profile.tutorialSeen, ...doc.tutorialSeen };
  return true;
}

/** A profile from a saved document (junk entries dropped; anything unreadable: a fresh profile). */
export function readDoc(doc) {
  const p = emptyProfile();
  mergeRemote(p, doc);
  return p;
}

/** The browser build's cloud save (the slot's JSON text), or null when it is not one. */
export function readForeign(text) {
  try {
    const d = JSON.parse(String(text));
    return validDoc(d) ? readDoc(d) : null;
  } catch { return null; }
}

/** Two saved documents merged (a conflict between devices): `local`'s in-progress level is kept. */
export function mergeDocs(local, remote) {
  const p = readDoc(local);
  mergeRemote(p, remote);
  return cloudDoc(p);
}

const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v));
/** Same content, whatever the key order. */
export const sameDoc = (a, b) => stable(a) === stable(b);
