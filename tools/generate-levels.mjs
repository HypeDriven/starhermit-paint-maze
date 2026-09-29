// Generates data/levels.json: three hand-authored teaching levels, then
// seeded corridor mazes carved by random rolls. Every level is solved by BFS;
// its par is the optimal move count and its solution is stored for tests.
// Usage: node tools/generate-levels.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevel, createState, solve, DIRS, DIR_KEYS } from '../src/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TUTORIAL = [
  { rows: ['#######', '#.....#', '#######'], start: [1, 1] },
  { rows: ['#####', '#...#', '###.#', '###.#', '#####'], start: [1, 1] },
  { rows: ['#####', '#...#', '#.#.#', '#...#', '#####'], start: [1, 1] },
];

const WORLDS = [
  { id: 'studio', w: 7, h: 7, count: 12, floor: [11, 21], par: [3, 7], segs: [4, 7], open2x2: 0 },
  { id: 'gallery', w: 9, h: 9, count: 15, floor: [20, 34], par: [6, 11], segs: [7, 11], open2x2: 1 },
  { id: 'workshop', w: 11, h: 11, count: 15, floor: [30, 48], par: [9, 15], segs: [10, 15], open2x2: 2 },
  { id: 'atelier', w: 11, h: 13, count: 15, floor: [40, 60], par: [12, 19], segs: [13, 19], open2x2: 3 },
];

function carve(rng, W) {
  const { w, h } = W;
  const g = Array.from({ length: h }, () => Array(w).fill('#'));
  let x = 1 + Math.floor(rng() * (w - 2)), y = 1 + Math.floor(rng() * (h - 2));
  const start = [x, y];
  g[y][x] = '.';
  const segs = W.segs[0] + Math.floor(rng() * (W.segs[1] - W.segs[0] + 1));
  let last = null;
  for (let s = 0; s < segs; s++) {
    const options = DIR_KEYS.filter((d) => {
      const [dx, dy] = DIRS[d];
      return x + dx >= 1 && x + dx <= w - 2 && y + dy >= 1 && y + dy <= h - 2 && d !== last;
    });
    const d = options[Math.floor(rng() * options.length)];
    const [dx, dy] = DIRS[d];
    let max = 0;
    while (x + dx * (max + 1) >= 1 && x + dx * (max + 1) <= w - 2 && y + dy * (max + 1) >= 1 && y + dy * (max + 1) <= h - 2) max++;
    const len = 1 + Math.floor(rng() * max);
    for (let i = 0; i < len; i++) { x += dx; y += dy; g[y][x] = '.'; }
    last = d;
  }
  return { rows: g.map((r) => r.join('')), start };
}

function open2x2(rows) {
  let n = 0;
  for (let y = 0; y < rows.length - 1; y++)
    for (let x = 0; x < rows[0].length - 1; x++)
      if (rows[y][x] === '.' && rows[y][x + 1] === '.' && rows[y + 1][x] === '.' && rows[y + 1][x + 1] === '.') n++;
  return n;
}

const canon = (lv) => lv.rows.join('/');

/** Trims all-wall rows/columns so exactly one wall border surrounds the floor. */
function crop(lv) {
  const ys = [], xs = [];
  lv.rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '.') { ys.push(y); xs.push(x); } }));
  const y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1, x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1;
  const rows = lv.rows.slice(y0, y1 + 1).map((r) => r.slice(x0, x1 + 1));
  return { ...lv, w: x1 - x0 + 1, h: y1 - y0 + 1, rows, start: [lv.start[0] - x0, lv.start[1] - y0] };
}

function build(W, rng, seen) {
  const found = [];
  let tries = 0;
  while (found.length < W.count * 3 && tries < 200000) {
    tries++;
    const lv = carve(rng, W);
    const floorCount = lv.rows.join('').split('.').length - 1;
    if (floorCount < W.floor[0] || floorCount > W.floor[1]) continue;
    if (open2x2(lv.rows) > W.open2x2) continue;
    if (seen.has(canon(lv))) continue;
    const board = parseLevel({ w: W.w, h: W.h, ...lv });
    const sol = solve(board, createState(board), 400000);
    if (sol === null || sol.length < W.par[0] || sol.length > W.par[1]) continue;
    seen.add(canon(lv));
    found.push({ ...lv, par: sol.length, solution: sol, floorCount });
  }
  if (found.length < W.count) throw new Error(`${W.id}: only ${found.length} levels after ${tries} tries`);
  // Spread across the difficulty range, then order easiest → hardest.
  found.sort((a, b) => a.par - b.par || a.floorCount - b.floorCount);
  const picked = [];
  for (let i = 0; i < W.count; i++) picked.push(found[Math.floor((i * (found.length - 1)) / (W.count - 1))]);
  return picked;
}

const rng = mulberry32(0x9a17e);
const seen = new Set();
const levels = [];
for (const [i, t] of TUTORIAL.entries()) {
  const lv = { w: t.rows[0].length, h: t.rows.length, ...t };
  const board = parseLevel(lv);
  const sol = solve(board, createState(board));
  levels.push({ id: `studio-${i + 1}`, world: 'studio', ...lv, par: sol.length, solution: sol });
  seen.add(canon(lv));
}
for (const W of WORLDS) {
  const offset = W.id === 'studio' ? TUTORIAL.length : 0;
  build(W, rng, seen).forEach((lv, i) => {
    const c = crop({ w: W.w, h: W.h, rows: lv.rows, start: lv.start });
    levels.push({ id: `${W.id}-${i + 1 + offset}`, world: W.id, w: c.w, h: c.h, rows: c.rows, start: c.start, par: lv.par, solution: lv.solution });
  });
}

const out = { version: 1, worlds: WORLDS.map((W) => W.id), levels };
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'levels.json'), JSON.stringify(out, null, 1) + '\n');
const pars = (id) => levels.filter((l) => l.world === id).map((l) => l.par).join(',');
console.log(`wrote ${levels.length} levels`);
for (const W of WORLDS) console.log(`  ${W.id}: par ${pars(W.id)}`);
