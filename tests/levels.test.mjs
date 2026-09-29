import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as R from '../src/rules.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/levels.json', import.meta.url)));

test('level set shape: 60 levels in four worlds of 15, unique ids and layouts', () => {
  assert.deepEqual(data.worlds, ['studio', 'gallery', 'workshop', 'atelier']);
  assert.equal(data.levels.length, 60);
  for (const w of data.worlds) assert.equal(data.levels.filter((l) => l.world === w).length, 15);
  assert.equal(new Set(data.levels.map((l) => l.id)).size, 60);
  assert.equal(new Set(data.levels.map((l) => l.rows.join('/'))).size, 60);
});

test('every level is enclosed, solvable by its stored solution, and par is optimal', () => {
  for (const lv of data.levels) {
    const b = R.parseLevel(lv);
    for (let x = 0; x < lv.w; x++) assert.ok(lv.rows[0][x] === '#' && lv.rows[lv.h - 1][x] === '#', lv.id);
    for (let y = 0; y < lv.h; y++) assert.ok(lv.rows[y][0] === '#' && lv.rows[y][lv.w - 1] === '#', lv.id);
    const end = R.replay(b, lv.solution);
    assert.ok(end && R.isComplete(end), `${lv.id} solution completes`);
    assert.equal(lv.solution.length, lv.par, `${lv.id} par matches solution`);
    assert.equal(R.solve(b, R.createState(b)).length, lv.par, `${lv.id} par is optimal`);
  }
});

test('difficulty never drops sharply within a world and boards fit a phone', () => {
  for (const w of data.worlds) {
    const pars = data.levels.filter((l) => l.world === w).map((l) => l.par);
    for (let i = 1; i < pars.length; i++) assert.ok(pars[i] >= pars[i - 1] - 1, `${w} par ${pars}`);
  }
  for (const lv of data.levels) assert.ok(lv.w <= 11 && lv.h <= 13, lv.id);
});
