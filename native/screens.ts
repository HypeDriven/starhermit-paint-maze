// The browser build's DOM (index.html + styles.css) as starhermit:ui, built
// every frame over the page gradient: the title (logo, Play/Continue, Levels,
// How to play, Settings, sign-in and invite, the star total), the level list
// (one section per world), the game (top bar, HUD, tip card, the board and the
// controls), the finish and how-to cards, the sync pill and the toast. The
// browser's media queries are layouts picked by the window's logical size:
// wide (≥ 900 × 560: the controls in a column at the right, the arrows in a
// cross), landscape phone (≤ 559 px tall: the same, smaller) and portrait (a
// thumb row of arrows and tools under the board). Settings opens the
// runtime's Options (sound, graphics, language, reduced motion, controls).
import { frame, openMenu } from "starhermit:engine";
import { bindings } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { rules, type Dir } from "./game.ts";
import { t } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import { worldColors } from "./style.ts";
import {
  app, boardRect, canHint, canUndo, cardRect, closeOverlay, copyInvite, fresh, game, goTo, hint, isUnlocked, lbLine,
  legalDirs, levelNumber, nextLevel, nextLevelIndex, openOverlay, play, pointerActivation, profile, replay, restart, roll, signIn,
  started, startLevel, toLevels, totalStars, undo, worldName,
} from "./main.ts";

// ------------------------------------------------------------------ layout and helpers
interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number; wide: boolean; land: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const land = lw > lh && lh <= 559;
  return { lw, lh, sc, ox: sa.left, oy: sa.top, wide: !land && lw >= 900 && lh >= 560, land };
}
/** Buttons' labels by id this session (ui.focused() answers with the label). */
const labels = new Map<string, string>();
const lastSize = new Map<string, { w: number; h: number }>();
const prefs = (): ui.UiPreferences => ui.preferences();
function tw(text: string, style: string | (string | ui.Style)[], kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style }).width / prefs().scale;
}
interface Btn { id: string; text: string; cls?: string; glyph?: string; icon?: string; disabled?: boolean; act: () => void }
/** A button's natural width (measureText "button" includes the padding). */
const btnW = (b: Btn): number => tw(b.glyph ? `${b.glyph} ${b.text}` : b.text, b.cls ?? "btn", "button") + 2;
/** A button; `glyph` (the browser build's aria-hidden icon span) shows before the text, the label stays the text. */
function button(b: Btn, width: number | null = null, height: number | null = null): boolean {
  const cls = b.cls ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.icon) opts.content = () => { ui.style({ text: { size: 19, weight: "600" } }).label(b.icon!); };
  else if (b.glyph) {
    const size = cls === "tool" ? 15 : 16;
    opts.content = () => {
      ui.row(`${b.id}-face`, () => {
        ui.style({ text: { size, weight: "600" } }).label(b.glyph!);
        ui.style({ text: { size, weight: "600" } }).label(b.text);
      }, { spacing: 5, align: "center" });
    };
  }
  const box: ui.Style = {};
  if (width != null) box.width = width;
  if (height != null) box.height = height;
  labels.set(b.id, b.text);
  const hit = ui.style(cls, box).id(b.id).button(b.text, opts);
  if (hit && !fresh(0)) { b.act(); if (app.screen === "game" && pointerActivation()) ui.setFocus(null); }
  return hit;
}
/** Buttons at their own widths in rows that wrap at `width` (CSS flex-wrap, centred). */
function flow(label: string, list: Btn[], width: number, gap = 8): void {
  const rows: number[] = [];
  let used = 0, n = 0;
  for (const b of list) {
    const w = Math.min(width, btnW(b));
    if (n && used + gap + w > width) { rows.push(n); used = 0; n = 0; }
    used += (n ? gap : 0) + w;
    n++;
  }
  if (n) rows.push(n);
  let k = 0;
  ui.column(label, () => {
    rows.forEach((cnt, ri) => ui.row(`${label}-r${ri}`, () => {
      for (let i = 0; i < cnt; i++, k++) { const b = list[k]!; button(b, btnW(b) > width ? width : null); }
    }, { spacing: gap, align: "center" }));
  }, { spacing: gap, align: "center", width });
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "p", id?: string, center = false): void {
  if (!text) return;
  const styles: (string | ui.Style)[] = [cls];
  if (center) styles.push({ text: { align: "center" } });
  let u = ui.style(...styles);
  if (id) u = u.id(id);
  if (tw(text, styles) <= width) {
    if (center) ui.row(`${id ?? text}-c`, () => { (id ? ui.style(...styles).id(id) : ui.style(...styles)).label(text); }, { width, justify: "center" });
    else u.label(text);
  } else u.paragraph(text, width);
}
/** Stars as the browser build's .stars spans: lit ones in the accent, the rest in the line colour. */
function stars(id: string, n: number, size: number): void {
  ui.row(id, () => {
    for (let k = 1; k <= 3; k++) ui.style(k <= n ? "stars" : "stars-off", { text: { size } }).label("★");
  }, { spacing: size > 30 ? 6 : 2, align: "center" });
}
const keyNames: Record<string, string> = { Escape: "Esc", "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→" };
/** main.js keyLabel: an action's effective keys, e.g. "↑/W". */
function keysFor(action: string): string {
  let list: readonly { device: string; label: string }[] = [];
  try { list = bindings(action); } catch { list = []; }
  const names = list.filter((b) => b.device === "keyboard").map((b) => keyNames[b.label] ?? b.label);
  return [...new Set(names)].join("/") || "—";
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  const c = worldColors(game.world);
  // body: linear-gradient(180deg, var(--bg), var(--bg2)) in the world's colours.
  draw.box(0, 0, f.width, f.height, { background: { type: "linear", stops: [c.bg, c.bg2] }, radius: 0 });
  if (app.screen === "game" && game.board) gameScreen(L);
  else if (app.screen === "levels") levelsScreen(L);
  else titleScreen(L);
  if (app.overlay) overlay(L);
  syncPill(L);
  toast(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    // Retried until it takes (a focus request can be lost while the previously focused widget changes state).
    const want = labels.get(app.focusNext);
    if (age >= 1 && want !== undefined && ui.focused() === want && age >= 3) app.focusNext = null;
    else if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 15) app.focusNext = null;
  }
}

