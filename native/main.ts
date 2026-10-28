// Paint Maze on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (src/rules.js), the progress document
// (src/storage.js) and the strings (src/i18n.js) are the browser build's pure
// modules, shared with the Node tests; this module is what its src/main.js did
// around them: the level flow (start, resume from the saved roll string, roll,
// undo, restart, hint, finish with stars, best moves and the leaderboard post),
// the screens' state (title, levels, game, the finish and how-to cards) and
// input: the roll keys and pad, swipes and taps on the board, and every button.
import "./i18n.ts";
import { clipboard, files, frame, onPreferencesChange, onQuit, onRender, onStart, onSuspend, onUpdate, preferences } from "starhermit:engine";
import { onAction, onPointerButton, onTouch } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { rules, storage, type Board, type Dir, type Level, type State } from "./game.ts";
import { t } from "./i18n.ts";
import * as audio from "./audio.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyWorld, initStyles } from "./style.ts";

export type Screen = "title" | "levels" | "game";
export type Overlay = null | "complete" | "howto";
type Text = () => string;

export const app = {
  screen: "title" as Screen,
  overlay: null as Overlay,
  /** Frame the screen or card opened on (the press that opened it must not also act on it). */
  openedFrame: 0,
  focusNext: null as string | null,
  toast: null as null | { text: Text; until: number },
};
const now = (): number => frame().time;
export const fresh = (n = 1): boolean => frame().frame - app.openedFrame <= n;

export const game = {
  levels: [] as Level[],
  worlds: [] as string[],
  idx: 0,
  level: null as Level | null,
  board: null as Board | null,
  state: null as State | null,
  history: [] as State[],
  dirs: "",
  /** Rolls whose animation has not finished (main.js game.pending). */
  pending: 0,
  finished: false,
  /** The world whose colours the page shows (body[data-world]: the last level's). */
  world: "studio",
  /** The hinted roll (its arrow button shows as primary until the next roll). */
  hintDir: null as Dir | null,
  /** The tip card: a tutorial tip, or a hint's flashed message (null: hidden). */
  tip: null as Text | null,
  /** When the finish card opens, and when the three-star chime plays. */
  completeAt: null as number | null,
  perfectAt: null as number | null,
  complete: null as null | { worldEnd: boolean; last: boolean; world: string; moves: number; par: number; newBest: boolean; stars: number },
  /** The finish card's leaderboard line (undefined: none; null: posting). */
  lb: undefined as undefined | null | { posted: boolean; rank: number | null },
};

export function goTo(s: Screen, focus: string | null = null): void {
  app.screen = s;
  opened(focus);
}
function opened(focus: string | null): void {
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  ui.setFocus(null);
}
export function openOverlay(o: Overlay, focus: string | null): void { app.overlay = o; opened(focus); }
export function closeOverlay(): void { app.overlay = null; opened(null); }
export function announce(text: string): void { if (text) ui.announce(text.slice(0, 480)); }
export function toast(text: Text): void { app.toast = { text, until: now() + 3.2 }; }

// ------------------------------------------------------------------ progress
export const profile = (): typeof platform.profile => platform.profile;
export const totalStars = (): number => Object.values(profile().progress).reduce((s, r) => s + r.stars, 0);
export const isDone = (i: number): boolean => !!game.levels[i] && !!profile().progress[game.levels[i]!.id];
export const isUnlocked = (i: number): boolean => i === 0 || isDone(i) || isDone(i - 1);
export const worldName = (w: string): string => t("world." + w);
export const levelNumber = (i: number): number => i - game.levels.findIndex((l) => l.world === game.levels[i]!.world) + 1;
export function started(): boolean {
  const cur = profile().current;
  return Object.keys(profile().progress).length > 0 || (!!cur && game.levels.some((l) => l.id === cur.id));
}
/** The level Play opens: the one in progress, else the first unfinished. */
export function nextLevelIndex(): number {
  const cur = profile().current;
  const i = cur ? game.levels.findIndex((l) => l.id === cur.id) : -1;
  if (i >= 0) return i;
  const first = game.levels.findIndex((_, k) => !isDone(k));
  return first < 0 ? 0 : first;
}

