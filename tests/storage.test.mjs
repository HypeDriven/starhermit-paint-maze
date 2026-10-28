import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProfile, recordResult, cloudDoc, mergeRemote, readDoc, readForeign, mergeDocs, sameDoc } from '../src/storage.js';

test('recordResult keeps the best moves and most stars', () => {
  const p = emptyProfile();
  assert.equal(recordResult(p, 'a', 8, 1), true);
  assert.equal(recordResult(p, 'a', 5, 3), true);
  assert.equal(recordResult(p, 'a', 9, 1), false);
  assert.deepEqual(p.progress.a, { best: 5, stars: 3 });
});

test('mergeRemote: best results win, this device\'s in-progress level is kept, junk ignored', () => {
  const p = emptyProfile();
  recordResult(p, 'a', 5, 3);
  recordResult(p, 'b', 9, 1);
  p.current = { id: 'b', dirs: 'R' };
  const doc = cloudDoc(emptyProfile());
  doc.progress = { a: { best: 7, stars: 2 }, b: { best: 6, stars: 3 }, c: { best: 4, stars: 3 }, d: { best: 'x' } };
  doc.current = { id: 'c', dirs: 'UD' };
  assert.equal(mergeRemote(p, doc), true);
  assert.deepEqual(p.progress, { a: { best: 5, stars: 3 }, b: { best: 6, stars: 3 }, c: { best: 4, stars: 3 } });
  assert.deepEqual(p.current, { id: 'b', dirs: 'R' });
  p.current = null;
  mergeRemote(p, doc);
  assert.deepEqual(p.current, { id: 'c', dirs: 'UD' }); // the cloud's level only when none is in progress here
  assert.equal(mergeRemote(p, { v: 1 }), false);
});

test('readDoc reads a saved document and drops junk; anything else is a fresh profile', () => {
  const p = readDoc({ v: 2, progress: { a: { best: 3, stars: 3 }, b: null }, current: { id: 'a', dirs: 'LR' }, tutorialSeen: { t1: true } });
  assert.deepEqual(p.progress, { a: { best: 3, stars: 3 } });
  assert.deepEqual(p.current, { id: 'a', dirs: 'LR' });
  assert.deepEqual(p.tutorialSeen, { t1: true });
  assert.deepEqual(readDoc(null), emptyProfile());
  assert.deepEqual(readDoc('nope'), emptyProfile());
});

test('the browser build\'s cloud save (writeSave of the JSON text) migrates', () => {
  const old = JSON.stringify({ v: 2, progress: { 'studio-1': { best: 1, stars: 3 }, 'studio-2': { best: 4, stars: 1 } }, current: { id: 'studio-3', dirs: 'D' }, tutorialSeen: {} });
  const p = readForeign(old);
  assert.equal(p.progress['studio-2'].stars, 1);
  assert.deepEqual(p.current, { id: 'studio-3', dirs: 'D' });
  assert.equal(readForeign('{broken'), null);
  assert.equal(readForeign(JSON.stringify({ v: 1, progress: {} })), null);
  assert.equal(readForeign(null), null);
});

test('mergeDocs (a conflict between devices) keeps the best of both and the local level in progress', () => {
  const local = { v: 2, progress: { a: { best: 5, stars: 2 } }, current: { id: 'b', dirs: 'U' }, tutorialSeen: {} };
  const remote = { v: 2, progress: { a: { best: 4, stars: 3 }, c: { best: 9, stars: 1 } }, current: { id: 'c', dirs: 'L' }, tutorialSeen: { x: true } };
  const m = mergeDocs(local, remote);
  assert.deepEqual(m.progress, { a: { best: 4, stars: 3 }, c: { best: 9, stars: 1 } });
  assert.deepEqual(m.current, { id: 'b', dirs: 'U' });
  assert.deepEqual(m.tutorialSeen, { x: true });
  assert.ok(sameDoc(mergeDocs(m, m), m));
  assert.ok(sameDoc({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }));
  assert.ok(!sameDoc({ a: 1 }, { a: 2 }));
});