/** A centred block (the title card), scrolling when taller than the window. */
function centered(key: string, L: Layout, width: number, build: (w: number) => void, spacing: number): void {
  const avail = L.lh - 16;
  const h = lastSize.get(key)?.h ?? 0;
  const scroll = h > avail;
  const inner = width - (scroll ? 14 : 0);
  const body = (): void => {
    const r = ui.column(`${key}-col`, () => build(inner), { width: inner, spacing, align: "center" });
    lastSize.set(key, { w: r.width / L.sc, h: r.height / L.sc });
  };
  ui.place(`page-${key}`, scroll ? { anchor: "top", y: 8 } : "center", () => {
    if (scroll) ui.scrollArea(`${key}-scroll`, { width, height: avail }, body, fresh(6) ? { scrollTo: { top: 0 } } : undefined);
    else body();
  });
}

// ------------------------------------------------------------------ title
const LOGO = ["#ff5a5f", "#2f8cff", "#f59e0b", "#10b981"];
function titleScreen(L: Layout): void {
  const w = Math.min(480, L.lw - 24);
  centered("title", L, w, (iw) => {
    if (!L.land) {
      // .logo: four paint squares popping in turn (2.4 s, staggered 0.3 s; still under reduced motion).
      ui.widget("logo", { role: "none", size: { width: 82, height: 82 }, draw: (r, st) => {
        const s = r.width / 82, time = frame().time;
        LOGO.forEach((col, i) => {
          const ph = (((time - i * 0.3) % 2.4) + 2.4) % 2.4 / 2.4;
          const k = st.reducedMotion ? 1 : ph < 0.7 ? 1 : ph < 0.8 ? 1 + 0.12 * (ph - 0.7) / 0.1 : 1 + 0.12 * (1 - (ph - 0.8) / 0.2);
          const size = 38 * s * k;
          const cx = r.x + (19 + (i % 2) * 44) * s, cy = r.y + (19 + Math.floor(i / 2) * 44) * s;
          draw.roundRect(cx - size / 2, cy - size / 2, size, size, 9 * s * k, col);
        });
      } });
    }
    const h1 = L.land ? 32 : Math.min(54, Math.max(35, L.lw * 0.08));
    ui.style("h1", { text: { size: h1 } }).id("title-heading").heading("Paint Maze");
    para(t("tagline"), iw, "tagline", "tagline", true);
    if (platform.signedIn()) para(t("hello", { name: platform.displayName() ?? t("playerId", { id: platform.playerIdPrefix() }) }), iw, "muted", "hello", true);
    button({ id: "btn-play", text: t(started() ? "continue" : "play"), cls: "big", act: play });
    flow("title-row", [
      { id: "btn-levels", text: t("levels"), act: () => goTo("levels", "current-level") },
      { id: "btn-howto", text: t("howTo"), act: () => openOverlay("howto", "btn-howto-close") },
      { id: "btn-settings", text: t("settings"), act: () => openMenu() },
    ], iw);
    const acct: Btn[] = [];
    if (!platform.signedIn()) acct.push({ id: "btn-signin", text: t("shSignIn"), act: signIn });
    if (platform.inviteLink()) acct.push({ id: "btn-invite", text: t("shInvite"), act: copyInvite });
    if (acct.length) flow("title-account", acct, iw);
    para(t("starsTotal", { n: totalStars(), total: game.levels.length * 3 }), iw, "muted", "title-stars", true);
  }, L.land ? 8 : 14);
}

