/* Quotanest core: pure logic. No DOM, no network, no storage.
   In the browser this is a plain script that sets window.QN; in Node tests it is require()d.
   Every number it returns is an estimate or a value the user typed in. Nothing here claims to be an official limit. */
(function (root) {
  'use strict';

  var HOUR = 60 * 60 * 1000;
  var BLOCK_MS = 5 * HOUR;
  var WEEK_MS = 7 * 24 * HOUR;
  var GUIDE_ASOF = '2026-11-03';

  /* ---------- tokens (heuristic, +-30%) ---------- */

  function isCjk(c) {
    return (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef);
  }

  function countKinds(text) {
    var ascii = 0, cjk = 0, other = 0;
    for (var i = 0; i < text.length;) {
      var c = text.codePointAt(i);
      i += c > 0xffff ? 2 : 1;
      if (c < 128) ascii++;
      else if (isCjk(c)) cjk++;
      else other++;
    }
    return { ascii: ascii, cjk: cjk, other: other };
  }

  /* Raw heuristic: ~4 ASCII chars per token, ~1 per CJK/Hangul/kana char, ~2 other chars per token.
     `factor` is a learned correction (see calibrationFactor). */
  function estimateTokens(text, opts) {
    var k = countKinds(String(text == null ? '' : text));
    var factor = opts && opts.factor > 0 ? opts.factor : 1;
    var t = (k.ascii / 4 + k.cjk + k.other / 2) * factor;
    return {
      tokens: Math.round(t),
      low: Math.round(t * 0.75),
      high: Math.round(t * 1.3),
      chars: k.ascii + k.cjk + k.other
    };
  }

  /* pairs: [{ estimated, actual }] where estimated is the raw (factor 1) estimate and actual is the
     number the user read from their own tool. Returns a factor clamped to [0.5, 2]. */
  function calibrationFactor(pairs) {
    var est = 0, act = 0;
    (pairs || []).forEach(function (p) {
      if (p && p.estimated > 0 && p.actual > 0) { est += p.estimated; act += p.actual; }
    });
    if (est <= 0) return 1;
    return Math.min(2, Math.max(0.5, act / est));
  }

  /* ---------- compression (rule based, no AI) ---------- */

  var FILLER = [
    /\b(please|kindly|if possible|if you can)\b[ ,]*/gi,
    /\b(por favor|si es posible|si puedes)\b[ ,]*/gi,
    /(혹시|괜찮으시다면|괜찮으면|가능하시다면|가능하면)\s*/g,
    /(お手数ですが|恐れ入りますが|よろしければ|もしよければ)\s*/g,
    /(请你|请您|麻烦你|麻烦您|如果可以的话)\s*/g
  ];
  var STACK = /^\s+at\s|^\s*File "[^"]+", line \d+|^\s*\.\.\. \d+ more|^\s+\.{3}\s/;
  var FENCE = /^\s*```/;

  /* Removes filler words, repeated lines, long stack traces and extra spaces. Code fences are left alone. */
  function compressText(input, opts) {
    var src = String(input == null ? '' : input);
    var before = estimateTokens(src, opts).tokens;
    var ops = {};
    var bump = function (k, n) { ops[k] = (ops[k] || 0) + (n || 1); };
    var lines = src.replace(/\r\n?/g, '\n').split('\n');
    var out = [], inFence = false, blanks = 0, i = 0;

    while (i < lines.length) {
      var line = lines[i];
      if (FENCE.test(line)) { inFence = !inFence; out.push(line); blanks = 0; i++; continue; }
      if (inFence) { out.push(line); i++; continue; }

      if (line.trim() === '') {
        blanks++;
        if (blanks <= 1) out.push(''); else bump('blank');
        i++; continue;
      }
      blanks = 0;

      if (STACK.test(line)) {
        var j = i;
        while (j < lines.length && STACK.test(lines[j])) j++;
        var run = j - i;
        if (run > 4) {
          out.push(lines[i], lines[i + 1], '… (' + (run - 3) + ' lines folded)', lines[j - 1]);
          bump('stack', run - 3);
          i = j; continue;
        }
      }

      var k = i;
      while (k + 1 < lines.length && lines[k + 1] === line) k++;
      var count = k - i + 1;
      var cleaned = line.replace(/[ \t]+$/, '');
      var spaced = cleaned.replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ');
      if (spaced !== cleaned) bump('spaces');
      var unfilled = spaced;
      FILLER.forEach(function (rx) { unfilled = unfilled.replace(rx, ''); });
      if (unfilled !== spaced) bump('filler');
      unfilled = unfilled.replace(/\s+$/, '');

      if (count >= 2) {
        out.push(unfilled + ' (×' + count + ')');
        bump('duplicate', count - 1);
      } else {
        out.push(unfilled);
      }
      i = k + 1;
    }

    var text = out.join('\n').replace(/^\n+|\s+$/g, '');
    var after = estimateTokens(text, opts).tokens;
    return { text: text, before: before, after: after, saved: before - after, ops: ops };
  }

  /* ---------- usage logs and limit forecast ---------- */

  function num(v) { v = Number(v); return isFinite(v) && v > 0 ? v : 0; }

  function normalizeRecord(r) {
    var ts = typeof r.ts === 'number' ? r.ts : Date.parse(r.ts);
    if (!isFinite(ts)) return null;
    return {
      ts: ts, input: num(r.input), output: num(r.output),
      cacheRead: num(r.cacheRead), cacheWrite: num(r.cacheWrite),
      source: typeof r.source === 'string' ? r.source : 'manual'
    };
  }

  /* Claude Code JSONL: { timestamp, message: { id, model, usage: { input_tokens, output_tokens, ... } }, requestId } */
  function fromClaude(o) {
    var m = o && o.message, u = m && m.usage;
    if (!u || !o.timestamp) return null;
    var key = m.id || o.requestId ? (m.id || '') + '|' + (o.requestId || '') : '';
    return {
      ts: o.timestamp, input: u.input_tokens, output: u.output_tokens,
      cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens,
      source: 'claude', key: key
    };
  }

  /* Codex CLI JSONL: { timestamp, payload: { type: 'token_count', info: { last_token_usage: {...} } } } (best effort) */
  function fromCodex(o) {
    var p = o && o.payload, info = p && p.info, u = info && info.last_token_usage;
    if (p && p.type === 'token_count' && u && o.timestamp) {
      var cached = num(u.cached_input_tokens);
      return {
        ts: o.timestamp, input: num(u.input_tokens) - cached,
        output: num(u.output_tokens) + num(u.reasoning_output_tokens),
        cacheRead: cached, cacheWrite: 0, source: 'codex', key: ''
      };
    }
    return null;
  }

  /* Accepts a JSON array of { ts, input, output } or JSONL from Claude Code / Codex. */
  function parseUsage(text) {
    var src = String(text == null ? '' : text).trim();
    var records = [], seen = Object.create(null), skipped = 0;
    if (src.charAt(0) === '[') {
      try {
        JSON.parse(src).forEach(function (r) {
          var n = normalizeRecord(r || {});
          if (n) records.push(n); else skipped++;
        });
        return { records: records, skipped: skipped };
      } catch (e) { /* fall through to JSONL */ }
    }
    src.split(/\r?\n/).forEach(function (raw) {
      raw = raw.trim();
      if (!raw) return;
      var o;
      try { o = JSON.parse(raw); } catch (e) { skipped++; return; }
      var rec = fromClaude(o) || fromCodex(o);
      if (!rec) return;
      if (rec.key) {
        if (seen[rec.key]) return;
        seen[rec.key] = true;
      }
      var n = normalizeRecord(rec);
      if (n) records.push(n); else skipped++;
    });
    return { records: records, skipped: skipped };
  }

  function tokensOf(r, metric) {
    return metric === 'all' ? r.input + r.output + r.cacheRead + r.cacheWrite : r.input + r.output;
  }

  /* opts: { records, now, metric: 'io' | 'all', blockLimit, weekLimit }
     Blocks are 5 hours long and start at the hour of their first record (same idea as ccusage). */
  function forecast(opts) {
    var now = opts.now, metric = opts.metric || 'io';
    var recs = (opts.records || []).slice().sort(function (a, b) { return a.ts - b.ts; });
    var blocks = [];
    recs.forEach(function (r) {
      var last = blocks[blocks.length - 1];
      if (!last || r.ts >= last.end) {
        var start = Math.floor(r.ts / HOUR) * HOUR;
        last = { start: start, end: start + BLOCK_MS, used: 0, count: 0 };
        blocks.push(last);
      }
      last.used += tokensOf(r, metric);
      last.count++;
    });

    var out = { blocks: blocks.length, active: null, week: null };
    var cur = blocks[blocks.length - 1];
    if (cur && now >= cur.start && now < cur.end) {
      var elapsed = Math.max(now - cur.start, HOUR / 4);
      var rate = cur.used / (elapsed / HOUR);
      var a = { start: cur.start, end: cur.end, used: cur.used, rate: rate, pct: null, hoursToLimit: null, etaTs: null, hitsBeforeReset: false };
      if (opts.blockLimit > 0) {
        a.pct = cur.used / opts.blockLimit;
        var remaining = opts.blockLimit - cur.used;
        if (remaining <= 0) { a.hoursToLimit = 0; a.etaTs = now; }
        else if (rate > 0) {
          a.hoursToLimit = remaining / rate;
          a.etaTs = now + a.hoursToLimit * HOUR;
          a.hitsBeforeReset = a.etaTs <= cur.end;
        }
      }
      out.active = a;
    }

    var weekFrom = now - WEEK_MS, weekUsed = 0, earliest = now;
    recs.forEach(function (r) {
      if (r.ts >= weekFrom && r.ts <= now) {
        weekUsed += tokensOf(r, metric);
        if (r.ts < earliest) earliest = r.ts;
      }
    });
    var spanDays = Math.min(7, Math.max((now - earliest) / (24 * HOUR), 1));
    out.week = {
      used: weekUsed,
      pct: opts.weekLimit > 0 ? weekUsed / opts.weekLimit : null,
      perDay: weekUsed / spanDays
    };
    return out;
  }

  /* ---------- model guide (editable defaults, dated) ---------- */

  var TASKS = [
    { id: 'rename', tier: 'light', saving: 70 },
    { id: 'explain', tier: 'light', saving: 50 },
    { id: 'tests', tier: 'light', saving: 60 },
    { id: 'review', tier: 'mid', saving: 25 },
    { id: 'refactor', tier: 'heavy', saving: 0 },
    { id: 'design', tier: 'heavy', saving: 0 },
    { id: 'hard_bug', tier: 'heavy', saving: 0 }
  ];

  /* overrides: { [taskId]: { tier, saving } } from the user's edited table */
  function modelGuide(taskId, overrides) {
    var base = null;
    TASKS.forEach(function (t) { if (t.id === taskId) base = t; });
    if (!base) return null;
    var o = (overrides && overrides[taskId]) || {};
    var tier = o.tier === 'light' || o.tier === 'mid' || o.tier === 'heavy' ? o.tier : base.tier;
    var saving = o.saving >= 0 && o.saving <= 100 ? Number(o.saving) : base.saving;
    return { id: base.id, tier: tier, saving: saving, asOf: GUIDE_ASOF };
  }

  /* ---------- CLAUDE.md / AGENTS.md checks ---------- */

  var VERBOSE = /(반드시|절대로|꼭|매우|정말|아주|please|make sure to|be sure to|in order to|it is important|you should always|必ず|絶対|务必|一定要|asegúrate de|es importante que)/i;

  function analyzeInstructions(files) {
    var seen = Object.create(null);
    var result = { files: [], duplicates: [], verbose: [], splits: [], saving: 0 };
    var norm = function (s) { return s.trim().replace(/\s+/g, ' ').toLowerCase(); };

    (files || []).forEach(function (f) {
      var text = String(f.text == null ? '' : f.text);
      var lines = text.split(/\r?\n/);
      var sections = [], cur = null, headings = 0;
      result.files.push({ name: f.name, chars: text.length, lines: lines.length, tokens: estimateTokens(text).tokens });

      lines.forEach(function (l, idx) {
        if (/^#{1,3}\s/.test(l)) {
          headings++;
          cur = { name: f.name, title: l.replace(/^#+\s*/, '').trim(), chars: 0 };
          sections.push(cur);
        }
        if (cur) cur.chars += l.length + 1;
        var n = norm(l);
        if (n.length < 20) return;
        (seen[n] = seen[n] || []).push({ name: f.name, line: idx + 1 });
        if (l.length > 200) result.verbose.push({ name: f.name, line: idx + 1, reason: 'long', tokens: estimateTokens(l).tokens });
        else if (VERBOSE.test(l)) result.verbose.push({ name: f.name, line: idx + 1, reason: 'filler', tokens: estimateTokens(l).tokens });
      });

      result.files[result.files.length - 1].headings = headings;
      sections.forEach(function (s) {
        if (s.chars > 1500) result.splits.push({ name: s.name, title: s.title, chars: s.chars });
      });
    });

    Object.keys(seen).forEach(function (n) {
      var hits = seen[n];
      if (hits.length > 1) {
        result.duplicates.push({ text: n.slice(0, 80), count: hits.length, places: hits.map(function (h) { return h.name + ':' + h.line; }) });
        result.saving += estimateTokens(n).tokens * (hits.length - 1);
      }
    });
    result.verbose.forEach(function (v) { result.saving += v.tokens * 0.3; });
    result.saving = Math.round(result.saving);
    return result;
  }

  /* ---------- session summary and resume prompt (extractive, no AI) ---------- */

  var RX = {
    decision: /(결정|채택|선택했|decided|decision|we will use|going with|chose|決定|決めた|採用|决定|采用|decidid[oa]|decidimos)/i,
    error: /(error|exception|traceback|failed|failure|panic|에러|오류|실패|エラー|失敗|错误|失败|fallo)/i,
    todo: /(todo|next step|remaining|next:|남은|다음 단계|残り|次の|待办|下一步|pendiente|siguiente)/i,
    file: /(?:^|[\s`'"(])((?:[\w.-]+\/)*[\w.-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|swift|rb|php|md|json|ya?ml|html|css|sql|toml|sh|vue|svelte))(?=$|[\s`'"),:])/g
  };

  function summarizeSession(text) {
    var src = String(text == null ? '' : text);
    var lines = src.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var pick = function (rx, max) {
      return lines.filter(function (l) { return rx.test(l); }).slice(0, max).map(function (l) { return l.slice(0, 200); });
    };
    var files = [], m, rx = new RegExp(RX.file.source, 'g');
    while ((m = rx.exec(src)) !== null) {
      if (files.indexOf(m[1]) < 0) files.push(m[1]);
    }
    return {
      goal: (lines[0] || '').slice(0, 200),
      decisions: pick(RX.decision, 10),
      files: files.slice(0, 30),
      errors: pick(RX.error, 8),
      todos: pick(RX.todo, 10),
      tokens: estimateTokens(src).tokens
    };
  }

  var RESUME = {
    en: { intro: 'Continue the work below. Keep the decisions; do not redo them.', goal: 'Goal (first line)', decisions: 'Decisions', files: 'Files touched', errors: 'Errors seen', todos: 'Left to do', none: '- (none found)', ask: 'First, restate the current state in three lines, then continue with the first item under "Left to do".' },
    ko: { intro: '아래 작업을 이어서 해 주세요. 이미 내린 결정은 유지하고 다시 논의하지 마세요.', goal: '목표 (첫 줄)', decisions: '결정 사항', files: '변경한 파일', errors: '발생한 에러', todos: '남은 일', none: '- (찾지 못함)', ask: '먼저 현재 상태를 세 줄로 요약한 뒤, "남은 일"의 첫 항목부터 진행해 주세요.' },
    ja: { intro: '以下の作業を続けてください。決定事項は維持し、再検討しないでください。', goal: '目的（1行目）', decisions: '決定事項', files: '変更したファイル', errors: '発生したエラー', todos: '残りの作業', none: '- （なし）', ask: 'まず現在の状態を3行で要約し、「残りの作業」の最初の項目から進めてください。' },
    zh: { intro: '请继续完成以下工作。保留已经做出的决定，不要重新讨论。', goal: '目标（第一行）', decisions: '已做的决定', files: '修改过的文件', errors: '遇到的错误', todos: '剩余工作', none: '- （无）', ask: '请先用三行概括当前状态，然后从“剩余工作”的第一项开始。' },
    es: { intro: 'Continúa el trabajo siguiente. Mantén las decisiones tomadas y no las vuelvas a discutir.', goal: 'Objetivo (primera línea)', decisions: 'Decisiones', files: 'Archivos tocados', errors: 'Errores vistos', todos: 'Pendiente', none: '- (ninguno)', ask: 'Primero resume el estado actual en tres líneas y luego continúa con el primer punto de "Pendiente".' }
  };

  function buildResumePrompt(s, lang) {
    var L = RESUME[lang] || RESUME.en;
    var list = function (arr) { return arr && arr.length ? arr.map(function (x) { return '- ' + x; }) : [L.none]; };
    var out = [L.intro, '', L.goal + ': ' + (s.goal || '-'), '', L.decisions + ':'];
    out = out.concat(list(s.decisions), ['', L.files + ':'], list(s.files), ['', L.errors + ':'], list(s.errors), ['', L.todos + ':'], list(s.todos), ['', L.ask]);
    return out.join('\n');
  }

  var api = {
    estimateTokens: estimateTokens,
    calibrationFactor: calibrationFactor,
    compressText: compressText,
    parseUsage: parseUsage,
    forecast: forecast,
    tokensOf: tokensOf,
    modelGuide: modelGuide,
    TASKS: TASKS,
    GUIDE_ASOF: GUIDE_ASOF,
    analyzeInstructions: analyzeInstructions,
    summarizeSession: summarizeSession,
    buildResumePrompt: buildResumePrompt
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QN = api;
})(typeof self !== 'undefined' ? self : this);
