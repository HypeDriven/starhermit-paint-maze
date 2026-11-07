import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STRINGS = JSON.parse(readFileSync(new URL('../assets/strings.json', import.meta.url), 'utf8'));
const LOCALES = Object.keys(STRINGS);

test('every locale defines every key with the same placeholders', () => {
  const en = STRINGS['en-US'];
  const slots = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const loc of LOCALES) {
    for (const k of Object.keys(en)) {
      assert.ok(typeof STRINGS[loc][k] === 'string' && STRINGS[loc][k].length, `${loc} missing ${k}`);
      assert.equal(slots(STRINGS[loc][k]), slots(en[k]), `${loc} ${k} placeholders`);
    }
  }
});

test('the tables translate', () => {
  assert.equal(STRINGS['de-DE'].completeSub, '{moves} Züge · Par {par}');
  assert.equal(LOCALES.length, 9);
});

test('every key the engine client uses exists in all nine locales, and no table row is unused', async () => {
  const fs = await import('node:fs');
  const root = new URL('..', import.meta.url);
  const keys = new Set();
  for (const f of fs.readdirSync(new URL('native/', root))) {
    const src = fs.readFileSync(new URL('native/' + f, root), 'utf8');
    for (const m of src.matchAll(/(?<![\w.$])t\(\s*"([\w.-]*[\w-])"/g)) keys.add(m[1]);
  }
  // Keys chosen at runtime (main.ts / screens.ts): directions, worlds, HUD labels, tips, Play/Continue, the sync pill.
  for (const d of ['U', 'D', 'L', 'R']) keys.add('dir.' + d);
  for (const w of ['studio', 'gallery', 'workshop', 'atelier']) keys.add('world.' + w);
  for (const k of ['moves', 'par', 'left', 'tut1', 'tut2', 'tut3', 'tutWorld', 'play', 'continue', 'syncSaving', 'syncSynced', 'syncError']) keys.add(k);
  assert.ok(keys.size > 40, `only ${keys.size} keys`);
  for (const loc of LOCALES) {
    const missing = [...keys].filter((k) => typeof STRINGS[loc][k] !== 'string');
    assert.deepEqual(missing, [], `${loc} missing keys`);
  }
  assert.deepEqual(Object.keys(STRINGS['en-US']).filter((k) => !keys.has(k)), [], 'unused rows');
});
