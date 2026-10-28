// The board, as the browser build's src/render.js drew it on its Canvas 2D
// element: the static layer (a raised slab with a drop shadow, corridors carved
// into it with inner-edge shading, tile seams) is painted once per level, size
// or quality into an OffscreenCanvas (starhermit:canvas, the same Canvas 2D
// code) and drawn as one image; each frame draws the paint, the drifting haze,
// the finish wave, the hint arrow, the particles and the ball on top with
// starhermit:draw primitives (the ball is a sprite painted once per tile size,
// palette and glow, then squashed and stretched as it rolls). Animations run
// on the frame clock (frame().time), so render checks see them advance.
import { frame } from "starhermit:engine";
import { OffscreenCanvas } from "starhermit:canvas";
import * as draw from "starhermit:draw";
import { rules, type Board, type Dir, type State } from "./game.ts";
import type { Look } from "./quality.ts";

export interface Palette { paint: string; paintHi: string; floor: string; floorEdge: string; wall: string; wallTop: string; bg1: string; bg2: string }
/** render.js PALETTES. */
export const PALETTES: Record<string, Palette> = {
  studio: { paint: "#ff5a5f", paintHi: "#ff9a8f", floor: "#f4eee6", floorEdge: "#e2d8cb", wall: "#4a4458", wallTop: "#6b6480", bg1: "#fbf3ea", bg2: "#f1e2d6" },
  gallery: { paint: "#2f8cff", paintHi: "#8cc4ff", floor: "#eef2f8", floorEdge: "#d9e0ec", wall: "#2f3b53", wallTop: "#4b5b7c", bg1: "#eef4fc", bg2: "#dde7f5" },
  workshop: { paint: "#f59e0b", paintHi: "#fcd34d", floor: "#f6f0e4", floorEdge: "#e5dbc8", wall: "#4b3b2c", wallTop: "#6e5840", bg1: "#fbf6ea", bg2: "#efe4cf" },
  atelier: { paint: "#10b981", paintHi: "#6ee7b7", floor: "#ebf5f2", floorEdge: "#d4e6e0", wall: "#1f3a37", wallTop: "#335a55", bg1: "#eaf6f2", bg2: "#d6ebe4" },
};

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const now = (): number => frame().time * 1000;
/** A #rrggbb colour with an alpha, as draw takes it. */
function rgba(hex: string, a: number): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

interface Particle { x: number; y: number; vx: number; vy: number; t0: number; life: number; r: number; confetti: boolean; hue: number }
interface Roll { from: number; dir: Dir; path: number[]; newly: Set<number>; state: State; onStart: () => void; onDone: () => void }
interface Anim extends Roll { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number; idx: number }

let board: Board | null = null;
let pal: Palette = PALETTES.studio!;
let look: Look | null = null;
let reducedMotion = false;
let state: State | null = null;
const paintAt = new Map<number, number>(); // cell -> time painted (0: settled)
const ball = { x: 0, y: 0, sx: 1, sy: 1 };
let anim: Anim | null = null;
const queue: Roll[] = [];
let shake: null | { dir: Dir; t0: number; soft: boolean } = null;
let hintDir: Dir | null = null;
let celebrateAt = 0;
let particles: Particle[] = [];
const blobs = Array.from({ length: 10 }, (_, i) => ({ x: (i * 0.37) % 1, y: (i * 0.61) % 1, r: 0.12 + (i % 3) * 0.05, s: 0.6 + (i % 4) * 0.25 }));

// Layout in logical pixels inside the board rect (render.js resize): tile size and offsets.
const lay = { sc: 1, cssW: 0, cssH: 0, tile: 0, ox: 0, oy: 0, x: 0, y: 0 };
let staticLayer: OffscreenCanvas | null = null;
let staticKey = "";
let ballSprite: OffscreenCanvas | null = null;
let ballKey = "";

export function setLook(l: Look): void { look = l; staticKey = ""; ballKey = ""; }
export function setReducedMotion(on: boolean): void { reducedMotion = on; }
export const isReducedMotion = (): boolean => reducedMotion;
export const busy = (): boolean => !!anim || queue.length > 0;

function xy(cell: number): [number, number] { const x = cell % board!.w; return [x, (cell - x) / board!.w]; }

