/* Fails if any key is missing, empty, or has different {placeholders} in any language,
   or if a page or script asks for a key that the dictionary does not define. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const LANGS = ['en', 'ko', 'ja', 'zh', 'es'];
const sb = { window: {}, navigator: { language: 'en' } };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8'), sb);
const DICT = sb.window.QN_I18N;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const placeholders = (s) => (String(s).match(/\{[a-zA-Z]+\}/g) || []).slice().sort().join(',');

test('i18n: all five languages are present', () => {
  assert.deepEqual(Object.keys(DICT).sort(), [...LANGS].sort());
});

test('i18n: every language defines every English key, with a non-empty value', () => {
  const keys = Object.keys(DICT.en);
  for (const lang of LANGS) {
    const missing = keys.filter((k) => !(k in DICT[lang]));
    assert.deepEqual(missing, [], lang + ' is missing keys');
    const empty = keys.filter((k) => typeof DICT[lang][k] !== 'string' || DICT[lang][k].trim() === '');
    assert.deepEqual(empty, [], lang + ' has empty values');
    const extra = Object.keys(DICT[lang]).filter((k) => !(k in DICT.en));
    assert.deepEqual(extra, [], lang + ' has keys that English lacks');
  }
});

test('i18n: placeholders match English in every language', () => {
  for (const lang of LANGS) {
    for (const k of Object.keys(DICT.en)) {
      assert.equal(placeholders(DICT[lang][k]), placeholders(DICT.en[k]), lang + ' ' + k);
    }
  }
});

test('i18n: no emoji in any user-visible string', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}✨]/u;
  for (const lang of LANGS) for (const k of Object.keys(DICT[lang])) assert.ok(!emoji.test(DICT[lang][k]), lang + ' ' + k);
});

test('i18n: every data-t key in a page exists in every language', () => {
  const pages = ['index.html', 'privacy.html', 'terms.html', 'app/index.html'];
  const used = new Set();
  for (const f of pages) for (const m of read(f).matchAll(/data-t(?:-body)?="([^"]+)"/g)) used.add(m[1]);
  assert.ok(used.size > 10, 'expected data-t keys in the pages');
  for (const k of used) for (const lang of LANGS) assert.ok(k in DICT[lang], lang + ' missing page key ' + k);
});

test('i18n: every literal t() key the app asks for exists in every language', () => {
  const src = read('app/app.js') + read('app/core.js') + read('landing.js');
  const used = new Set([...src.matchAll(/\bt\(\s*'([a-zA-Z0-9_]+)'\s*[,)]/g)].map((m) => m[1]));
  assert.ok(used.size > 20);
  for (const k of used) for (const lang of LANGS) assert.ok(k in DICT[lang], lang + ' missing app key ' + k);
});

test('i18n: prefixed keys built at run time exist (op_ labels)', () => {
  for (const k of ['blank', 'spaces', 'duplicate', 'filler', 'stack']) {
    for (const lang of LANGS) assert.ok(('op_' + k) in DICT[lang], lang + ' missing op_' + k);
  }
});
