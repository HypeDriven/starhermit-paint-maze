import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, LOCALES, matchLocale, setLocale, t } from '../src/i18n.js';

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

test('matchLocale maps browser tags to supported locales', () => {
  assert.equal(matchLocale('es-MX'), 'es-419');
  assert.equal(matchLocale('es-ES'), 'es-ES');
  assert.equal(matchLocale('fr-CA'), 'fr-CA');
  assert.equal(matchLocale('fr-BE'), 'fr-FR');
  assert.equal(matchLocale('en-AU'), 'en-GB');
  assert.equal(matchLocale('pt-PT'), 'pt-BR');
  assert.equal(matchLocale('ja-JP'), 'en-US');
});

test('t fills placeholders', () => {
  setLocale('de-DE');
  assert.equal(t('completeSub', { moves: 4, par: 3 }), '4 Züge · Par 3');
  setLocale('en-US');
});