/** Loads a level: board geometry, palette and the painted state. */
export function setLevel(b: Board, s: State, paletteId: string): void {
  board = b;
  pal = PALETTES[paletteId] ?? PALETTES.studio!;
  particles = [];
  celebrateAt = 0;
  staticKey = "";
  ballKey = "";
  setState(s);
}
export function palette(): Palette { return pal; }

/** Jumps to a state without animation (resume, undo, restart): queued rolls are dropped. */
export function setState(s: State): void {
  anim = null;
  queue.length = 0;
  state = s;
  paintAt.clear();
  board!.cells.forEach((c, i) => { if (s.painted[i]) paintAt.set(c, 0); });
  hintDir = null;
  shake = null;
  const [x, y] = xy(s.pos);
  ball.x = x; ball.y = y; ball.sx = 1; ball.sy = 1;
}

/** Queues a roll's animation (render.js animateRoll): `onStart` as it begins, `onDone` when the ball rests. */
export function animateRoll(from: number, dir: Dir, path: number[], newly: number[], s: State, onStart: () => void, onDone: () => void): void {
  queue.push({ from, dir, path, newly: new Set(newly), state: s, onStart, onDone });
  hintDir = null;
}
function startNext(t: number): void {
  const r = queue.shift();
  if (!r) return;
  const [fx, fy] = xy(r.from);
  const [tx, ty] = xy(r.path[r.path.length - 1]!);
  const dur = reducedMotion ? 90 : Math.min(520, 110 + 55 * r.path.length);
  anim = { ...r, fx, fy, tx, ty, t0: t, dur, idx: 0 };
  r.onStart();
}

/** A blocked roll: the ball nudges toward the wall and springs back. */
export function bump(dir: Dir): void {
  if (reducedMotion || anim) return;
  shake = { dir, t0: now(), soft: false };
}
export function showHint(dir: Dir | null): void { hintDir = dir; }

export function celebrate(): void {
  celebrateAt = now();
  if (look && look.confetti > 0 && !reducedMotion && board) {
    for (let i = 0; i < look.confetti; i++) {
      const c = board.cells[Math.floor(Math.random() * board.cells.length)]!;
      const [x, y] = xy(c);
      spawn(x, y, (Math.random() - 0.5) * 0.12, -0.05 - Math.random() * 0.12, 900 + Math.random() * 600, true);
    }
  }
}

function spawn(x: number, y: number, vx: number, vy: number, life: number, confetti = false): void {
  if (!look || particles.length >= look.particles) return;
  particles.push({ x, y, vx, vy, t0: now(), life, r: 0.05 + Math.random() * 0.07, confetti, hue: Math.random() });
}

/** render.js _step: advances the roll (painting tiles as the ball's centre reaches them), the bump and particles. */
function step(t: number): void {
  if (!anim && queue.length) startNext(t);
  const a = anim;
  if (a) {
    const k = Math.min(1, (t - a.t0) / a.dur);
    const e = ease(k);
    ball.x = a.fx + (a.tx - a.fx) * e;
    ball.y = a.fy + (a.ty - a.fy) * e;
    const speed = Math.sin(k * Math.PI);
    const horiz = a.dir === "L" || a.dir === "R";
    ball.sx = horiz ? 1 + 0.22 * speed : 1 - 0.12 * speed;
    ball.sy = horiz ? 1 - 0.12 * speed : 1 + 0.22 * speed;
    const travelled = Math.abs(ball.x - a.fx) + Math.abs(ball.y - a.fy);
    while (a.idx < a.path.length && travelled >= a.idx + 0.5) {
      const cell = a.path[a.idx++]!;
      if (a.newly.has(cell)) {
        paintAt.set(cell, t);
        if (!reducedMotion && Math.random() < 0.7) {
          const [cx, cy] = xy(cell);
          const [dx, dy] = rules.DIRS[a.dir];
          spawn(cx, cy, -dx * 0.02 + (Math.random() - 0.5) * 0.03, -dy * 0.02 + (Math.random() - 0.5) * 0.03, 420);
        }
      }
    }
    if (k >= 1) {
      for (; a.idx < a.path.length; a.idx++) if (a.newly.has(a.path[a.idx]!)) paintAt.set(a.path[a.idx]!, t);
      ball.sx = 1; ball.sy = 1;
      anim = null;
      if (!reducedMotion) {
        const [dx, dy] = rules.DIRS[a.dir];
        shake = { dir: a.dir, t0: t, soft: true };
        const n = a.newly.size ? 10 : 4;
        for (let i = 0; i < n; i++) {
          const ang = Math.random() * Math.PI * 2;
          spawn(a.tx + dx * 0.3, a.ty + dy * 0.3, Math.cos(ang) * 0.06 - dx * 0.04, Math.sin(ang) * 0.06 - dy * 0.04, 500);
        }
      }
      state = a.state;
      a.onDone();
      if (queue.length) startNext(t);
    }
  }
  if (shake && (t - shake.t0) / 260 >= 1) shake = null;
  if (particles.length) particles = particles.filter((p) => t - p.t0 < p.life);
}