// ------------------------------------------------------------------ top bar
/** header.bar: a button at each end and the title centred between them. Its height. */
function topBar(L: Layout, key: string, left: Btn, title: string, right: () => void): number {
  const h = L.land ? 40 : 48;
  const y = L.land ? 4 : 8;
  ui.place(`bar-${key}`, { anchor: "top-start", x: 12, y }, () => {
    ui.row(`bar-${key}-row`, () => {
      button({ ...left, cls: "icon" }, 44, 44);
      ui.row(`bar-${key}-mid`, () => {
        const avail = Math.max(40, L.lw - 24 - 44 - 120);
        if (tw(title, "bar-title", "heading") <= avail) ui.style("bar-title").id(`${key}-title`).heading(title);
        else ui.style("bar-title").id(`${key}-title`).paragraph(title, avail);
      }, { grow: 1, justify: "center", align: "center" } as ui.Layout);
      right();
    }, { width: L.lw - 24, height: h, spacing: 10, align: "center" });
  });
  return y + h;
}

// ------------------------------------------------------------------ levels
function levelsScreen(L: Layout): void {
  const top = topBar(L, "levels", { id: "btn-levels-back", text: t("back"), icon: "←", act: () => goTo("title") }, t("levels"), () => {
    ui.style("pill").row("levels-stars", () => { ui.style("p", { text: { weight: "600" } }).id("levels-stars-text").label(`★ ${totalStars()} / ${game.levels.length * 3}`); }, { align: "center" });
  });
  const w = Math.min(1088, L.lw - 24);
  const y = top + 6;
  const avail = L.lh - y - 10;
  const natural = lastSize.get("levels")?.h ?? 0;
  const scroll = natural > avail;
  const inner = w - (scroll ? 10 : 0);
  const current = nextLevelIndex();
  ui.place("levels-list", { anchor: "top", y }, () => {
    const body = (): void => {
      const r = ui.column("world-list", () => {
        for (const wld of game.worlds) worldSection(wld, inner, current);
      }, { width: inner, spacing: 18, padding: { bottom: 16 } });
      lastSize.set("levels", { w: r.width / L.sc, h: r.height / L.sc });
    };
    if (scroll) ui.scrollArea("levels-scroll", { width: w, height: avail }, body);
    else body();
  });
}
function worldSection(wld: string, w: number, current: number): void {
  const idxs = game.levels.map((l, i) => (l.world === wld ? i : -1)).filter((i) => i >= 0);
  const got = idxs.reduce((s, i) => s + (profile().progress[game.levels[i]!.id]?.stars ?? 0), 0);
  const accent = worldColors(wld).accent;
  const locked = !isUnlocked(idxs[0]!);
  ui.column(`world-${wld}`, () => {
    ui.row(`world-${wld}-head`, () => {
      ui.style("world-name").id(`world-${wld}-name`).heading(worldName(wld));
      ui.spacer();
      ui.style("small").id(`world-${wld}-stars`).label(`★ ${got} / ${idxs.length * 3}`);
    }, { width: w, align: "end" });
    const gap = 8;
    const cols = Math.max(1, Math.floor((w + gap) / (64 + gap)));
    const cw = (w - gap * (cols - 1)) / cols;
    ui.grid(`world-${wld}-grid`, () => {
      for (const i of idxs) {
        const lvl = game.levels[i]!;
        const r = profile().progress[lvl.id];
        const unlocked = isUnlocked(i);
        const n = levelNumber(i);
        const isCur = i === current;
        const box: ui.Style = { width: cw, height: 64 };
        if (r) box.border = { width: 1, color: accent };
        if (isCur) box.background = accent;
        if (locked) box.opacity = 0.45;
        const label = `${t("level", { n })}${unlocked ? "" : " — " + t("locked")}${r ? ` — ${r.stars}★` : ""}`;
        if (isCur) labels.set("current-level", label);
        const hit = ui.style("level", box).id(isCur ? "current-level" : `lvl-${lvl.id}`).button(label, {
          disabled: !unlocked,
          content: () => {
            ui.column(`${lvl.id}-face`, () => {
              ui.style(isCur ? "lvl-n-on" : "lvl-n").label(unlocked ? String(n) : "🔒");
              ui.style(isCur ? "lvl-s-on" : "lvl-s", isCur ? {} : { text: { color: accent } }).label(r ? "★".repeat(r.stars) : " ");
            }, { spacing: 2, align: "center" });
          },
        });
        if (hit && !fresh(0)) startLevel(i);
      }
    }, { columns: cols, gap, width: w });
  }, { width: w, spacing: 8 });
}

