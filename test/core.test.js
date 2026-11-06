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

const HOUR_MS = 60 * 60 * 1000;

test('forecast: reset countdown, recent block log and week drop-out time', () => {
  const start = Date.parse('2026-11-03T10:00:00Z');
  const records = [{ ts: start, input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 }];
  const now = start + 2 * HOUR_MS;
  const f = QN.forecast({ records, now, metric: 'io', blockLimit: 2000 });
  assert.equal(f.active.resetsIn, 3 * HOUR_MS);
  assert.equal(f.recent.length, 1);
  assert.equal(f.recent[0].pct, 0.5);
  assert.equal(f.week.freesAt, start + 7 * 24 * HOUR_MS);
  const none = QN.forecast({ records: [], now, metric: 'io' });
  assert.equal(none.week.freesAt, null);
  assert.deepEqual(none.recent, []);
});

test('dailyUsage: buckets by local calendar day, oldest first, ignores records outside the window', () => {
  const now = new Date(2026, 10, 3, 12).getTime();
  const records = [
    { ts: new Date(2026, 10, 3, 9).getTime(), input: 100, output: 0 },
    { ts: new Date(2026, 10, 2, 23).getTime(), input: 200, output: 0 },
    { ts: new Date(2026, 9, 20).getTime(), input: 999, output: 0 },
  ];
  const days = QN.dailyUsage({ records, now, metric: 'io', days: 7 });
  assert.equal(days.length, 7);
  assert.equal(days[6].used, 100);
  assert.equal(days[5].used, 200);
  assert.equal(days.reduce((s, d) => s + d.used, 0), 300);
});

test('taskCost: prompt times turns, minus the table saving, and share of the block limit', () => {
  const c = QN.taskCost({ promptTokens: 1000, turns: 10, taskId: 'rename', blockLimit: 100000 });
  assert.equal(c.raw, 10000);
  assert.equal(c.after, 3000); // rename saves 70 percent
  assert.equal(c.shareRaw, 0.1);
  assert.equal(c.shareAfter, 0.03);
  const h = QN.taskCost({ promptTokens: 500, turns: 0, taskId: 'design' }); // design saves 0; turns floor to 1
  assert.equal(h.raw, 500);
  assert.equal(h.after, 500);
  assert.equal(h.shareRaw, null);
  assert.equal(QN.taskCost({ promptTokens: 1, turns: 1, taskId: 'nope' }), null);
});

test('budgetCheck: left, over and pct; no budget means null', () => {
  const over = QN.budgetCheck(1500, 1000);
  assert.equal(over.over, true);
  assert.equal(over.left, -500);
  assert.equal(over.pct, 1.5);
  const ok = QN.budgetCheck(500, 1000);
  assert.equal(ok.over, false);
  assert.equal(ok.left, 500);
  assert.equal(QN.budgetCheck(500, 0), null);
});

test('habitProgress: counts only known habit ids', () => {
  assert.equal(QN.HABIT_IDS.length, 8);
  const p = QN.habitProgress(['tip_1', 'tip_3', 'zzz'], undefined);
  assert.equal(p.done, 2);
  assert.equal(p.total, 8);
  assert.equal(p.pct, 0.25);
  assert.equal(QN.habitProgress(undefined).done, 0);
});

test('normalizeImport: accepts a version 1 export, drops bad rows and invalid values', () => {
  const r = QN.normalizeImport({
    v: 1,
    records: [{ ts: 1000, input: 5, output: 2 }, { ts: 'x' }, null],
    limits: { block: 900, metric: 'weird' },
    calib: [{ estimated: 10, actual: 12 }, { estimated: 0, actual: 3 }],
    guide: { rename: { tier: 'mid', saving: 40 }, design: { tier: 'bogus', saving: 500 } },
    habits: ['tip_1', 'tip_1', 'nope'],
    budget: 2000,
  }, 5000);
  assert.equal(r.records.length, 1);
  assert.equal(r.limits.block, 900);
  assert.equal(r.limits.metric, 'io');
  assert.equal(r.calib.length, 1);
  assert.deepEqual(r.guide, { rename: { tier: 'mid', saving: 40 } });
  assert.deepEqual(r.habits, ['tip_1']);
  assert.equal(r.budget, 2000);
  assert.equal(QN.normalizeImport({ v: 2, records: [] }), null);
  assert.equal(QN.normalizeImport(null), null);
});

test('recentIndices: newest first, never more than the records there are', () => {
  assert.deepEqual(QN.recentIndices([{}, {}, {}], 2), [2, 1]);
  assert.deepEqual(QN.recentIndices([{}], 10), [0]);
  assert.deepEqual(QN.recentIndices([], 10), []);
  assert.deepEqual(QN.recentIndices([{}, {}], 0), []);
  assert.deepEqual(QN.recentIndices([{}, {}], -3), []);
});

test('alertLevel: ok below 80 percent, near from 80, over from 100, null without a limit', () => {
  assert.equal(QN.alertLevel(0.79), 'ok');
  assert.equal(QN.alertLevel(0.8), 'near');
  assert.equal(QN.alertLevel(1), 'over');
  assert.equal(QN.alertLevel(null), null);
  assert.equal(QN.alertLevel(NaN), null);
});


test('compressText: removes standalone Korean laughter but preserves words and quoted examples', () => {
  assert.equal(QN.compressText('하하하\n하하하').text, '');
  assert.equal(QN.compressText('하하하\n하하하\n코드를 고쳐줘').text, '코드를 고쳐줘');
  for (const laughter of ['하하하', 'ㅋㅋㅋ', 'ㅎㅎㅎ', '하하!', 'ㅋㅋㅋㅋ...']) {
    assert.equal(QN.compressText(laughter).text, '');
    assert.equal(QN.compressText('코드를 고쳐줘 ' + laughter).text, '코드를 고쳐줘');
    assert.equal(QN.compressText(laughter + ' 코드를 고쳐줘').text.trim(), '코드를 고쳐줘');
  }
  for (const protectedText of ['"하하하"하하하', '"하하하  please"', '\`하하하  please\`', '"하하하"', "'ㅋㅋㅋ'", '`ㅎㅎㅎ`', '“하하하”', '‘ㅋㅋㅋ’', '하하하라는 이름', '하하하하늘', '와와와']) {
    assert.equal(QN.compressText(protectedText).text, protectedText);
  }
  assert.equal(QN.compressText('설명: `please   하하하` 하하하').text, '설명: `please   하하하`');
});
test('compressText: matching backtick or tilde fences preserve laughter and filler', () => {
  for (const input of ['~~~text\n하하하 please\n~~~', '````text\n```\n하하하 please\n````', '```js\n하하하 please\n```']) {
    assert.equal(QN.compressText(input).text, input);
  }
});


test('compressText: Korean filler never removes a prefix inside meaningful words', () => {
  for (const input of ['혹시나 필요한 경우', '불가능하면 오류를 보여줘', '가능하면으로 시작하는 문장']) {
    assert.equal(QN.compressText(input).text, input);
  }
  assert.equal(QN.compressText('혹시 코드를 고쳐줘').text, '코드를 고쳐줘');
  assert.equal(QN.compressText('혹시 혹시 코드를 고쳐줘').text, '코드를 고쳐줘');
  assert.equal(QN.compressText('코드를 혹시 고쳐줘').text, '코드를 고쳐줘');
  assert.equal(QN.compressText('하하하 코드를 고쳐줘').text, '코드를 고쳐줘');
  assert.equal(QN.compressText('하하하').text, '');
});