/** Advances the animations each frame, on every screen (a roll finishing under the level list still finishes). */
export function update(): void { if (board && state) step(now()); }

/** render.js resize: the tile size and offsets for a board rect (window pixels). */
function layout(x: number, y: number, w: number, h: number): void {
  const b = board!;
  const sc = frame().scale;
  lay.sc = sc; lay.x = x; lay.y = y;
  lay.cssW = w / sc; lay.cssH = h / sc;
  const pad = 12;
  lay.tile = Math.max(8, Math.floor(Math.min(84, (lay.cssW - pad * 2) / b.w, (lay.cssH - pad * 2 - 8) / b.h)));
  lay.ox = Math.round((lay.cssW - lay.tile * b.w) / 2);
  lay.oy = Math.round((lay.cssH - lay.tile * b.h - Math.max(4, lay.tile * 0.2)) / 2);
}

function roundPath(g: import("starhermit:canvas").OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** render.js _bakeStatic, unchanged: drawn in logical units scaled to window pixels. */
function bakeStatic(w: number, h: number): void {
  const b = board!, T = lay.tile, sc = lay.sc;
  const cw = Math.min(4096, Math.max(1, Math.round(w))), ch = Math.min(4096, Math.max(1, Math.round(h)));
  if (!staticLayer || staticLayer.width !== cw || staticLayer.height !== ch) staticLayer = new OffscreenCanvas(cw, ch);
  const g = staticLayer.getContext("2d");
  g.reset();
  g.setTransform(sc, 0, 0, sc, 0, 0);
  const shadows = !!look?.shadows;
  const lift = Math.max(4, Math.round(T * 0.2));
  const W = T * b.w, H = T * b.h, r = Math.min(14, T * 0.35);
  const { ox, oy } = lay;
  const fl = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < b.w && y < b.h && b.floor[y * b.w + x]! >= 0;
  // Raised slab: a darker front face under the top surface, with a soft drop shadow (canvas shadows ignore
  // the transform, so they take the scale by hand).
  if (shadows) { g.save(); g.shadowColor = "rgba(20,20,40,.3)"; g.shadowBlur = Math.min(40, T * 0.7) * sc; g.shadowOffsetY = Math.min(18, T * 0.3) * sc; }
  g.fillStyle = pal.wall;
  roundPath(g, ox, oy, W, H + lift, r);
  g.fill();
  if (shadows) g.restore();
  g.fillStyle = pal.wallTop;
  roundPath(g, ox, oy, W, H, r);
  g.fill();
  const sheen = g.createLinearGradient(0, oy, 0, oy + H);
  sheen.addColorStop(0, "rgba(255,255,255,.12)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = sheen;
  roundPath(g, ox, oy, W, H, r);
  g.fill();
  // Corridors carved into the slab.
  g.fillStyle = pal.floor;
  for (const cell of b.cells) {
    const [x, y] = xy(cell);
    g.fillRect(ox + x * T, oy + y * T, T, T);
  }
  // Tile seams inside corridors.
  g.fillStyle = pal.floorEdge;
  for (const cell of b.cells) {
    const [x, y] = xy(cell);
    if (fl(x + 1, y)) g.fillRect(ox + (x + 1) * T - 0.5, oy + y * T + T * 0.2, 1, T * 0.6);
    if (fl(x, y + 1)) g.fillRect(ox + x * T + T * 0.2, oy + (y + 1) * T - 0.5, T * 0.6, 1);
  }
  // Depth: the wall's inner face shades the top and left edges of each corridor tile.
  for (const cell of b.cells) {
    const [x, y] = xy(cell);
    const px = ox + x * T, py = oy + y * T;
    if (!fl(x, y - 1)) {
      const gr = g.createLinearGradient(0, py, 0, py + lift * 1.4);
      gr.addColorStop(0, shadows ? "rgba(25,20,40,.38)" : "rgba(25,20,40,.22)");
      gr.addColorStop(1, "rgba(25,20,40,0)");
      g.fillStyle = gr;
      g.fillRect(px, py, T, lift * 1.4);
    }
    if (!fl(x - 1, y)) {
      const gr = g.createLinearGradient(px, 0, px + lift, 0);
      gr.addColorStop(0, "rgba(25,20,40,.18)");
      gr.addColorStop(1, "rgba(25,20,40,0)");
      g.fillStyle = gr;
      g.fillRect(px, py, lift, T);
    }
  }
}

/** The ball as render.js _draw painted it (radial gradient, rim, highlight, the glow halo), once per size. */
function bakeBall(): number {
  const T = lay.tile, sc = lay.sc, glow = !!look?.glow;
  const r = T * 0.34;
  const margin = glow ? T * 0.6 : 2;
  const half = (r + margin) * sc;
  const key = `${T}:${sc}:${glow}:${pal.paint}`;
  if (ballKey === key && ballSprite) return half;
  ballKey = key;
  const size = Math.max(2, Math.ceil(half * 2));
  ballSprite = new OffscreenCanvas(size, size);
  const g = ballSprite.getContext("2d");
  g.setTransform(sc, 0, 0, sc, size / 2, size / 2);
  if (glow) { g.shadowColor = pal.paint; g.shadowBlur = T * 0.5 * sc; }
  const grad = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  grad.addColorStop(0, pal.paintHi);
  grad.addColorStop(1, pal.paint);
  g.fillStyle = grad;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  g.shadowColor = "rgba(0,0,0,0)";
  g.strokeStyle = "rgba(0,0,0,.18)";
  g.lineWidth = Math.max(1, T * 0.03);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,.75)";
  g.beginPath(); g.ellipse(-r * 0.35, -r * 0.4, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2); g.fill();
  return size / 2;
}

/** The board's tile under a window point, or null (taps in line with the ball). */
export function tileAt(wx: number, wy: number): [number, number] | null {
  if (!board || !lay.tile) return null;
  const lx = (wx - lay.x) / lay.sc, ly = (wy - lay.y) / lay.sc;
  return [Math.floor((lx - lay.ox) / lay.tile), Math.floor((ly - lay.oy) / lay.tile)];
}

/** Draws the board into a window rectangle (render.js _loop + _draw). */
export function drawBoard(x: number, y: number, w: number, h: number): void {
  if (!board || !state || !look || w < 4 || h < 4) return;
  const t = now();
  layout(x, y, w, h);
  const key = `${Math.round(w)}x${Math.round(h)}:${lay.sc}:${look.shadows}:${pal.wall}:${board.cells.length}:${board.start}`;
  if (key !== staticKey) { staticKey = key; bakeStatic(w, h); }
  const sc = lay.sc, T = lay.tile;
  const X = (lx: number): number => x + lx * sc, Y = (ly: number): number => y + ly * sc;
  const clip = { clip: { x, y, width: w, height: h } };
  draw.image(staticLayer!, x, y);
  // Soft paint-coloured haze drifting behind the board edges.
  if (look.blobs > 0 && !reducedMotion) {
    const c = rgba(pal.paint, 0.07);
    for (const b of blobs.slice(0, look.blobs)) {
      const bx = ((b.x + Math.sin(t / 9000 * b.s) * 0.08) % 1) * lay.cssW;
      const by = ((b.y + Math.cos(t / 11000 * b.s) * 0.08) % 1) * lay.cssH;
      draw.circle(X(bx), Y(by), b.r * Math.max(lay.cssW, lay.cssH) * sc, c, clip);
    }
  }
  // Paint: each tile spreads from its centre when first painted.
  const shine = look.glow ? rgba("#ffffff", 0.16) : null;
  for (const [cell, at] of paintAt) {
    const k = at ? Math.min(1, (t - at) / 220) : 1;
    if (k >= 1 && at) paintAt.set(cell, 0);
    const [cx, cy] = xy(cell);
    const px = lay.ox + cx * T, py = lay.oy + cy * T;
    if (k >= 1) draw.rect(X(px), Y(py), T * sc, T * sc, pal.paint);
    else {
      const e = ease(k);
      const s = T * (0.3 + 0.7 * e);
      draw.roundRect(X(px + (T - s) / 2), Y(py + (T - s) / 2), s * sc, s * sc, Math.min(s / 2, T * 0.5 * (1 - e) + 0.5) * sc, pal.paint);
    }
    if (shine) draw.rect(X(px), Y(py + T * 0.12), T * sc, T * 0.12 * sc, shine);
  }
  // The finish wave: a white ripple outward from the ball.
  const wave = celebrateAt ? (t - celebrateAt) / 900 : -1;
  if (wave >= 0 && wave < 1.6) {
    const [bx0, by0] = xy(state.pos);
    for (const cell of paintAt.keys()) {
      const [cx, cy] = xy(cell);
      const d = Math.hypot(cx - bx0, cy - by0) / Math.max(board.w, board.h);
      const wk = Math.max(0, 1 - Math.abs(wave - d) * 5);
      if (wk > 0) draw.rect(X(lay.ox + cx * T), Y(lay.oy + cy * T), T * sc, T * sc, rgba("#ffffff", 0.45 * wk));
    }
  }
  // Hint arrow beside the ball.
  if (hintDir && !anim) {
    const [dx, dy] = rules.DIRS[hintDir];
    const pulse = 0.5 + 0.5 * Math.sin(t / 180);
    const cx = lay.ox + (ball.x + 0.5 + dx * (0.85 + 0.12 * pulse)) * T;
    const cy = lay.oy + (ball.y + 0.5 + dy * (0.85 + 0.12 * pulse)) * T;
    const ang = Math.atan2(dy, dx), cs = Math.cos(ang), sn = Math.sin(ang);
    const pts = ([[T * 0.26, 0], [-T * 0.16, -T * 0.22], [-T * 0.16, T * 0.22]] as const)
      .map(([px, py]) => [X(cx + px * cs - py * sn), Y(cy + px * sn + py * cs)] as [number, number]);
    draw.polygon(pts, rgba(pal.wall, 0.75));
  }
  // Particles: paint droplets and confetti.
  for (const p of particles) {
    const age = (t - p.t0) / p.life;
    const px = lay.ox + (p.x + 0.5 + p.vx * (t - p.t0) / 16) * T;
    const py = lay.oy + (p.y + 0.5 + p.vy * (t - p.t0) / 16 + (p.confetti ? 0.5 * age * age * 6 : 0)) * T;
    const rr = p.r * T * (p.confetti ? 1.2 : 1 - age * 0.5);
    if (rr <= 0) continue;
    draw.circle(X(px), Y(py), rr * sc, rgba(p.confetti ? (p.hue < 0.5 ? pal.paint : pal.paintHi) : pal.paint, Math.max(0, 1 - age)), clip);
  }
  // Ball.
  let bx = ball.x, by = ball.y, sx = ball.sx, sy = ball.sy;
  if (shake) {
    const k = Math.min(1, (t - shake.t0) / 260);
    const [dx, dy] = rules.DIRS[shake.dir];
    const amp = (shake.soft ? 0.05 : 0.14) * Math.sin(k * Math.PI) * (1 - k);
    bx += dx * amp; by += dy * amp;
    const sq = (shake.soft ? 0.14 : 0.2) * Math.sin(k * Math.PI);
    if (dx) { sx = 1 - sq; sy = 1 + sq * 0.6; } else { sy = 1 - sq; sx = 1 + sq * 0.6; }
  }
  const cx = lay.ox + (bx + 0.5) * T, cy = lay.oy + (by + 0.5) * T, r = T * 0.34;
  if (look.shadows) draw.ellipse(X(cx + r * 0.15), Y(cy + r * 0.75), r * 0.85 * sx * sc, r * 0.32 * sc, rgba("#141428", 0.25));
  const half = bakeBall();
  draw.image(ballSprite!, X(cx) - half * sx, Y(cy) - half * sy, half * 2 * sx, half * 2 * sy);
}
