import test from 'node:test';
import assert from 'node:assert/strict';
import { zipStore, unzipFirstEntry, bytesToBase64, base64ToBytes, decodeJwtPayload, boot } from '../src/platform.js';

test('cloud-save zip round-trips through base64', () => {
  const data = new TextEncoder().encode(JSON.stringify({ v: 2, progress: { 'studio-1': { best: 1, stars: 3 } } }));
  const zip = zipStore('save.json', data);
  assert.equal(new DataView(zip.buffer).getUint32(0, true), 0x04034b50);
  const back = unzipFirstEntry(base64ToBytes(bytesToBase64(zip)));
  assert.deepEqual(Array.from(back), Array.from(data));
  assert.throws(() => unzipFirstEntry(new Uint8Array(40)), /bad zip/);
});

test('decodeJwtPayload reads the claims and rejects malformed tokens', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  assert.deepEqual(decodeJwtPayload(`${b64({ alg: 'none' })}.${b64({ sub: 'u1', game_scope: 'paint-maze' })}.sig`), { sub: 'u1', game_scope: 'paint-maze' });
  assert.equal(decodeJwtPayload('nope'), null);
});

test('boot is a no-op outside a browser (offline play untouched)', () => {
  assert.equal(boot({}), false);
});
