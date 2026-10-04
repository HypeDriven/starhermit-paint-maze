// Platform adapter over the shared StarHermit SDK: launch token, profile
// name, game:<slug> cloud-save round-trip, settings KV, controls, and no
// network at all when standalone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Load the shipped SDK copy as a classic script (the package is ESM).
const sdkModule = { exports: {} };
new Function('module', 'self', fs.readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(sdkModule, globalThis);
const SDK = sdkModule.exports;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = 'h.' + b64u({ sub: 'user-123456', game_scope: 'pm-slug', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.s';

// SDK renewal timers must not keep the test process alive.
const unrefTimeout = (f, ms) => { const t = setTimeout(f, ms); t.unref(); return t; };

function fakeServer() {
  const calls = [], saves = {}, kv = {};
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push([method, url]);
    const r = (status, body) => new Response(body == null ? null : body, { status });
    if (url.includes('/cloud-saves/')) {
      const key = decodeURIComponent(url.split('/cloud-saves/')[1]);
      if (method === 'PUT') { saves[key] = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return r(200, '{}'); }
      return saves[key] ? r(200, saves[key]) : r(404);
    }
    if (url.endsWith('/profile')) return r(200, JSON.stringify({ username: 'u', nickname: 'Tess' }));
    if (url.endsWith('/settings') && method === 'PATCH') { Object.assign(kv, JSON.parse(init.body).settings); return r(200, '{}'); }
    if (url.endsWith('/settings')) return r(200, JSON.stringify({ settings: kv }));
    if (url.endsWith('/controls')) return r(200, JSON.stringify({ actions: [{ action: 'hint', codes: ['KeyJ'] }] }));
    return r(404);
  };
  return { calls, saves, kv, fetch };
}

function install(hash, srv, hostname = 'pm-slug.starhermit.com') {
  const win = {
    location: { hash, search: '', pathname: '/', hostname, origin: 'https://' + hostname, href: 'https://' + hostname + '/' },
    history: { replaceState() {} },
    addEventListener() {},
  };
  win.StarHermit = SDK.create({ window: win, fetch: srv.fetch, setTimeout: unrefTimeout });
  globalThis.window = win;
  globalThis.location = win.location;
  globalThis.fetch = srv.fetch; // any direct request is counted too
  return win;
}

globalThis.document = { addEventListener() {}, hidden: false };
const tick = () => new Promise((r) => setTimeout(r, 15));

test('hosted: token, profile, cloud save game:<slug>, settings, controls', async () => {
  const srv = fakeServer();
  install('#game_token=' + token, srv, 'pm-slug.starhermit.com');
  const P = await import('../src/platform.js?hosted');
  let name = null, remote = null;
  assert.equal(P.boot({ onName: (n) => { name = n; }, onRemote: (d) => { remote = d; } }), true);
  assert.equal(globalThis.window.StarHermit.userId, 'user-123456');
  await tick();
  assert.equal(name, 'Tess');
  assert.equal(remote, null); // no save yet

  P.pushCloud(() => ({ v: 2, progress: { 'studio-1': { best: 1, stars: 3 } } }));
  await P.flushCloud();
  assert.deepEqual(Object.keys(srv.saves), ['game:pm-slug']);
  assert.deepEqual(await globalThis.window.StarHermit.loadJSON(), { v: 2, progress: { 'studio-1': { best: 1, stars: 3 } } });

  P.patchSettings({ volume: 0.4 });
  await tick();
  assert.equal(srv.kv.volume, 0.4);
  assert.deepEqual(await P.getSettings(), { volume: 0.4 });

  assert.deepEqual(await P.loadBindings({ hint: ['KeyH'], undo: ['KeyU'] }), { hint: ['KeyJ'], undo: ['KeyU'] });
  assert.ok(P.inviteLink().endsWith('/game-invite/user-123456/pm-slug'));
  assert.equal(P.canSignIn(), false);
});

test('standalone: no token means no fetch at all', async () => {
  const srv = fakeServer();
  install('', srv, 'localhost');
  const P = await import('../src/platform.js?standalone');
  assert.equal(P.boot({}), false);
  P.pushCloud(() => ({ v: 2, progress: {} }));
  await P.flushCloud();
  P.patchSettings({ volume: 1 });
  assert.equal(await P.getSettings(), null);
  assert.deepEqual(await P.loadBindings({ hint: ['KeyH'] }), { hint: ['KeyH'] });
  assert.equal(P.inviteLink(), null);
  assert.equal(P.canSignIn(), false);
  await tick();
  assert.equal(srv.calls.length, 0);
});

test('boot is a no-op outside a browser', async () => {
  const saved = { window: globalThis.window, document: globalThis.document };
  delete globalThis.window; delete globalThis.document;
  const P = await import('../src/platform.js?bare');
  assert.equal(P.boot({}), false);
  Object.assign(globalThis, saved);
});
