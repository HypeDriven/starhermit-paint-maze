import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProfile, loadProfile, saveProfile, recordResult, cloudDoc, mergeRemote } from '../src/storage.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('profile round-trips through storage; corrupt data starts fresh', () => {
  const st = mem();
  const p = emptyProfile();
  recordResult(p, 'studio-1', 1, 3);
  saveProfile(p, st);
  assert.deepEqual(loadProfile(st).progress, { 'studio-1': { best: 1, stars: 3 } });
  st.setItem('paint-maze:v2', '{broken');
  assert.deepEqual(loadProfile(st).progress, {});
});

test('recordResult keeps the best moves and most stars', () => {
  const p = emptyProfile();
  assert.equal(recordResult(p, 'a', 8, 1), true);
  assert.equal(recordResult(p, 'a', 5, 3), true);
  assert.equal(recordResult(p, 'a', 9, 1), false);
  assert.deepEqual(p.progress.a, { best: 5, stars: 3 });
});

test('mergeRemote: best results win, remote in-progress level is preferred, junk ignored', () => {
  const p = emptyProfile();
  recordResult(p, 'a', 5, 3);
  recordResult(p, 'b', 9, 1);
  p.current = { id: 'b', dirs: 'R' };
  const doc = cloudDoc(emptyProfile());
  doc.progress = { a: { best: 7, stars: 2 }, b: { best: 6, stars: 3 }, c: { best: 4, stars: 3 }, d: { best: 'x' } };
  doc.current = { id: 'c', dirs: 'UD' };
  assert.equal(mergeRemote(p, doc), true);
  assert.deepEqual(p.progress, { a: { best: 5, stars: 3 }, b: { best: 6, stars: 3 }, c: { best: 4, stars: 3 } });
  assert.deepEqual(p.current, { id: 'c', dirs: 'UD' });
  assert.equal(mergeRemote(p, { v: 1 }), false);
});
