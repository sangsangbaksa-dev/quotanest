const test = require('node:test');
const assert = require('node:assert/strict');
const QN = require('../app/core.js');

test('estimateTokens: ASCII is about 4 chars per token, CJK about 1 per char, with a range', () => {
  const en = QN.estimateTokens('a'.repeat(400));
  assert.equal(en.tokens, 100);
  assert.ok(en.low < en.tokens && en.tokens < en.high);
  assert.equal(QN.estimateTokens('한국어 문장입니다').tokens, 8); // 8 syllables + 1 space
  assert.equal(QN.estimateTokens('').tokens, 0);
  assert.equal(QN.estimateTokens(null).tokens, 0);
});

test('estimateTokens: factor scales the raw estimate', () => {
  assert.equal(QN.estimateTokens('a'.repeat(400), { factor: 2 }).tokens, 200);
});

test('calibrationFactor: ratio of actual to estimated, clamped to [0.5, 2]', () => {
  assert.equal(QN.calibrationFactor([]), 1);
  assert.equal(QN.calibrationFactor([{ estimated: 100, actual: 150 }]), 1.5);
  assert.equal(QN.calibrationFactor([{ estimated: 100, actual: 1000 }]), 2);
  assert.equal(QN.calibrationFactor([{ estimated: 100, actual: 1 }]), 0.5);
});

test('compressText: folds duplicate lines, filler, extra spaces and stack traces; keeps code fences', () => {
  const stack = ['Error: boom', '    at a (x.js:1:1)', '    at b (x.js:2:1)', '    at c (x.js:3:1)', '    at d (x.js:4:1)', '    at e (x.js:5:1)', '    at f (x.js:6:1)'].join('\n');
  const input = ['Please    fix this', 'same line', 'same line', 'same line', '', '', '', stack, '```', 'please   keep   me', '```'].join('\n');
  const r = QN.compressText(input);
  assert.match(r.text, /^fix this/m);
  assert.match(r.text, /same line \(×3\)/);
  assert.match(r.text, /lines folded/);
  assert.match(r.text, /please   keep   me/, 'code fence content is untouched');
  assert.equal(r.ops.duplicate, 2);
  assert.ok(r.after <= r.before);
  assert.equal(r.saved, r.before - r.after);
});

test('compressText: Korean filler is removed', () => {
  const r = QN.compressText('혹시 이 함수를 고쳐 주실 수 있을까요');
  assert.doesNotMatch(r.text, /혹시/);
});

test('parseUsage: Claude Code JSONL, dedupes repeated request ids, skips bad lines', () => {
  const line = (id, ts, input, output) => JSON.stringify({ timestamp: ts, requestId: 'r1', message: { id, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } } });
  const text = [line('m1', '2026-11-03T01:00:00Z', 100, 50), line('m1', '2026-11-03T01:00:00Z', 100, 50), 'not json', line('m2', '2026-11-03T02:00:00Z', 200, 80), JSON.stringify({ type: 'user' })].join('\n');
  const r = QN.parseUsage(text);
  assert.equal(r.records.length, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.records[0].source, 'claude');
  assert.equal(QN.tokensOf(r.records[0], 'io'), 150);
  assert.equal(QN.tokensOf(r.records[0], 'all'), 165);
});

test('parseUsage: Codex token_count lines and a plain JSON array', () => {
  const codex = JSON.stringify({ timestamp: '2026-11-03T03:00:00Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 100, reasoning_output_tokens: 20 } } } });
  const r = QN.parseUsage(codex);
  assert.equal(r.records[0].source, 'codex');
  assert.equal(r.records[0].input, 600);
  assert.equal(r.records[0].output, 120);
  const arr = QN.parseUsage(JSON.stringify([{ ts: '2026-11-03T04:00:00Z', input: 10, output: 5 }, { ts: 'bad' }]));
  assert.equal(arr.records.length, 1);
  assert.equal(arr.skipped, 1);
});

test('forecast: active 5-hour block, rate, and time to limit', () => {
  const start = Date.parse('2026-11-03T10:00:00Z');
  const records = [{ ts: start, input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 }, { ts: start + 60 * 60 * 1000, input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 }];
  const now = start + 2 * 60 * 60 * 1000;
  const f = QN.forecast({ records, now, metric: 'io', blockLimit: 4000, weekLimit: 10000 });
  assert.equal(f.blocks, 1);
  assert.equal(f.active.used, 2000);
  assert.equal(f.active.rate, 1000); // 2000 tokens over 2 hours
  assert.equal(f.active.pct, 0.5);
  assert.equal(Math.round(f.active.hoursToLimit), 2);
  assert.equal(f.active.hitsBeforeReset, true);
  assert.equal(f.week.used, 2000);
  assert.equal(f.week.pct, 0.2);
});

test('forecast: a new block starts after 5 hours, and no active block when now is outside it', () => {
  const start = Date.parse('2026-11-03T00:00:00Z');
  const records = [{ ts: start, input: 500, output: 0 }, { ts: start + 6 * 60 * 60 * 1000, input: 300, output: 0 }];
  const f = QN.forecast({ records, now: start + 7 * 60 * 60 * 1000, metric: 'io' });
  assert.equal(f.blocks, 2);
  assert.ok(f.active);
  assert.equal(f.active.used, 300);
  const late = QN.forecast({ records, now: start + 30 * 60 * 60 * 1000, metric: 'io' });
  assert.equal(late.active, null);
});

test('modelGuide: defaults are dated and user overrides apply', () => {
  const d = QN.modelGuide('rename');
  assert.equal(d.tier, 'light');
  assert.equal(d.asOf, '2026-11-03');
  const o = QN.modelGuide('rename', { rename: { tier: 'mid', saving: 40 } });
  assert.equal(o.tier, 'mid');
  assert.equal(o.saving, 40);
  assert.equal(QN.modelGuide('nope'), null);
});

test('analyzeInstructions: finds duplicates across files, verbose lines, and long sections', () => {
  const shared = 'Always run the unit tests before committing.';
  const a = ['# Rules', shared, 'Please make sure to keep functions small and named well.', '# Big', 'x'.repeat(1600)].join('\n');
  const b = ['# Other', shared].join('\n');
  const r = QN.analyzeInstructions([{ name: 'CLAUDE.md', text: a }, { name: 'AGENTS.md', text: b }]);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0].count, 2);
  assert.ok(r.verbose.some((v) => v.reason === 'filler'));
  assert.equal(r.splits.length, 1);
  assert.equal(r.splits[0].title, 'Big');
  assert.ok(r.saving > 0);
});

test('summarizeSession: pulls goal, decisions, files, errors and todos', () => {
  const text = [
    'Build the export feature',
    'We decided to use JSON for the export format.',
    'Edited src/export.js and app/app.js',
    'TypeError: cannot read property of undefined',
    'TODO: add a test for import',
  ].join('\n');
  const s = QN.summarizeSession(text);
  assert.equal(s.goal, 'Build the export feature');
  assert.equal(s.decisions.length, 1);
  assert.ok(s.files.includes('src/export.js'));
  assert.ok(s.files.includes('app/app.js'));
  assert.equal(s.errors.length, 1);
  assert.equal(s.todos.length, 1);
  const prompt = QN.buildResumePrompt(s, 'ko');
  assert.match(prompt, /결정 사항/);
  assert.match(prompt, /src\/export\.js/);
});