// ------------------------------------------------------------------ level flow
export function startLevel(i: number, fresh_ = false): void {
  const level = game.levels[i]!;
  game.idx = i;
  game.level = level;
  game.board = rules.parseLevel(level);
  game.history = [];
  game.dirs = "";
  game.finished = false;
  game.pending = 0;
  game.hintDir = null;
  game.completeAt = null;
  game.perfectAt = null;
  game.complete = null;
  game.lb = undefined;
  let state = rules.createState(game.board);
  const cur = profile().current;
  if (!fresh_ && cur && cur.id === level.id && cur.dirs) {
    // Resume: replay the saved rolls, keeping each step for undo.
    for (const d of cur.dirs as unknown as Dir[]) {
      const r = rules.roll(game.board, state, d);
      if (!r) break;
      game.history.push(state);
      state = r.state;
      game.dirs += d;
    }
  }
  game.state = state;
  game.world = level.world;
  showTip();
  app.overlay = null;
  goTo("game");
  render.setLevel(game.board, state, level.world);
  saveCurrent();
}

function showTip(): void {
  const i = game.idx;
  const firstOfWorld = i > 0 && game.levels[i - 1]!.world !== game.levels[i]!.world;
  const key = i === 0 ? "tut1" : i === 1 ? "tut2" : i === 2 ? "tut3" : firstOfWorld && game.levels[i]!.world === game.worlds[1] ? "tutWorld" : null;
  game.tip = key ? () => t(key) : null;
}

function saveCurrent(): void {
  profile().current = game.finished || !game.level ? null : { id: game.level.id, dirs: game.dirs };
  platform.saveProgress();
}

export function legalDirs(): Set<Dir> {
  return new Set(game.finished || !game.board || !game.state ? [] : rules.legalDirs(game.board, game.state));
}
export const canUndo = (): boolean => game.history.length > 0 && !game.finished && game.pending === 0;
export const canHint = (): boolean => !game.finished && game.pending === 0;

export function roll(dir: Dir): void {
  game.hintDir = null;
  const board = game.board, level = game.level;
  if (game.finished || !level || !board || !game.state || app.overlay || app.screen !== "game") return;
  const r = rules.roll(board, game.state, dir);
  if (!r) {
    if (!game.pending) render.bump(dir);
    audio.play("bump", { gain: 0.6 });
    announce(t("blocked"));
    return;
  }
  // The logical state advances at once; animations play back in order.
  game.history.push(game.state);
  game.dirs += dir;
  const from = game.state.pos;
  game.state = r.state;
  const done = rules.isComplete(r.state);
  if (done) game.finished = true;
  else saveCurrent();
  game.pending++;
  render.animateRoll(from, dir, r.path, r.newly, r.state,
    () => audio.play("roll", { gain: 0.5, rate: 0.9 + Math.random() * 0.2 }),
    () => {
      if (game.level !== level) return;
      game.pending = Math.max(0, game.pending - 1);
      audio.play(r.newly.length ? "splat" : "stop", { gain: r.newly.length ? 0.55 : 0.7 });
      announce(t("rolled", { dir: t("dir." + dir), n: r.newly.length, left: r.state.remaining }));
      if (done) finish();
    });
}

function finish(): void {
  const level = game.level!, state = game.state!;
  const stars = rules.starsFor(state.moves, level.par);
  const hadRecord = !!profile().progress[level.id];
  const newBest = storage.recordResult(profile(), level.id, state.moves, stars);
  saveCurrent();
  game.tip = null;
  render.celebrate();
  const last = game.idx === game.levels.length - 1;
  const worldEnd = last || game.levels[game.idx + 1]!.world !== level.world;
  audio.play(last ? "finale" : worldEnd ? "world" : "complete");
  if (stars === 3) game.perfectAt = now() + 0.35;
  game.complete = { worldEnd, last, world: level.world, moves: state.moves, par: level.par, newBest: hadRecord && newBest, stars };
  postStars(level);
  game.completeAt = now() + (render.isReducedMotion() ? 0.15 : 0.75);
}

