// Canvas 2D board renderer. Static geometry (floor, raised walls, shadows) is
// cached in an offscreen layer; each frame draws paint, the ball, hint arrow
// and particles on top. Only redraws while something moves.
import { DIRS } from './rules.js';
import { PARTICLE_BUDGET, pixelRatio, adaptStep } from './gfx.js';

export const PALETTES = {
  studio: { paint: '#ff5a5f', paintHi: '#ff9a8f', floor: '#f4eee6', floorEdge: '#e2d8cb', wall: '#4a4458', wallTop: '#6b6480', bg1: '#fbf3ea', bg2: '#f1e2d6' },
  gallery: { paint: '#2f8cff', paintHi: '#8cc4ff', floor: '#eef2f8', floorEdge: '#d9e0ec', wall: '#2f3b53', wallTop: '#4b5b7c', bg1: '#eef4fc', bg2: '#dde7f5' },
  workshop: { paint: '#f59e0b', paintHi: '#fcd34d', floor: '#f6f0e4', floorEdge: '#e5dbc8', wall: '#4b3b2c', wallTop: '#6e5840', bg1: '#fbf6ea', bg2: '#efe4cf' },
  atelier: { paint: '#10b981', paintHi: '#6ee7b7', floor: '#ebf5f2', floorEdge: '#d4e6e0', wall: '#1f3a37', wallTop: '#335a55', bg1: '#eaf6f2', bg2: '#d6ebe4' },
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const now = () => performance.now();

export class Renderer {
  constructor(canvas, { fpsEl = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fpsEl = fpsEl;
    this.q = null;
    this.dpr = 1;
    this.adaptiveScale = 1;
    this.frameTimes = [];
    this.reducedMotion = false;
    this.board = null;
    this.paintAt = new Map(); // cell -> time painted (for the spread animation)
    this.ball = { x: 0, y: 0, sx: 1, sy: 1 };
    this.anim = null;
    this.shake = null;
    this.hintDir = null;
    this.celebrateAt = 0;
    this.particles = [];
    this.blobs = Array.from({ length: 7 }, (_, i) => ({ x: (i * 0.37) % 1, y: (i * 0.61) % 1, r: 0.12 + (i % 3) * 0.05, s: 0.6 + (i % 4) * 0.25 }));
    this.dirty = true;
    this.last = now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  setQuality(q) {
    this.q = q;
    this.adaptiveScale = 1;
    this.frameTimes = [];
    if (this.fpsEl) this.fpsEl.hidden = !q.showFps;
    this.resize();
  }

  setReducedMotion(on) { this.reducedMotion = on; this.dirty = true; }

  /** Loads a level: board geometry, palette and the painted state. */
  setLevel(board, state, paletteId) {
    this.board = board;
    this.pal = PALETTES[paletteId] || PALETTES.studio;
    this.particles = [];
    this.hintDir = null;
    this.celebrateAt = 0;
    this.setState(state);
    this.resize();
  }

  /** Jumps to a state without animation (restore, undo, restart). */
  setState(state) {
    if (this.anim) { const r = this.anim.resolve; this.anim = null; r(); }
    this.state = state;
    this.paintAt.clear();
    this.board.cells.forEach((c, i) => { if (state.painted[i]) this.paintAt.set(c, 0); });
    this.anim = null;
    this.hintDir = null;
    const [x, y] = this._xy(state.pos);
    this.ball = { x, y, sx: 1, sy: 1 };
    this.dirty = true;
  }

  resize() {
    if (!this.q || !this.board) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = pixelRatio(this.q, globalThis.devicePixelRatio || 1, this.adaptiveScale);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.cssW = rect.width;
    this.cssH = rect.height;
    const pad = 12;
    this.tile = Math.max(8, Math.floor(Math.min(84, (rect.width - pad * 2) / this.board.w, (rect.height - pad * 2 - 8) / this.board.h)));
    this.ox = Math.round((rect.width - this.tile * this.board.w) / 2);
    this.oy = Math.round((rect.height - this.tile * this.board.h - Math.max(4, this.tile * 0.2)) / 2);
    Object.assign(this.canvas.dataset, { tile: this.tile, ox: this.ox, oy: this.oy });
    this._bakeStatic();
    this.dirty = true;
  }

  /** Rendered size in device pixels (for the graphics summary). */
  get pixelSize() { return { w: this.canvas.width, h: this.canvas.height }; }

  /** Animates a roll; resolves when the ball comes to rest. */
  animateRoll(from, dir, path, newly, state) {
    const [fx, fy] = this._xy(from);
    const [tx, ty] = this._xy(path[path.length - 1]);
    const dur = this.reducedMotion ? 90 : Math.min(520, 110 + 55 * path.length);
    this.hintDir = null;
    return new Promise((resolve) => {
      this.anim = { fx, fy, tx, ty, dir, path, newly: new Set(newly), t0: now(), dur, resolve, state, idx: 0 };
      this.dirty = true;
    });
  }

  /** A blocked roll: the ball nudges toward the wall and springs back. */
  bump(dir) {
    if (this.reducedMotion) return;
    this.shake = { dir, t0: now() };
    this.dirty = true;
  }

  showHint(dir) { this.hintDir = dir; this.dirty = true; }

  celebrate() {
    this.celebrateAt = now();
    if (this.q && this.q.particles !== 'off' && !this.reducedMotion) {
      const n = this.q.particles === 'high' ? 90 : 36;
      for (let i = 0; i < n; i++) {
        const c = this.board.cells[Math.floor(Math.random() * this.board.cells.length)];
        const [x, y] = this._xy(c);
        this._spawn(x, y, (Math.random() - 0.5) * 0.12, -0.05 - Math.random() * 0.12, 900 + Math.random() * 600, true);
      }
    }
    this.dirty = true;
  }

  /* ---------------- internals ---------------- */

  _xy(cell) { const x = cell % this.board.w; return [x, (cell - x) / this.board.w]; }

  _spawn(x, y, vx, vy, life, confetti = false) {
    const budget = PARTICLE_BUDGET[this.q?.particles || 'off'];
    if (this.particles.length >= budget) return;
    this.particles.push({ x, y, vx, vy, t0: now(), life, r: 0.05 + Math.random() * 0.07, confetti, hue: Math.random() });
  }

  _bakeStatic() {
    const { board, tile: T, pal } = this;
    const c = (this.staticLayer ||= document.createElement('canvas'));
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.cssW, this.cssH);
    const shadows = this.q.shadows === 'on';
    const lift = Math.max(4, Math.round(T * 0.2));
    const W = T * board.w, H = T * board.h, r = Math.min(14, T * 0.35);
    const fl = (x, y) => x >= 0 && y >= 0 && x < board.w && y < board.h && board.floor[y * board.w + x] >= 0;
    // Raised slab: a darker front face under the top surface, with a soft drop shadow.
    if (shadows) { g.save(); g.shadowColor = 'rgba(20,20,40,.3)'; g.shadowBlur = Math.min(40, T * 0.7); g.shadowOffsetY = Math.min(18, T * 0.3); }
    g.fillStyle = pal.wall;
    this._round(g, this.ox, this.oy, W, H + lift, r);
    g.fill();
    if (shadows) g.restore();
    g.fillStyle = pal.wallTop;
    this._round(g, this.ox, this.oy, W, H, r);
    g.fill();
    const sheen = g.createLinearGradient(0, this.oy, 0, this.oy + H);
    sheen.addColorStop(0, 'rgba(255,255,255,.12)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    this._round(g, this.ox, this.oy, W, H, r);
    g.fill();
    // Corridors carved into the slab.
    for (const cell of board.cells) {
      const [x, y] = this._xy(cell);
      g.fillStyle = pal.floor;
      g.fillRect(this.ox + x * T, this.oy + y * T, T, T);
    }
    // Tile seams inside corridors.
    g.fillStyle = pal.floorEdge;
    for (const cell of board.cells) {
      const [x, y] = this._xy(cell);
      if (fl(x + 1, y)) g.fillRect(this.ox + (x + 1) * T - 0.5, this.oy + y * T + T * 0.2, 1, T * 0.6);
      if (fl(x, y + 1)) g.fillRect(this.ox + x * T + T * 0.2, this.oy + (y + 1) * T - 0.5, T * 0.6, 1);
    }
    // Depth: the wall's inner face shades the top and left edges of each corridor tile.
    for (const cell of board.cells) {
      const [x, y] = this._xy(cell);
      const px = this.ox + x * T, py = this.oy + y * T;
      if (!fl(x, y - 1)) {
        const gr = g.createLinearGradient(0, py, 0, py + lift * 1.4);
        gr.addColorStop(0, shadows ? 'rgba(25,20,40,.38)' : 'rgba(25,20,40,.22)');
        gr.addColorStop(1, 'rgba(25,20,40,0)');
        g.fillStyle = gr;
        g.fillRect(px, py, T, lift * 1.4);
      }
      if (!fl(x - 1, y)) {
        const gr = g.createLinearGradient(px, 0, px + lift, 0);
        gr.addColorStop(0, 'rgba(25,20,40,.18)');
        gr.addColorStop(1, 'rgba(25,20,40,0)');
        g.fillStyle = gr;
        g.fillRect(px, py, lift, T);
      }
    }
  }

  _round(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  _step(t) {
    let busy = false;
    const a = this.anim;
    if (a) {
      const k = Math.min(1, (t - a.t0) / a.dur);
      const e = ease(k);
      this.ball.x = a.fx + (a.tx - a.fx) * e;
      this.ball.y = a.fy + (a.ty - a.fy) * e;
      const speed = Math.sin(k * Math.PI);
      const horiz = a.dir === 'L' || a.dir === 'R';
      this.ball.sx = horiz ? 1 + 0.22 * speed : 1 - 0.12 * speed;
      this.ball.sy = horiz ? 1 - 0.12 * speed : 1 + 0.22 * speed;
      // Paint every tile the ball centre has reached.
      const travelled = Math.abs(this.ball.x - a.fx) + Math.abs(this.ball.y - a.fy);
      while (a.idx < a.path.length && travelled >= a.idx + 0.5) {
        const cell = a.path[a.idx++];
        if (a.newly.has(cell)) {
          this.paintAt.set(cell, t);
          if (!this.reducedMotion && Math.random() < 0.7) {
            const [cx, cy] = this._xy(cell);
            const [dx, dy] = DIRS[a.dir];
            this._spawn(cx, cy, -dx * 0.02 + (Math.random() - 0.5) * 0.03, -dy * 0.02 + (Math.random() - 0.5) * 0.03, 420);
          }
        }
      }
      if (k >= 1) {
        for (; a.idx < a.path.length; a.idx++) if (a.newly.has(a.path[a.idx])) this.paintAt.set(a.path[a.idx], t);
        this.ball.sx = 1; this.ball.sy = 1;
        this.anim = null;
        if (!this.reducedMotion) {
          const [dx, dy] = DIRS[a.dir];
          this.shake = { dir: a.dir, t0: t, soft: true };
          const n = a.newly.size ? 10 : 4;
          for (let i = 0; i < n; i++) {
            const ang = Math.random() * Math.PI * 2;
            this._spawn(a.tx + dx * 0.3, a.ty + dy * 0.3, Math.cos(ang) * 0.06 - dx * 0.04, Math.sin(ang) * 0.06 - dy * 0.04, 500);
          }
        }
        this.state = a.state;
        a.resolve();
      }
      busy = true;
    }
    if (this.shake) {
      const k = (t - this.shake.t0) / 260;
      if (k >= 1) this.shake = null;
      busy = true;
    }
    if (this.particles.length) {
      this.particles = this.particles.filter((p) => t - p.t0 < p.life);
      busy = true;
    }
    for (const v of this.paintAt.values()) if (v && t - v < 260) { busy = true; break; }
    if (this.celebrateAt && t - this.celebrateAt < 1400) busy = true;
    if (this.hintDir) busy = true;
    if (this.q?.ambient === 'on' && !this.reducedMotion) busy = true;
    return busy;
  }

  _loop(t) {
    requestAnimationFrame(this._loop);
    if (!this.board || !this.q || !this.staticLayer) return;
    const busy = this._step(t);
    if (!busy && !this.dirty) { this.last = t; return; }
    this.dirty = false;
    this._draw(t);
    this._measure(t);
  }

  _measure(t) {
    const dt = t - this.last;
    this.last = t;
    if (dt <= 0 || dt > 250) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((s, v) => s + v, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (this.fpsEl && this.q.showFps) this.fpsEl.textContent = `${Math.round(1000 / avg)} fps`;
    if (this.q.adaptive) {
      const next = adaptStep(avg, this.adaptiveScale);
      if (next !== this.adaptiveScale) { this.adaptiveScale = next; this.resize(); }
    }
  }

  _draw(t) {
    const g = this.ctx, T = this.tile, pal = this.pal;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.staticLayer, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const ambient = this.q.ambient === 'on' && !this.reducedMotion;
    if (ambient) {
      // Soft paint-coloured haze drifting behind the board edges.
      g.save();
      g.globalAlpha = 0.07;
      g.fillStyle = pal.paint;
      for (const b of this.blobs) {
        const x = ((b.x + Math.sin(t / 9000 * b.s) * 0.08) % 1) * this.cssW;
        const y = ((b.y + Math.cos(t / 11000 * b.s) * 0.08) % 1) * this.cssH;
        g.beginPath(); g.arc(x, y, b.r * Math.max(this.cssW, this.cssH), 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
    // Paint: each tile spreads from its centre when first painted.
    const glow = this.q.glow === 'on';
    const wave = this.celebrateAt ? (t - this.celebrateAt) / 900 : -1;
    const [bx0, by0] = this.state ? this._xy(this.state.pos) : [0, 0];
    for (const [cell, at] of this.paintAt) {
      const [x, y] = this._xy(cell);
      const k = at ? Math.min(1, (t - at) / 220) : 1;
      const px = this.ox + x * T, py = this.oy + y * T;
      const e = ease(k);
      const sw = T * (0.3 + 0.7 * e), sh = sw;
      g.fillStyle = pal.paint;
      this._round(g, px + (T - sw) / 2, py + (T - sh) / 2, sw, sh, T * 0.5 * (1 - e) + 0.5);
      g.fill();
      if (glow) {
        g.fillStyle = 'rgba(255,255,255,.16)';
        g.fillRect(px, py + T * 0.12, T, T * 0.12);
      }
      if (wave >= 0 && wave < 1.6) {
        const d = Math.hypot(x - bx0, y - by0) / Math.max(this.board.w, this.board.h);
        const w = Math.max(0, 1 - Math.abs(wave - d) * 5);
        if (w > 0) {
          g.fillStyle = `rgba(255,255,255,${0.45 * w})`;
          g.fillRect(px, py, T, T);
        }
      }
    }
    // Hint arrow beside the ball.
    if (this.hintDir && !this.anim) {
      const [dx, dy] = DIRS[this.hintDir];
      const pulse = 0.5 + 0.5 * Math.sin(t / 180);
      const cx = this.ox + (this.ball.x + 0.5 + dx * (0.85 + 0.12 * pulse)) * T;
      const cy = this.oy + (this.ball.y + 0.5 + dy * (0.85 + 0.12 * pulse)) * T;
      g.save();
      g.translate(cx, cy);
      g.rotate(Math.atan2(dy, dx));
      g.fillStyle = pal.wall;
      g.globalAlpha = 0.75;
      g.beginPath(); g.moveTo(T * 0.26, 0); g.lineTo(-T * 0.16, -T * 0.22); g.lineTo(-T * 0.16, T * 0.22); g.closePath(); g.fill();
      g.restore();
    }
    // Particles: paint droplets and confetti.
    for (const p of this.particles) {
      const age = (t - p.t0) / p.life;
      const x = this.ox + (p.x + 0.5 + p.vx * (t - p.t0) / 16) * T;
      const y = this.oy + (p.y + 0.5 + p.vy * (t - p.t0) / 16 + (p.confetti ? 0.5 * age * age * 6 : 0)) * T;
      g.globalAlpha = 1 - age;
      g.fillStyle = p.confetti ? (p.hue < 0.5 ? pal.paint : pal.paintHi) : pal.paint;
      g.beginPath(); g.arc(x, y, p.r * T * (p.confetti ? 1.2 : 1 - age * 0.5), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // Ball.
    let bx = this.ball.x, by = this.ball.y, sx = this.ball.sx, sy = this.ball.sy;
    if (this.shake) {
      const k = (t - this.shake.t0) / 260;
      const [dx, dy] = DIRS[this.shake.dir];
      const amp = (this.shake.soft ? 0.05 : 0.14) * Math.sin(k * Math.PI) * (1 - k);
      bx += dx * amp; by += dy * amp;
      const sq = (this.shake.soft ? 0.14 : 0.2) * Math.sin(k * Math.PI);
      if (dx) { sx = 1 - sq; sy = 1 + sq * 0.6; } else { sy = 1 - sq; sx = 1 + sq * 0.6; }
    }
    const cx = this.ox + (bx + 0.5) * T, cy = this.oy + (by + 0.5) * T, r = T * 0.34;
    if (this.q.shadows === 'on') {
      g.fillStyle = 'rgba(20,20,40,.25)';
      g.beginPath(); g.ellipse(cx + r * 0.15, cy + r * 0.75, r * 0.85 * sx, r * 0.32, 0, 0, Math.PI * 2); g.fill();
    }
    g.save();
    g.translate(cx, cy);
    g.scale(sx, sy);
    if (glow) { g.shadowColor = pal.paint; g.shadowBlur = T * 0.5; }
    const grad = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    grad.addColorStop(0, pal.paintHi);
    grad.addColorStop(1, pal.paint);
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(0,0,0,.18)';
    g.lineWidth = Math.max(1, T * 0.03);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.beginPath(); g.ellipse(-r * 0.35, -r * 0.4, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2); g.fill();
    g.restore();
  }
}