// ------------------------------------------------------------------ game
const GLYPH: Record<Dir, string> = { U: "↑", D: "↓", L: "←", R: "→" };
function gameScreen(L: Layout): void {
  const lvl = game.level!, st = game.state!;
  const f = frame();
  const top = topBar(L, "game", { id: "btn-menu", text: t("levels"), icon: "☰", act: toLevels }, t("levelOf", { world: worldName(lvl.world), n: levelNumber(game.idx) }), () => {
    button({ id: "btn-settings-game", text: t("settings"), icon: "⚙", cls: "icon", act: () => openMenu() }, 44, 44);
  });
  // .hud: Moves, Par, Left and the star rating so far.
  let y = top + (L.land ? 0 : 2);
  const hudSize = L.land ? 14 : 15;
  const hud = ui.place("hud", { anchor: "top", y }, () => {
    ui.row("hud-row", () => {
      for (const [id, k, v] of [["hud-moves", "moves", st.moves], ["hud-par", "par", lvl.par], ["hud-left", "left", st.remaining]] as const) {
        ui.row(`${id}-pair`, () => {
          ui.style("hud-k", { text: { size: hudSize } }).label(t(k));
          ui.style("hud-v").id(id).label(String(v));
        }, { spacing: 5, align: "center" });
      }
      stars("hud-stars", rules.starsFor(Math.max(st.moves, 1), lvl.par), 18);
    }, { spacing: L.land ? 12 : 18, align: "center", padding: { top: L.land ? 0 : 2, bottom: L.land ? 0 : 4 } });
  });
  y += hud.height / L.sc + 2;
  // .tip: a card with the accent edge (tutorial tips, hint messages).
  if (game.tip && !game.finished) {
    const text = game.tip();
    const maxW = Math.min(640, L.lw - 24);
    const size = L.land ? 14 : 15;
    const tW = Math.min(maxW, tw(text, ["tip-text", { text: { size } }]) + 30);
    const r = ui.place("tip", { anchor: "top", y }, () => {
      ui.style("tip", { width: tW }).row("tip-box", () => {
        ui.style("tip-bar", { width: 4 }).column("tip-edge", () => undefined, { width: 4 });
        ui.column("tip-body", () => {
          const st: (string | ui.Style)[] = ["tip-text", { text: { size } }];
          if (tw(text, st) <= tW - 28) ui.style(...st).id("tip").label(text);
          else ui.style(...st).id("tip").paragraph(text, tW - 28);
        }, { padding: { top: L.land ? 4 : 8, bottom: L.land ? 4 : 8, start: 8, end: 12 } });
      }, { width: tW, align: "stretch", clip: true, spacing: 0 });
    });
    y += r.height / L.sc + (L.land ? 4 : 6);
  }
  const bottom = L.lh - (L.land ? 4 : 10);
  const pad = 12;
  let board: { x: number; y: number; w: number; h: number };
  if (L.wide || L.land) {
    // Controls in a column at the right, the arrows in a cross.
    const cw = L.wide ? 260 : 220;
    const ch = lastSize.get("controls")?.h ?? 200;
    const cy = y + Math.max(0, (bottom - y - ch) / 2);
    ui.place("controls", { anchor: "top-start", x: L.lw - pad - cw, y: cy }, () => {
      const r = ui.column("controls-col", () => {
        dpadCross(L.wide ? 64 : 52, L.wide ? 58 : 46, L.wide ? 8 : 6);
        if (L.wide) ui.column("tools", () => toolButtons(cw), { width: cw, spacing: 8 });
        else flow("tools", toolList(), cw, 6);
      }, { width: cw, spacing: L.wide ? 18 : 8, align: "center" });
      lastSize.set("controls", { w: r.width / L.sc, h: r.height / L.sc });
    });
    board = { x: pad, y, w: L.lw - 2 * pad - cw - 10, h: bottom - y };
  } else {
    // Portrait: a thumb row of arrows, the tools under it.
    const inner = L.lw - 2 * pad;
    const ch = lastSize.get("controls")?.h ?? 120;
    ui.place("controls", { anchor: "top", y: bottom - ch }, () => {
      const r = ui.column("controls-col", () => {
        ui.row("dpad", () => { for (const d of ["L", "U", "D", "R"] as Dir[]) dirButton(d, 60, 52); }, { spacing: 10, align: "center" });
        flow("tools", toolList(), inner, 8);
      }, { width: inner, spacing: 8, align: "center" });
      lastSize.set("controls", { w: r.width / L.sc, h: r.height / L.sc });
    });
    board = { x: pad, y, w: inner, h: Math.max(60, bottom - ch - 10 - y) };
  }
  const sc = L.sc;
  boardRect.x = L.ox + board.x * sc; boardRect.y = L.oy + board.y * sc;
  boardRect.w = Math.max(1, board.w * sc); boardRect.h = Math.max(1, board.h * sc);
  render.drawBoard(boardRect.x, boardRect.y, boardRect.w, boardRect.h);
  ui.target(`${t("level", { n: levelNumber(game.idx) })}: ${game.board!.cells.length}`, { x: boardRect.x, y: boardRect.y, width: boardRect.w, height: boardRect.h }, { role: "label" });
  void f;
}
function dirButton(d: Dir, w: number, h: number): void {
  const legal = legalDirs();
  const label = t("rollAria", { dir: t("dir." + d) });
  const hit = ui.style(game.hintDir === d ? "dir-hint" : "dir", { width: w, height: h }).id(`dir-${d}`).button(label, {
    disabled: !legal.has(d),
    content: () => { ui.style({ text: { size: 24, weight: "600" } }).label(GLYPH[d]); },
  });
  if (hit && !fresh(0)) { roll(d); if (pointerActivation()) ui.setFocus(null); }
}
/** The arrows in a cross (the wide and landscape .dpad grid: ↑ above ← ↓ →). */
function dpadCross(w: number, h: number, gap: number): void {
  ui.column("dpad", () => {
    ui.row("dpad-top", () => dirButton("U", w, h), { justify: "center", width: w * 3 + gap * 2 });
    ui.row("dpad-bottom", () => { for (const d of ["L", "D", "R"] as Dir[]) dirButton(d, w, h); }, { spacing: gap });
  }, { spacing: gap, align: "center" });
}
function toolList(): Btn[] {
  return [
    { id: "btn-undo", text: t("undo"), glyph: "↶", cls: "tool", disabled: !canUndo(), act: undo },
    { id: "btn-restart", text: t("restart"), glyph: "↻", cls: "tool", disabled: !canUndo(), act: restart },
    { id: "btn-hint", text: t("hint"), glyph: "💡", cls: "tool", disabled: !canHint(), act: hint },
  ];
}
function toolButtons(w: number): void { for (const b of toolList()) button(b, w); }