// Signed in only: the total star count goes to the platform board after each finished level (score-script.js),
// and the finish card shows the rank.
let lbSeq = 0;
function postStars(level: Level): void {
  const seq = ++lbSeq;
  game.lb = undefined;
  if (!platform.signedIn()) return;
  game.lb = null;
  void platform.postStars(totalStars()).then((r) => { if (seq === lbSeq && game.level === level) game.lb = r; });
}
export function lbLine(): string | null {
  const r = game.lb;
  if (r === undefined) return null;
  return !r ? t("lbPosting") : !r.posted ? t("lbNotPosted") : r.rank ? t("lbRank", { rank: r.rank }) : t("lbPosted");
}

export function undo(): void {
  if (!canUndo() || app.overlay) return;
  game.state = game.history.pop()!;
  game.dirs = game.dirs.slice(0, -1);
  game.hintDir = null;
  render.setState(game.state);
  audio.play("undo", { gain: 0.4, rate: 1.2 });
  saveCurrent();
}

export function restart(): void {
  if (!canUndo() || app.overlay) return;
  profile().current = null;
  startLevel(game.idx, true);
}

export function hint(): void {
  if (!canHint() || !game.level || app.overlay) return;
  const sol = rules.solve(game.board!, game.state!, 80000);
  audio.play("hint", { gain: 0.4 });
  if (!sol) {
    render.showHint(null);
    game.hintDir = null;
    announce(t("hintStuck"));
    game.tip = () => t("hintStuck");
    return;
  }
  const dir = sol[0] as Dir;
  render.showHint(dir);
  game.hintDir = dir;
  announce(t("hintMsg", { dir: t("dir." + dir) }));
  game.tip = () => t("hintMsg", { dir: t("dir." + dir) });
}

export function nextLevel(): void { startLevel(Math.min(game.idx + 1, game.levels.length - 1), true); }
export function replay(): void { startLevel(game.idx, true); }
export function toLevels(): void { app.overlay = null; goTo("levels", "current-level"); }
export function play(): void { startLevel(nextLevelIndex()); }

/** Esc (the back action): closes a card (not the finish card), else goes back a screen. */
function back(): void {
  if (fresh(0)) return;
  if (app.overlay) { if (app.overlay !== "complete") closeOverlay(); return; }
  if (app.screen === "game") toLevels();
  else if (app.screen === "levels") goTo("title");
}

// ------------------------------------------------------------------ the platform
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function copyInvite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  let ok = false;
  try { clipboard.writeText(link); ok = true; } catch { ok = false; }
  toast(ok ? () => t("shCopied") : () => t("shCopyFailed"));
}

// ------------------------------------------------------------------ input
// Keys and pad buttons (starhermit.txt control.* / engine.gamepad.*), matched as the browser build matched
// KeyboardEvent.code; the player's rebinds apply. On the game screen the roll keys always roll (the browser
// build's document keydown), so they take the arrows back from a focused button.
const ROLL: Record<string, Dir> = { roll_up: "U", roll_down: "D", roll_left: "L", roll_right: "R" };
onAction((e) => {
  if (!e.pressed) return;
  if (e.action === "back") { back(); return; }
  if (app.overlay || app.screen !== "game") return;
  const dir = ROLL[e.action];
  if (dir) { ui.setFocus(null); roll(dir); return; }
  if (e.action === "undo") undo();
  else if (e.action === "restart") restart();
  else if (e.action === "hint") hint();
});

