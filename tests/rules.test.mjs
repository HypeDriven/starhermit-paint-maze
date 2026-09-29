import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/rules.js';

const ring = { w: 5, h: 5, rows: ['#####', '#...#', '#.#.#', '#...#', '#####'], start: [1, 1] };

test('parseLevel indexes floor tiles and rejects bad input', () => {
  const b = R.parseLevel(ring);
  assert.equal(b.cells.length, 8);
  assert.equal(b.start, 6);
  assert.throws(() => R.parseLevel({ ...ring, start: [0, 0] }), /start/);
  assert.throws(() => R.parseLevel({ ...ring, h: 4 }), /size/);
});

test('a roll slides to the wall and paints every tile it crosses', () => {
  const b = R.parseLevel(ring);
  const s0 = R.createState(b);
  assert.equal(s0.remaining, 7);
  const r = R.roll(b, s0, 'R');
  assert.deepEqual(r.path, [7, 8]);
  assert.deepEqual(r.newly, [7, 8]);
  assert.equal(r.state.pos, 8);
  assert.equal(r.state.remaining, 5);
  assert.equal(r.state.moves, 1);
  assert.equal(s0.moves, 0, 'input state is not mutated');
});

test('blocked rolls return null and legalDirs lists open directions', () => {
  const b = R.parseLevel(ring);
  const s = R.createState(b);
  assert.equal(R.roll(b, s, 'U'), null);
  assert.equal(R.roll(b, s, 'L'), null);
  assert.deepEqual(R.legalDirs(b, s), ['D', 'R']);
});

test('rolling over painted tiles costs a move but paints nothing new', () => {
  const b = R.parseLevel(ring);
  let s = R.roll(b, R.createState(b), 'R').state;
  const back = R.roll(b, s, 'L');
  assert.deepEqual(back.newly, []);
  assert.equal(back.state.moves, 2);
  assert.equal(back.state.remaining, s.remaining);
});

test('solve finds the optimal sequence and replay confirms completion', () => {
  const b = R.parseLevel(ring);
  const sol = R.solve(b, R.createState(b));
  assert.equal(sol.length, 4);
  assert.ok(R.isComplete(R.replay(b, sol)));
  assert.equal(R.solve(b, R.replay(b, sol)), '');
});

test('solve continues from a mid-level position and reports impossible boards', () => {
  const lv = { w: 5, h: 4, rows: ['#####', '#...#', '#.###', '#####'], start: [3, 1] };
  const b = R.parseLevel(lv);
  assert.equal(R.solve(b, R.createState(b)), 'LD');
  assert.equal(R.solve(b, R.replay(b, 'L')), 'D');
  const split = R.parseLevel({ w: 5, h: 3, rows: ['#####', '#.#.#', '#####'], start: [1, 1] });
  assert.equal(R.solve(split, R.createState(split)), null);
});

test('starsFor rates against par', () => {
  assert.equal(R.starsFor(5, 5), 3);
  assert.equal(R.starsFor(4, 5), 3);
  assert.equal(R.starsFor(7, 5), 2);
  assert.equal(R.starsFor(8, 5), 1);
});

test('snapshot/restore round-trips and rejects foreign snapshots', () => {
  const b = R.parseLevel(ring);
  const s = R.replay(b, 'RD');
  const back = R.restore(b, JSON.parse(JSON.stringify(R.snapshot(s))));
  assert.deepEqual(back, { ...s, painted: back.painted });
  assert.deepEqual(Array.from(back.painted), Array.from(s.painted));
  assert.equal(R.restore(b, { pos: 0, painted: [], moves: 0 }), null);
  assert.equal(R.restore(b, { ...R.snapshot(s), pos: 0 }), null);
});