// ------------------------------------------------------------------ cards
function overlay(L: Layout): void {
  const f = frame();
  // .overlay: the dim over the page; it takes the pointer, so nothing under it is pressed.
  ui.place("scrim", { anchor: "top-start", x: -L.ox / L.sc, y: -L.oy / L.sc }, () => {
    ui.style("scrim", { width: f.width / L.sc, height: f.height / L.sc }).column("scrim-box", () => undefined, { width: f.width / L.sc, height: f.height / L.sc });
  });
  const outer = Math.min(448, L.lw - 32);
  const pad = 22;
  const avail = L.lh - 24;
  const key = app.overlay!;
  const h = lastSize.get(`card-${key}`)?.h ?? 0;
  const scroll = h > avail;
  const inner = outer - 2 * pad - (scroll ? 14 : 0);
  const r = ui.place(`card-${key}`, "center", () => {
    const body = (): void => {
      const c = ui.style("card", { width: outer }).id(`overlay-${key}`).column(key === "complete" ? t("complete") : t("howTo"), () => {
        if (key === "complete") completeCard(inner);
        else howtoCard(inner);
      }, { width: outer, spacing: 12, align: "center" });
      lastSize.set(`card-${key}`, { w: c.width / L.sc, h: c.height / L.sc });
    };
    if (scroll) ui.scrollArea(`card-${key}-scroll`, { width: outer + 14, height: avail }, body, fresh(6) ? { scrollTo: { top: 0 } } : undefined);
    else body();
  });
  cardRect.x = r.x; cardRect.y = r.y; cardRect.w = r.width; cardRect.h = r.height;
}
function completeCard(w: number): void {
  const c = game.complete;
  if (!c) return;
  stars("complete-stars", c.stars, 42);
  const title = c.worldEnd ? t("worldDone", { world: worldName(c.world) }) : t("complete");
  if (tw(title, "h2", "heading") <= w) ui.style("h2").id("complete-title").heading(title);
  else para(title, w, "h2", "complete-title", true);
  para(t("completeSub", { moves: c.moves, par: c.par }), w, "p", "complete-sub", true);
  const extra = c.last ? t("allDone") : c.newBest ? t("newBest") : "";
  if (extra) para(extra, w, "accent", "complete-extra", true);
  const lb = lbLine();
  if (lb) para(lb, w, "p", "complete-lb", true);
  const list: Btn[] = [
    { id: "btn-replay", text: t("replay"), act: replay },
    { id: "btn-complete-levels", text: t("levels"), act: toLevels },
  ];
  if (!c.last) list.push({ id: "btn-next", text: t("next"), cls: "primary", act: nextLevel });
  flow("complete-actions", list, w);
}
function howtoCard(w: number): void {
  if (tw(t("howTo"), "h2", "heading") <= w) ui.style("h2").id("howto-title").heading(t("howTo"));
  else para(t("howTo"), w, "h2", "howto-title", true);
  para(t("howToBody"), w, "p", "howto-body", true);
  const k = (a: string): string => keysFor(a);
  const keys = [
    ...(["U", "D", "L", "R"] as Dir[]).map((d) => `${t("rollAria", { dir: t("dir." + d) })}: ${k({ U: "roll_up", D: "roll_down", L: "roll_left", R: "roll_right" }[d])}`),
    `${t("undo")}: ${k("undo")}`, `${t("restart")}: ${k("restart")}`, `${t("hint")}: ${k("hint")}`, `${t("menu")}: ${k("back")}`,
  ].join(" · ");
  para(keys, w, "muted", "howto-keys", true);
  button({ id: "btn-howto-close", text: t("close"), cls: "primary", act: closeOverlay });
}

// ------------------------------------------------------------------ sync pill and toast
function syncPill(L: Layout): void {
  const s = platform.sync.status;
  if (!s) return;
  const text = t(s === "saving" ? "syncSaving" : s === "synced" ? "syncSynced" : "syncError");
  const at = app.screen === "game" ? { anchor: "top-end" as const, x: 64, y: L.land ? 12 : 16 } : { anchor: "bottom-end" as const, x: 12, y: 10 };
  ui.place("sync", at, () => { ui.style("sync").row("sync-row", () => { ui.style("sync-text").id("sync").label(text); }, { align: "center" }); });
}
function toast(L: Layout): void {
  const tt = app.toast;
  if (!tt) return;
  const text = tt.text();
  const w = Math.min(L.lw * 0.9, 420);
  ui.place("toast", { anchor: "bottom", y: 16 }, () => ui.style("toast", { width: w }).column("toast-col", () => para(text, w - 34, "toast-text", "toast", true), { width: w, align: "center" }));
}