// Swipes and taps on the board (main.js pointerdown/pointerup): a swipe of 24 px or more rolls that way; a tap
// on a tile in the ball's row or column rolls toward it. Presses are queued and decided once the frame's UI is
// built, so a press on a widget is the widget's.
interface Press { kind: "down" | "up" | "cancel"; x: number; y: number }
const queued: Press[] = [];
let down: null | { x: number; y: number } = null;
let lastTouch = -10;
let pointerUpFrame = -10;
/** A pointer button or finger lifted this frame or the last (a click or tap activates on its release). */
export function pointerActivation(): boolean { return frame().frame - pointerUpFrame <= 1; }
onPointerButton((e) => {
  if (!e.pressed) pointerUpFrame = frame().frame;
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  queued.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y });
});
onTouch((e) => {
  if (!e.primary || e.control) return;
  lastTouch = now();
  if (e.phase === "end") pointerUpFrame = frame().frame;
  if (e.phase === "move") return;
  queued.push({ kind: e.phase === "start" ? "down" : e.phase === "end" ? "up" : "cancel", x: e.x, y: e.y });
});
/** The board's window rectangle this frame (screens.ts sets it), and the open card's (for presses outside it). */
export const boardRect = { x: 0, y: 0, w: 0, h: 0 };
export const cardRect = { x: 0, y: 0, w: 0, h: 0 };
const inside = (r: typeof boardRect, x: number, y: number): boolean => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
function pointerInput(): void {
  for (const q of queued.splice(0)) {
    if (q.kind === "cancel") { down = null; continue; }
    if (q.kind === "down") {
      down = null;
      // A press outside How to play closes it (the browser build's overlay pointerdown).
      if (app.overlay === "howto" && !fresh(1) && !inside(cardRect, q.x, q.y)) { closeOverlay(); continue; }
      if (app.overlay || app.screen !== "game" || !inside(boardRect, q.x, q.y)) continue;
      down = { x: q.x, y: q.y };
      continue;
    }
    const d = down;
    down = null;
    if (!d || app.overlay || app.screen !== "game") continue;
    const sc = frame().scale;
    const dx = (q.x - d.x) / sc, dy = (q.y - d.y) / sc;
    ui.setFocus(null);
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 24) { roll(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U")); continue; }
    const tile = render.tileAt(q.x, q.y);
    const b = game.board, s = game.state;
    if (!tile || !b || !s) continue;
    const [tx, ty] = tile;
    const bx = s.pos % b.w, by = (s.pos - bx) / b.w;
    if (tx === bx && ty !== by) roll(ty < by ? "U" : "D");
    else if (ty === by && tx !== bx) roll(tx < bx ? "L" : "R");
  }
}

// ------------------------------------------------------------------ lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.setLook(lookFor(f.quality, f.levelIndex));
}

onStart(() => {
  initStyles();
  platform.initPlatform(now);
  const data = files.readJson("data/levels.json") as unknown as { levels: Level[]; worlds: string[] };
  game.levels = data.levels;
  game.worlds = data.worlds;
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  goTo("title");
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
onSessionEnded(() => toast(() => t("shSignedOut")));
onSuspend(() => platform.flush());
onQuit(() => platform.flush());

onUpdate(() => {
  applyLook();
  applyWorld(game.world, ui.preferences().highContrast);
  audio.update();
  render.update();
  const time = now();
  if (app.toast && app.toast.until < time) app.toast = null;
  if (platform.sync.status && platform.sync.until < time) platform.sync.status = null;
  if (game.perfectAt !== null && time >= game.perfectAt) { game.perfectAt = null; audio.play("perfect", { gain: 0.6 }); }
  if (game.completeAt !== null && time >= game.completeAt) {
    game.completeAt = null;
    if (game.finished && app.screen === "game") openOverlay("complete", game.complete?.last ? "btn-replay" : "btn-next");
  }
});
onRender(() => {
  drawScreens();
  pointerInput();
});
