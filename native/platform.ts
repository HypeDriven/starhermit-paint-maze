// The player's data and the StarHermit platform, on the runtime's modules (the
// browser build's src/platform.js over starhermit-sdk.js plus src/storage.js's
// localStorage):
// - the progress (best moves and stars per level, the level in progress as its
//   roll string, tips seen) is the game's save (starhermit:storage `saves`,
//   schema 2, src/storage.js cloudDoc): on the device and in the player's cloud
//   slot. Two devices' saves merge on a conflict (src/storage.js mergeDocs: the
//   browser build's saveconflict merge). The slot that build wrote through the
//   JS SDK (game:<slug>, the same document as JSON text) shows as foreign: it is
//   merged in and replaced once;
// - the browser build's settings in the account's settings KV (volume, reduced
//   motion, graphics, ui.language) are removed: sound, graphics, language and
//   reduced motion are the runtime's Options now;
// - the player, the invite link, and posting the total star count through
//   score-script.js (a practice session whose socket carries { type: 'result',
//   scores }, as the JS SDK's submitScores did) with the rank on the board.
import type { JsonValue } from "starhermit:engine";
import { inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player } from "starhermit:platform";
import { saves, settings as store } from "starhermit:storage";
import * as S from "./game.ts";

export let profile: S.Profile = S.storage.emptyProfile();
let lastSavedAt = 0;
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onMerged(fn: () => void): void { mergedListeners.add(fn); }
function merged(): void { for (const fn of mergedListeners) fn(); }

function write(opts: { replaceForeign?: boolean } = {}): void {
  try {
    saves.save(S.storage.cloudDoc(profile) as unknown as JsonValue, { schema: 2, ...opts });
    lastSavedAt = saves.load()?.savedAt ?? lastSavedAt;
  } catch (e) { console.warn(`save: ${String(e)}`); }
}
/** Saves the progress (device at once, the account debounced by the runtime). */
export function saveProgress(): void { write(); }
/** Merges another document into the live one; whether anything changed (then saved). */
function adopt(other: unknown): boolean {
  const mine = S.storage.cloudDoc(profile);
  const next = S.storage.mergeDocs(mine, other);
  if (S.storage.sameDoc(next, mine)) return false;
  profile = S.storage.readDoc(next);
  write();
  return true;
}
saves.onConflict((local, remote) => ({ merged: S.storage.mergeDocs(local?.data ?? null, remote.data) as unknown as JsonValue }));
saves.onStatus((_status, state) => {
  syncChanged(state);
  if (state === "foreign") { migrateForeign(); return; }
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(cur.data)) merged();
  }
});
/** The browser build's cloud document: merged with this device's, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const p = S.storage.readForeign(old.text);
  const changed = p ? adopt(S.storage.cloudDoc(p)) : false;
  write({ replaceForeign: true });
  if (changed) merged();
}

// The sync pill (index.html #sync): Saving… while an upload runs, Saved to cloud for 2.5 s after, an error.
export type Sync = "saving" | "synced" | "error";
export const sync = { status: null as Sync | null, until: 0, uploading: false };
let clock = (): number => 0;
function syncChanged(state: string): void {
  if (!player()) { sync.status = null; return; }
  if (state === "uploading") { sync.uploading = true; sync.status = "saving"; sync.until = Infinity; }
  else if (state === "error" || state === "read-blocked") { sync.uploading = false; sync.status = "error"; sync.until = Infinity; }
  else if (state === "ready" && sync.uploading) { sync.uploading = false; sync.status = "synced"; sync.until = clock() + 2.5; }
}
export function flush(): void { void saves.flush().catch(() => undefined); }

// The browser build patched these into the account's settings KV (and sh-language.js its ui.language): the
// runtime's Options own them now, so they are removed.
const BROWSER_KEYS = ["volume", "reducedMotion", "gfx", "locale"];
function dropLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  for (const key of keys) if (BROWSER_KEYS.includes(key) || key.startsWith("ui.")) store.removeLegacy(key);
}

/** Reads the device's save (from onStart). `now` is the frame clock in seconds. */
export function initPlatform(now: () => number): void {
  clock = now;
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  profile = S.storage.readDoc(cur?.data ?? null);
  store.onLegacy(dropLegacy);
  dropLegacy();
  if (saves.state() === "foreign") migrateForeign();
  refreshPlayer();
}

// --- the player -------------------------------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
/** The profile nickname, else null (the game shows "Player <id prefix>"). */
export function displayName(): string | null { return player()?.displayName || null; }
export function playerIdPrefix(): string { return String(player()?.userId ?? "").slice(0, 6); }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  if (!player()) { sync.status = null; return; }
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
onPlayerChange(() => refreshPlayer());

// --- leaderboard --------------------------------------------------------------------------------------
const BOARD = "total-stars";

/** Signed in only: post the total star count through score-script.js; { posted, rank }. Never rejects. */
export async function postStars(total: number): Promise<{ posted: boolean; rank: number | null }> {
  if (!player()) return { posted: false, rank: null };
  try {
    const r = await leaderboards.submitScore(BOARD, Math.max(0, Math.round(total)));
    return { posted: r.accepted, rank: r.rank };
  } catch { return { posted: false, rank: null }; }
}
