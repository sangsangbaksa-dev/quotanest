const test = require('node:test');
const assert = require('node:assert/strict');
const QN = require('../app/core.js');

const HOUR = 3600e3, DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);

/* One record per `hours` step, each `tokens` big, ending at NOW. */
function series(count, stepHours, tokens, startAgoHours) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ ts: NOW - (startAgoHours + i * stepHours) * HOUR, input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, source: 'manual' });
  }
  return out;
}

test('usageSummary: weekly windows, trend and block statistics', () => {
  // 10 records in the last 7 days (1000 each), 5 records in the 7 days before (2000 each).
  const recs = series(10, 2, 1000, 1).concat(series(5, 4, 2000, 24 * 7 + 1));
  const s = QN.usageSummary({ records: recs, now: NOW, metric: 'io', blockLimit: 0, weekLimit: 0 });
  assert.equal(s.hasData, true);
  assert.equal(s.records, 15);
  assert.equal(s.last7, 10000);
  assert.equal(s.prev7, 10000);
  assert.equal(s.trendPct, 0);
  assert.equal(s.nearBlocks, null);
});

test('usageSummary: empty history and records outside 28 days are ignored', () => {
  const empty = QN.usageSummary({ records: [], now: NOW, metric: 'io' });
  assert.equal(empty.hasData, false);
  assert.equal(QN.suggestLimits(empty), null);
  const old = QN.usageSummary({ records: [{ ts: NOW - 40 * DAY, input: 5000, output: 0, cacheRead: 0, cacheWrite: 0 }], now: NOW, metric: 'io' });
  assert.equal(old.hasData, false);
});

test('usageSummary: counts blocks at 80% or more of the block limit', () => {
  const recs = [
    { ts: NOW - 1 * HOUR, input: 900, output: 0, cacheRead: 0, cacheWrite: 0 },   // block A: 900
    { ts: NOW - 10 * HOUR, input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },  // block B: 100
    { ts: NOW - 20 * HOUR, input: 850, output: 0, cacheRead: 0, cacheWrite: 0 }   // block C: 850
  ];
  const s = QN.usageSummary({ records: recs, now: NOW, metric: 'io', blockLimit: 1000 });
  assert.equal(s.blocks, 3);
  assert.equal(s.nearBlocks, 2);
  assert.equal(s.blockMax, 900);
});

test('metric all includes cache tokens', () => {
  const recs = [{ ts: NOW - HOUR, input: 1, output: 1, cacheRead: 10, cacheWrite: 10 }];
  assert.equal(QN.usageSummary({ records: recs, now: NOW, metric: 'io' }).last7, 2);
  assert.equal(QN.usageSummary({ records: recs, now: NOW, metric: 'all' }).last7, 22);
});

test('suggestLimits: 90th percentile block and busiest week, with 10% headroom rounded up to 1000', () => {
  const summary = { hasData: true, blockP90: 11640, weekly: [135660, 206220, 276780, 189840] };
  const g = QN.suggestLimits(summary);
  assert.deepEqual(g, { block: 13000, week: 305000 });
  assert.equal(QN.suggestLimits({ hasData: true, blockP90: 0, weekly: [0, 0, 0, 0] }), null);
});

test('localAdvice: ids and numbers for trend, limit hits and suggestion', () => {
  const summary = { hasData: true, trendPct: 0.42, nearBlocks: 3 };
  const advice = QN.localAdvice(summary, { block: 13000, week: 305000 });
  assert.deepEqual(advice, [
    { id: 'trend_up', p: 42 },
    { id: 'near', n: 3 },
    { id: 'suggest', block: 13000, week: 305000 }
  ]);
  assert.deepEqual(QN.localAdvice({ hasData: true, trendPct: -0.5, nearBlocks: null }, null), [
    { id: 'trend_down', p: 50 }, { id: 'no_limit' }, { id: 'suggest_none' }
  ]);
  assert.deepEqual(QN.localAdvice({ hasData: false }, null), [{ id: 'none' }]);
  assert.equal(QN.localAdvice({ hasData: true, trendPct: null, nearBlocks: 0 }, null)[0].id, 'trend_none');
  assert.equal(QN.localAdvice({ hasData: true, trendPct: 0.05, nearBlocks: 0 }, null)[0].id, 'trend_flat');
});

test('sanitizeText: strips control characters, collapses blanks and caps length', () => {
  assert.equal(QN.sanitizeText('a\u0007b   c'), 'a b c');
  assert.equal(QN.sanitizeText('x\n\n\n\ny'), 'x\n\ny');
  assert.equal(QN.sanitizeText('abcdef', 3), 'abc');
  assert.equal(QN.sanitizeText(null), '');
});

test('buildUsagePrompt: numbers only, names the reply language, no records or timestamps', () => {
  const recs = series(3, 1, 4321, 1);
  const summary = QN.usageSummary({ records: recs, now: NOW, metric: 'io', blockLimit: 9000 });
  const p = QN.buildUsagePrompt(summary, { block: 13000, week: 305000 }, 'ko');
  assert.match(p.user, /Reply in Korean\./);
  assert.match(p.user, /Block limit typed by the user: 9000 tokens/);
  assert.match(p.user, /Local suggestion from the history: block 13000, week 305000\./);
  assert.doesNotMatch(p.user, /\d{13}/); // no epoch timestamps
  assert.match(p.system, /Suggested next month:/);
  const none = QN.buildUsagePrompt(QN.usageSummary({ records: [], now: NOW }), null, 'xx');
  assert.match(none.user, /Reply in English\./);
  assert.match(none.user, /Local suggestion: none/);
});

test('buildAiRequest: model id and a single user message', () => {
  const body = QN.buildAiRequest({ system: 'S', user: 'U' });
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.system, 'S');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'U' }]);
  assert.ok(body.max_tokens > 0 && body.max_tokens <= 1000);
});

test('parseAiReply: joins text blocks, rejects errors and empty replies', () => {
  assert.equal(QN.parseAiReply({ content: [{ type: 'text', text: ' Hello ' }, { type: 'text', text: 'world' }] }), 'Hello \nworld');
  assert.throws(() => QN.parseAiReply({ type: 'error', error: { message: 'x' } }));
  assert.throws(() => QN.parseAiReply({ content: [{ type: 'tool_use' }] }));
  assert.throws(() => QN.parseAiReply(null));
  assert.throws(() => QN.parseAiReply('text'));
  assert.equal(QN.parseAiReply({ content: [{ type: 'text', text: 'a'.repeat(5000) }] }).length, 4000);
});

test('isPlausibleKey: shape check only', () => {
  assert.equal(QN.isPlausibleKey('sk-ant-api03-abcdefghijklmnop'), true);
  assert.equal(QN.isPlausibleKey('  sk-ant-api03-abcdefghijklmnop  '), true);
  assert.equal(QN.isPlausibleKey('short'), false);
  assert.equal(QN.isPlausibleKey('has a space in the middle of it'), false);
  assert.equal(QN.isPlausibleKey(''), false);
  assert.equal(QN.isPlausibleKey(null), false);
});

test('i18n: every AI string exists in all five languages', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const sb = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'i18n.js'), 'utf8'), sb);
  const dict = sb.window.QN_I18N;
  const keys = Object.keys(dict.en).filter((k) => k.indexOf('ai_') === 0);
  assert.ok(keys.length >= 20);
  for (const lang of ['en', 'ko', 'ja', 'zh', 'es']) {
    for (const k of keys) assert.ok(dict[lang][k], lang + ' missing ' + k);
  }
});
