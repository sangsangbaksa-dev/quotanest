/* Quotanest UI. Plain DOM, built with textContent only (no innerHTML). Data stays in localStorage on this device. */
(function () {
  'use strict';

  var I18N = window.QN_I18N, SITE = window.QN_SITE || {}, QN = window.QN;
  var KEY = 'quotanest.v1';
  var KEY_RECS = 'quotanest.v1.records';
  var savedRecRev = -1;
  var LANGS = ['en', 'ko', 'ja', 'zh', 'es'];
  var THEMES = ['system', 'light', 'dark'];
  var RANGES = [7, 14, 28];
  var NATIVE = { en: 'English', ko: '한국어', ja: '日本語', zh: '中文', es: 'Español' };
  var LOCALE = { en: 'en-US', ko: 'ko-KR', ja: 'ja-JP', zh: 'zh-CN', es: 'es-ES' };
  var MAX_RECORDS = 5000;
  var refreshers = [];
  var tickers = [];
  var recRev = 0; /* bumped whenever state.records changes, so the record list knows when to redraw */
  var gate = null;
  var gateVisible = false;

  /* ---------- state ---------- */

  function detectLang() {
    var n = ((navigator.language || 'en') + '').slice(0, 2).toLowerCase();
    return LANGS.indexOf(n) >= 0 ? n : 'en';
  }
  function defaults() {
    return {
      v: 1, lang: detectLang(), records: [], limits: { block: 0, week: 0, metric: 'io' }, calib: [], guide: {},
      habits: [], budget: 0, theme: 'system', chartDays: 7, license: { ok: false, key: '' }
    };
  }
  function load() {
    var d = defaults();
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return d;
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return d;
      // Records live under their own key (written only when they change). Older saves kept them inside KEY.
      var recs = s.records;
      try { var rr = localStorage.getItem(KEY_RECS); if (rr != null) recs = JSON.parse(rr); } catch (e) { /* keep the older copy */ }
      d.lang = LANGS.indexOf(s.lang) >= 0 ? s.lang : d.lang;
      // Stored data is checked the same way as an import, so bad rows or values cannot reach the forecast.
      var clean = QN.normalizeImport({
        v: 1, records: Array.isArray(recs) ? recs : [], limits: s.limits, calib: s.calib,
        guide: s.guide, habits: s.habits, budget: s.budget
      }, MAX_RECORDS);
      if (clean) {
        d.records = clean.records; d.limits = clean.limits; d.calib = clean.calib;
        d.guide = clean.guide; d.habits = clean.habits; d.budget = clean.budget;
      }
      d.theme = THEMES.indexOf(s.theme) >= 0 ? s.theme : 'system';
      d.chartDays = RANGES.indexOf(Number(s.chartDays)) >= 0 ? Number(s.chartDays) : 7;
      d.license = Object.assign(d.license, s.license || {});
      return d;
    } catch (e) { return d; }
  }
  var state = load();

  /* Writes the state now. The records (up to 5000) are written only after they changed (recRev), so
     toggling a habit or typing a limit does not re-serialise them. Records are written first, so a failed
     write never leaves the settings pointing at records that were not saved. */
  function save() {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      if (savedRecRev !== recRev) {
        localStorage.setItem(KEY_RECS, JSON.stringify(state.records));
        savedRecRev = recRev;
      }
      var rest = Object.assign({}, state);
      delete rest.records;
      localStorage.setItem(KEY, JSON.stringify(rest));
      return true;
    } catch (e) { toast(t('toast_fail')); return false; }
  }
  /* Keystroke-driven fields (limits, budget) only schedule a write, so typing does not serialise the whole state per key.
     The pending write is flushed when the page is hidden or closed. */
  var saveTimer = null;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; save(); }, 400);
  }
  function flushSave() { if (saveTimer) save(); }
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushSave(); });

  /* ---------- helpers ---------- */

  function t(key, vars) {
    var s = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); });
    return s;
  }
  /* Intl formatters are costly to create and the same few are used on every redraw, so they are cached per language. */
  var formatters = {};
  function formatter(kind, opts) {
    var key = state.lang + '|' + kind;
    if (!formatters[key]) {
      formatters[key] = kind === 'n'
        ? new Intl.NumberFormat(LOCALE[state.lang] || 'en-US')
        : new Intl.DateTimeFormat(LOCALE[state.lang] || 'en-US', opts);
    }
    return formatters[key];
  }
  function fmt(n) { return formatter('n').format(Math.round(n || 0)); }
  function pct(x) { return x == null ? '–' : Math.round(x * 100) + '%'; }
  function durText(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    return t('dur_hm', { h: Math.floor(m / 60), m: m % 60 });
  }
  function fmtWhen(ts) {
    return formatter('when', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
  }
  function fmtDay(ts) {
    return formatter('day', { weekday: 'short' }).format(new Date(ts));
  }
  function fmtDate(ts) {
    return formatter('date', { month: 'short', day: 'numeric' }).format(new Date(ts));
  }
  /* Plain-text summary of the current block and the last 7 days, for copying. */
  function summaryText(f) {
    var lines = [];
    if (f.active) {
      var a = f.active;
      lines.push(a.pct == null
        ? t('sum_block_nolim', { u: fmt(a.used), t: durText(a.resetsIn) })
        : t('sum_block', { u: fmt(a.used), p: pct(a.pct), t: durText(a.resetsIn) }));
    } else {
      lines.push(t('sum_block_none'));
    }
    lines.push(f.week.pct == null
      ? t('sum_week_nolim', { u: fmt(f.week.used), d: fmt(f.week.perDay) })
      : t('sum_week', { u: fmt(f.week.used), p: pct(f.week.pct), d: fmt(f.week.perDay) }));
    return lines.join('\n');
  }

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (k === 't') { n.dataset.t = v; n.textContent = t(v); }
      else if (k === 'tp') { n.dataset.tp = v; n.placeholder = t(v); }
      else if (k === 'cls') n.className = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { n.addEventListener(ev, v[ev]); });
      else if (k === 'checked' || k === 'selected' || k === 'disabled') n[k] = !!v;
      else n.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function stat(labelKey, value) {
    return el('div', { cls: 'stat' }, [el('div', { cls: 'k', t: labelKey }), el('div', { cls: 'v' }, [String(value)])]);
  }
  function note(key) { return el('p', { cls: 'note', t: key }); }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, kids) {
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, String(attrs[k])); });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  /* Inline SVG bar chart of daily totals. Labels and tooltips are text nodes only.
     Up to 7 bars get weekday names; longer ranges get day-of-month numbers. */
  function barChart(days) {
    var W = 320, H = 160, padX = 8, base = H - 26, top = 14;
    var max = days.reduce(function (m, d) { return Math.max(m, d.used); }, 0);
    var slot = (W - padX * 2) / days.length;
    var bw = slot * 0.6;
    var parts = [svgEl('line', { x1: padX, x2: W - padX, y1: base, y2: base, class: 'axis-line' })];
    days.forEach(function (d, i) {
      var h = max > 0 ? Math.round((d.used / max) * (base - top)) : 0;
      var x = padX + i * slot + (slot - bw) / 2;
      var label = days.length > 7 ? String(new Date(d.start).getDate()) : fmtDay(d.start);
      parts.push(svgEl('g', null, [
        svgEl('title', null, [document.createTextNode(fmtDate(d.start) + ': ' + fmt(d.used))]),
        svgEl('rect', { x: x.toFixed(1), y: base - h, width: bw.toFixed(1), height: h, rx: 3, class: 'bar' }),
        svgEl('text', { x: (x + bw / 2).toFixed(1), y: H - 8, 'text-anchor': 'middle' }, [document.createTextNode(label)])
      ]));
    });
    return svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': t('use_chart_label', { n: days.length }), class: 'chart' }, parts);
  }

  /* ---------- AI key (optional, this device only) ---------- */

  var AI_KEY = 'quotanest-ai-key';
  var AI_URL = 'https://api.anthropic.com/v1/messages';
  function aiKeyGet() { try { return localStorage.getItem(AI_KEY) || ''; } catch (e) { return ''; } }
  function aiKeySet(k) { try { localStorage.setItem(AI_KEY, k); return true; } catch (e) { return false; } }
  function aiKeyClear() { try { localStorage.removeItem(AI_KEY); } catch (e) { /* storage blocked: nothing to remove */ } }

  var toastTimer = null;
  function toast(msg) {
    var box = document.getElementById('toast');
    box.textContent = msg;
    box.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove('show'); }, 2200);
  }
  function copyText(text) {
    try {
      navigator.clipboard.writeText(text).then(function () { toast(t('toast_copied')); }, function () { toast(t('toast_fail')); });
    } catch (e) { toast(t('toast_fail')); }
  }
  function readFile(file, onText) {
    var r = new FileReader();
    r.onload = function () { onText(String(r.result || '')); };
    r.onerror = function () { toast(t('err_read')); };
    r.readAsText(file);
  }
  function fileButton(onText) {
    var input = el('input', { type: 'file', accept: '.txt,.md,.json,.jsonl,.log,.js,.ts,.py,.go,.rs,.java,.kt,.swift,.rb,.php,.html,.css,.sql,.yml,.yaml,.toml,.sh' });
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) readFile(input.files[0], onText);
      input.value = '';
    });
    return input;
  }
  function download(name, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name, hidden: true });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function refreshAll() { refreshers.forEach(function (fn) { try { fn(); } catch (e) { /* keep going */ } }); }
  /* Panels with time-based text (reset countdowns) redraw once a minute. */
  setInterval(function () { tickers.forEach(function (fn) { try { fn(); } catch (e) { /* keep going */ } }); }, 60000);

  /* ---------- tokens ---------- */

  function panelEstimate() {
    var last = false;
    var input = el('textarea', { id: 'est-in', rows: '8', tp: 'est_in' });
    var out = el('div', { cls: 'card', 'aria-live': 'polite' });
    var actual = el('input', { type: 'number', min: '0', step: '1', id: 'est-actual' });
    var calibNote = el('p', { cls: 'note' });

    function factor() { return QN.calibrationFactor(state.calib); }
    function run(silent) {
      var txt = input.value;
      if (!txt.trim()) { if (!silent) toast(t('err_empty')); return; }
      last = true;
      var f = factor();
      var r = QN.estimateTokens(txt, { factor: f });
      out.replaceChildren(
        el('div', { cls: 'stats' }, [
          stat('est_out', fmt(r.tokens)),
          stat('est_range', fmt(r.low) + '–' + fmt(r.high)),
          stat('est_chars', fmt(r.chars)),
          stat('est_factor', f.toFixed(2))
        ]),
        note('est_note')
      );
    }
    refreshers.push(function () { if (last) run(true); calibNote.textContent = state.calib.length ? t('est_calib_done') : ''; });

    var save1 = el('button', { cls: 'btn', type: 'button', t: 'est_calib_btn', on: { click: function () {
      var txt = input.value;
      var n = Number(actual.value);
      var raw = txt.trim() ? QN.estimateTokens(txt).tokens : 0;
      // A text too short to estimate (raw 0) would be stored but ignored by calibrationFactor, so refuse it here.
      if (!(raw > 0) || !(n > 0)) { toast(t('err_empty')); return; }
      state.calib.push({ estimated: raw, actual: n });
      if (state.calib.length > 20) state.calib = state.calib.slice(-20);
      save();
      calibNote.textContent = t('est_calib_done');
      run(true);
    } } });
    var reset = el('button', { cls: 'btn ghost', type: 'button', t: 'est_calib_reset', on: { click: function () {
      state.calib = []; save(); calibNote.textContent = ''; run(true);
    } } });

    var file = fileButton(function (txt) { input.value = txt; run(); });
    var runBtn = el('button', { cls: 'btn', type: 'button', t: 'est_run', on: { click: function () { run(); } } });
    var pasteBtn = el('button', { cls: 'btn ghost', type: 'button', t: 'est_paste', on: { click: function () {
      // Clipboard reads need permission and can be refused; fall back to the paste hint.
      try {
        navigator.clipboard.readText().then(function (txt) { input.value = txt; run(); }, function () { toast(t('err_paste')); });
      } catch (e) { toast(t('err_paste')); }
    } } });

    return el('section', { cls: 'panel', id: 'p-estimate', role: 'tabpanel' }, [
      el('h2', { t: 'est_h' }),
      el('div', { cls: 'card' }, [
        el('label', { t: 'est_in' }), input,
        el('label', { t: 'est_file' }), file,
        el('div', { cls: 'row' }, [runBtn, pasteBtn]),
        out
      ]),
      el('div', { cls: 'card' }, [
        el('h3', { t: 'est_calib_h' }),
        el('label', { t: 'est_actual' }), actual,
        el('div', { cls: 'row' }, [save1, reset]),
        calibNote
      ])
    ]);
  }

  function panelCompress() {
    var input = el('textarea', { id: 'cmp-in', rows: '8', tp: 'cmp_in' });
    var output = el('textarea', { readonly: '', rows: '8', 'aria-label': 'result' });
    var stats = el('div', { cls: 'card', 'aria-live': 'polite' });
    var budgetIn = el('input', { type: 'number', min: '0', step: '1', id: 'cmp-budget', value: state.budget ? String(state.budget) : '' });
    var budgetBox = el('div', { 'aria-live': 'polite' });
    var last = false;
    var lastAfter = null;

    function draw(r) {
      var ops = Object.keys(r.ops).map(function (k) {
        return el('li', null, [t('op_' + k) + ': ' + fmt(r.ops[k])]);
      });
      stats.replaceChildren(
        el('div', { cls: 'stats' }, [
          stat('cmp_before', fmt(r.before)),
          stat('cmp_after', fmt(r.after)),
          stat('cmp_saved', fmt(r.saved))
        ]),
        ops.length ? el('ul', { cls: 'plain' }, ops) : note('cmp_none'),
        note('cmp_note')
      );
    }
    function drawBudget() {
      var b = lastAfter === null ? null : QN.budgetCheck(lastAfter, state.budget);
      if (!b) { budgetBox.replaceChildren(); return; }
      budgetBox.replaceChildren(
        el('progress', { max: String(b.budget), value: String(Math.min(b.used, b.budget)) }),
        el('p', { cls: b.over ? 'note bad' : 'note good' }, [
          b.over ? t('cmp_budget_over', { n: fmt(-b.left) }) : t('cmp_budget_left', { n: fmt(b.left) })
        ])
      );
    }
    function run(silent) {
      var txt = input.value;
      if (!txt.trim()) { if (!silent) toast(t('err_empty')); return; }
      last = true;
      var r = QN.compressText(txt);
      output.value = r.text;
      lastAfter = r.after;
      draw(r);
      drawBudget();
    }
    budgetIn.addEventListener('input', function () {
      state.budget = Number(budgetIn.value) > 0 ? Number(budgetIn.value) : 0;
      saveSoon(); drawBudget();
    });
    refreshers.push(function () { if (last) run(true); });

    return el('section', { cls: 'panel', id: 'p-compress', role: 'tabpanel' }, [
      el('h2', { t: 'cmp_h' }),
      el('div', { cls: 'card' }, [
        el('label', { t: 'cmp_in' }), input,
        el('label', { t: 'cmp_budget' }), budgetIn,
        el('div', { cls: 'row' }, [
          el('button', { cls: 'btn', type: 'button', t: 'cmp_btn', on: { click: function () { run(); } } }),
          fileButton(function (txt) { input.value = txt; run(); })
        ]),
        stats,
        budgetBox
      ]),
      el('div', { cls: 'card' }, [
        el('label', { t: 'cmp_out' }), output,
        el('div', { cls: 'row' }, [
          el('button', { cls: 'btn ghost', type: 'button', t: 'cmp_copy', on: { click: function () { if (output.value) copyText(output.value); } } })
        ])
      ])
    ]);
  }

  /* ---------- usage and limits ---------- */

  function panelUsage() {
    var box = el('div', { cls: 'card', 'aria-live': 'polite' });
    var sumBox = el('div', { cls: 'summary', 'aria-live': 'polite' });
    var parsedNote = el('p', { cls: 'note' });
    var when = el('input', { type: 'datetime-local', id: 'use-when' });
    var tokens = el('input', { type: 'number', min: '0', step: '1', id: 'use-tokens' });
    var blockIn = el('input', { type: 'number', min: '0', step: '1', id: 'use-block', value: String(state.limits.block || '') });
    var weekIn = el('input', { type: 'number', min: '0', step: '1', id: 'use-week', value: String(state.limits.week || '') });
    var metric = el('select', { id: 'use-metric' }, [
      el('option', { value: 'io', t: 'metric_io' }),
      el('option', { value: 'all', t: 'metric_all' })
    ]);
    metric.value = state.limits.metric === 'all' ? 'all' : 'io';
    var rangeSel = el('select', { id: 'use-range' }, RANGES.map(function (n) {
      return el('option', { value: String(n) }, [t('range_days', { n: n })]);
    }));
    rangeSel.value = String(state.chartDays);
    rangeSel.addEventListener('change', function () {
      state.chartDays = RANGES.indexOf(Number(rangeSel.value)) >= 0 ? Number(rangeSel.value) : 7;
      save(); draw();
    });
    refreshers.push(function () {
      Array.prototype.forEach.call(rangeSel.options, function (o, i) { o.textContent = t('range_days', { n: RANGES[i] }); });
    });

    /* ---- AI analysis card. The local summary is always shown and is computed on this device.
       The model is asked only when the user has saved a key AND presses the button. ---- */
    function aiLine(a) {
      switch (a.id) {
        case 'none': return t('ai_none');
        case 'trend_up': return t('ai_trend_up', { p: a.p });
        case 'trend_down': return t('ai_trend_down', { p: a.p });
        case 'trend_flat': return t('ai_trend_flat');
        case 'trend_none': return t('ai_trend_none');
        case 'near': return t('ai_near', { n: a.n });
        case 'near_none': return t('ai_near_none');
        case 'no_limit': return t('ai_no_limit');
        case 'suggest': return t('ai_suggest', { block: a.block ? fmt(a.block) : '–', week: a.week ? fmt(a.week) : '–' });
        default: return t('ai_suggest_none');
      }
    }
    var aiLocal = el('ul', { cls: 'plain', 'aria-live': 'polite' });
    /* The 28-day history is cached per records revision, metric and minute; typing a limit only re-applies the limits. */
    var histKey = null, hist = null;
    function historyNow(now) {
      var key = recRev + '|' + state.limits.metric + '|' + Math.floor(now / 60000);
      if (key !== histKey) { histKey = key; hist = QN.usageHistory({ records: state.records, now: now, metric: state.limits.metric }); }
      return hist;
    }
    function drawAiLocal(now) {
      var summary = QN.withLimits(historyNow(now), state.limits.block, state.limits.week);
      var advice = QN.localAdvice(summary, QN.suggestLimits(summary));
      aiLocal.replaceChildren.apply(aiLocal, advice.map(function (a) { return el('li', null, [aiLine(a)]); }));
    }

    var aiKeyBox = el('div');
    var aiStatus = el('p', { cls: 'note', 'aria-live': 'polite' });
    var aiOutHead = el('h3', { t: 'ai_result_h', hidden: true });
    var aiOut = el('div', { cls: 'summary', 'aria-live': 'polite', hidden: true });
    var aiBusy = false;
    var aiRun = null;

    function sendToModel() {
      var key = aiKeyGet();
      if (!key || aiBusy) return;
      var now = Date.now();
      var summary = QN.usageSummary({
        records: state.records, now: now, metric: state.limits.metric,
        blockLimit: state.limits.block, weekLimit: state.limits.week
      });
      var body = QN.buildAiRequest(QN.buildUsagePrompt(summary, QN.suggestLimits(summary), state.lang));
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 30000);
      aiBusy = true;
      if (aiRun) aiRun.disabled = true;
      aiStatus.textContent = t('ai_busy');

      var status = 0, reply = null, failed = null;
      fetch(AI_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body),
        referrerPolicy: 'no-referrer',
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        status = r.status;
        return r.json().catch(function () { return null; });
      }).then(function (j) {
        reply = j;
      }, function () {
        failed = 'net';
      }).then(function () {
        clearTimeout(timer);
        aiBusy = false;
        if (aiRun) aiRun.disabled = false;
        if (failed) { aiStatus.textContent = t('ai_err_net'); return; }
        if (status === 401 || status === 403) { aiStatus.textContent = t('ai_err_key', { s: status }); return; }
        if (status < 200 || status > 299) { aiStatus.textContent = t('ai_err_http', { s: status }); return; }
        var text = '';
        try { text = QN.parseAiReply(reply); } catch (e) { aiStatus.textContent = t('ai_err_reply'); return; }
        aiOut.textContent = text;
        aiOutHead.hidden = false; aiOut.hidden = false;
        aiStatus.textContent = '';
      });
    }

    function drawAiKey() {
      var key = aiKeyGet();
      if (!key) {
        var keyIn = el('input', { type: 'password', id: 'ai-key', autocomplete: 'off', spellcheck: 'false' });
        var saveKey = el('button', { cls: 'btn', type: 'button', t: 'ai_key_save', on: { click: function () {
          var k = keyIn.value.trim();
          if (!QN.isPlausibleKey(k)) { aiStatus.textContent = t('ai_key_bad'); return; }
          if (!aiKeySet(k)) { aiStatus.textContent = t('toast_fail'); return; }
          keyIn.value = '';
          aiStatus.textContent = t('ai_key_saved');
          drawAiKey();
        } } });
        keyIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveKey.click(); } });
        aiKeyBox.replaceChildren(el('label', { for: 'ai-key', t: 'ai_key_input' }), keyIn, el('div', { cls: 'row' }, [saveKey]));
        aiRun = null;
      } else {
        aiRun = el('button', { cls: 'btn', type: 'button', t: 'ai_run', on: { click: sendToModel } });
        aiRun.disabled = aiBusy;
        var forget = el('button', { cls: 'btn ghost', type: 'button', t: 'ai_key_forget', on: { click: function () {
          aiKeyClear(); aiStatus.textContent = ''; drawAiKey();
        } } });
        aiKeyBox.replaceChildren(
          el('p', { cls: 'note good', t: 'ai_key_saved' }),
          note('ai_sent'),
          el('div', { cls: 'row' }, [aiRun, forget])
        );
      }
    }
    drawAiKey();

    function draw() {
      var now = Date.now();
      drawAiLocal(now);
      var f = QN.forecast({
        records: state.records, now: now, metric: state.limits.metric,
        blockLimit: state.limits.block, weekLimit: state.limits.week
      });
      var nodes = [el('p', { cls: 'note' }, [t('use_records', { n: fmt(state.records.length) }) + ' ' + t('use_blocks', { n: f.blocks })])];
      if (f.active) {
        var a = f.active;
        var eta;
        if (a.hoursToLimit == null) eta = el('p', { t: 'use_no_limit' });
        else if (a.hitsBeforeReset) eta = el('p', { cls: 'warn' }, [t('use_eta_hit', { h: a.hoursToLimit.toFixed(1) })]);
        else eta = el('p', { cls: 'good', t: 'use_eta_safe' });
        nodes.push(el('h3', { t: 'use_active' }));
        nodes.push(el('div', { cls: 'stats' }, [
          stat('use_used', fmt(a.used)),
          stat('use_pct', pct(a.pct)),
          stat('use_rate', fmt(a.rate) + ' /h')
        ]));
        nodes.push(el('p', { cls: 'note' }, [t('use_reset', { t: durText(a.resetsIn) })]));
        var lvl = QN.alertLevel(a.pct);
        if (lvl === 'near' || lvl === 'over') {
          nodes.push(el('p', { cls: lvl === 'over' ? 'note bad' : 'note warn', role: 'status' }, [t(lvl === 'over' ? 'alert_over' : 'alert_near', { p: pct(a.pct) })]));
        }
        nodes.push(eta);
      } else {
        nodes.push(note('use_no_block'));
      }
      nodes.push(el('h3', { t: 'use_recent' }));
      nodes.push(f.recent.length
        ? el('ul', { cls: 'plain' }, f.recent.map(function (b) {
          var d = fmtWhen(b.start);
          return el('li', null, [b.pct == null
            ? t('use_recent_row', { d: d, u: fmt(b.used) })
            : t('use_recent_pct', { d: d, u: fmt(b.used), p: pct(b.pct) })]);
        }))
        : note('use_no_block'));
      nodes.push(el('h3', { t: 'use_week' }));
      nodes.push(el('div', { cls: 'stats' }, [
        stat('use_used', fmt(f.week.used)),
        stat('use_pct', pct(f.week.pct)),
        stat('use_week_per_day', fmt(f.week.perDay))
      ]));
      nodes.push(el('div', { cls: 'chart-wrap' }, [barChart(QN.dailyUsage({ records: state.records, now: now, metric: state.limits.metric, days: state.chartDays }))]));
      if (f.week.freesAt) nodes.push(el('p', { cls: 'note' }, [t('use_week_drop', { d: fmtWhen(f.week.freesAt) })]));
      nodes.push(note('use_disclaimer'));
      box.replaceChildren.apply(box, nodes);
      sumBox.textContent = summaryText(f);
    }

    /* Typing a limit only redraws this panel and schedules a save. Other panels do not depend on limits. */
    function setLimit(input, key) {
      input.addEventListener('input', function () {
        state.limits[key] = Number(input.value) > 0 ? Number(input.value) : 0;
        saveSoon(); draw();
      });
    }
    setLimit(blockIn, 'block');
    setLimit(weekIn, 'week');
    metric.addEventListener('change', function () { state.limits.metric = metric.value; save(); draw(); });

    function addRecords(list) {
      recRev++;
      var seen = Object.create(null);
      state.records.forEach(function (r) { seen[[r.ts, r.input, r.output, r.cacheRead, r.cacheWrite, r.source].join('|')] = true; });
      var added = 0;
      list.forEach(function (r) {
        var k = [r.ts, r.input, r.output, r.cacheRead, r.cacheWrite, r.source].join('|');
        if (seen[k]) return;
        seen[k] = true; state.records.push(r); added++;
      });
      state.records.sort(function (a, b) { return a.ts - b.ts; });
      if (state.records.length > MAX_RECORDS) state.records = state.records.slice(-MAX_RECORDS);
      save();
      return added;
    }

    /* The list is rebuilt only when the records or the language change, not on every redraw. */
    var recList = el('div', { 'aria-live': 'polite' });
    var recDrawn = null;
    function drawRecords() {
      var sig = recRev + '|' + state.lang + '|' + state.limits.metric;
      if (sig === recDrawn) return;
      recDrawn = sig;
      var idx = QN.recentIndices(state.records, 10);
      if (!idx.length) { recList.replaceChildren(note('use_no_recs')); return; }
      recList.replaceChildren(el('ul', { cls: 'rec' }, idx.map(function (i, k) {
        var r = state.records[i];
        return el('li', null, [
          el('span', null, [t('use_rec_row', { d: fmtWhen(r.ts), n: fmt(QN.tokensOf(r, state.limits.metric)), s: r.source })]),
          el('button', { cls: 'btn ghost small', type: 'button', t: 'use_del', on: { click: function () {
            state.records.splice(i, 1); recRev++; save(); draw(); drawRecords();
            // Keep keyboard focus on a row after the list is redrawn.
            var btns = recList.querySelectorAll('button');
            if (btns.length) btns[Math.min(k, btns.length - 1)].focus();
          } } })
        ]);
      })));
    }
    refreshers.push(drawRecords);

    var fileIn = fileButton(function (txt) {
      var r = QN.parseUsage(txt);
      addRecords(r.records);
      parsedNote.textContent = t('use_parsed', { n: fmt(r.records.length), s: fmt(r.skipped) });
      draw(); drawRecords();
    });

    var addBtn = el('button', { cls: 'btn', type: 'button', t: 'use_add', on: { click: function () {
      var ts = when.value ? Date.parse(when.value) : Date.now();
      var n = Number(tokens.value);
      if (!isFinite(ts) || !(n > 0)) { toast(t('err_empty')); return; }
      addRecords([{ ts: ts, input: n, output: 0, cacheRead: 0, cacheWrite: 0, source: 'manual' }]);
      tokens.value = '';
      draw(); drawRecords();
    } } });

    // Enter in the tokens field adds the record, like the Enter key in the licence field.
    tokens.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); } });

    var clearBtn = el('button', { cls: 'btn danger', type: 'button', t: 'use_clear', on: { click: function () {
      if (!window.confirm(t('use_clear') + '?')) return;
      state.records = []; recRev++; save(); parsedNote.textContent = ''; draw(); drawRecords(); toast(t('toast_cleared'));
    } } });

    var copySum = el('button', { cls: 'btn ghost', type: 'button', t: 'use_copy_sum', on: { click: function () {
      if (sumBox.textContent) copyText(sumBox.textContent);
    } } });

    refreshers.push(draw);
    tickers.push(draw);
    draw();
    drawRecords();

    return el('section', { cls: 'panel', id: 'p-usage', role: 'tabpanel' }, [
      el('h2', { t: 'use_h' }),
      el('div', { cls: 'card' }, [
        el('label', { t: 'use_file' }), fileIn, parsedNote
      ]),
      el('div', { cls: 'card' }, [
        el('h3', { t: 'use_limits_h' }),
        el('label', { t: 'use_block_limit' }), blockIn,
        el('label', { t: 'use_week_limit' }), weekIn,
        el('label', { t: 'use_metric' }), metric,
        el('label', { t: 'use_chart_range' }), rangeSel
      ]),
      box,
      el('div', { cls: 'card' }, [
        el('h3', { t: 'use_summary_h' }),
        sumBox,
        el('div', { cls: 'row' }, [copySum])
      ]),
      el('div', { cls: 'card', id: 'ai-card' }, [
        el('h3', { t: 'ai_h' }),
        note('ai_local'),
        aiLocal,
        el('h3', { t: 'ai_key_h' }),
        note('ai_key_hint'),
        aiKeyBox,
        aiStatus,
        aiOutHead,
        aiOut
      ]),
      el('div', { cls: 'card' }, [
        el('h3', { t: 'use_add_h' }),
        el('label', { t: 'use_when' }), when,
        el('label', { t: 'use_tokens' }), tokens,
        el('div', { cls: 'row' }, [addBtn, clearBtn])
      ]),
      el('div', { cls: 'card' }, [
        el('h3', { t: 'use_recent_recs' }),
        recList
      ])
    ]);
  }

  /* ---------- model guide and task cost ---------- */

  function panelModel() {
    var out = el('div', { cls: 'card', 'aria-live': 'polite' });
    var sel = el('select', { id: 'mdl-task' }, QN.TASKS.map(function (x) {
      return el('option', { value: x.id, t: 'task_' + x.id });
    }));
    var tierName = { light: 'mdl_light', mid: 'mdl_mid', heavy: 'mdl_heavy' };

    function draw() {
      var g = QN.modelGuide(sel.value, state.guide);
      out.replaceChildren(
        el('div', { cls: 'stats' }, [
          stat('mdl_tier', t(tierName[g.tier])),
          stat('mdl_saving', g.saving + '%')
        ]),
        note('mdl_note'),
        el('p', { cls: 'note' }, [t('mdl_asof', { d: g.asOf })])
      );
    }

    var table = el('table', { cls: 'table' });
    var head = el('tr', null, [el('th', { t: 'mdl_task' }), el('th', { t: 'mdl_light' }), el('th', { t: 'mdl_saving' })]);
    table.appendChild(head);
    QN.TASKS.forEach(function (x) {
      var g = QN.modelGuide(x.id, state.guide);
      var tier = el('select', { 'aria-label': x.id }, ['light', 'mid', 'heavy'].map(function (k) {
        return el('option', { value: k, t: tierName[k] });
      }));
      tier.value = g.tier;
      var saving = el('input', { type: 'number', min: '0', max: '100', step: '5', 'aria-label': x.id + ' %' });
      saving.value = String(g.saving);
      var onChange = function () {
        // Clamp to 0..100 and show the stored value, so the field never disagrees with the table.
        var v = Math.min(100, Math.max(0, Math.round(Number(saving.value) || 0)));
        saving.value = String(v);
        state.guide[x.id] = { tier: tier.value, saving: v };
        save(); draw(); drawCost();
      };
      tier.addEventListener('change', onChange);
      saving.addEventListener('change', onChange);
      table.appendChild(el('tr', null, [el('td', { t: 'task_' + x.id }), el('td', null, [tier]), el('td', null, [saving])]));
    });

    var cPrompt = el('input', { type: 'number', min: '0', step: '1', id: 'cost-prompt' });
    var cTurns = el('input', { type: 'number', min: '1', step: '1', id: 'cost-turns', value: '10' });
    var cOut = el('div', { 'aria-live': 'polite' });
    function drawCost() {
      var size = Number(cPrompt.value);
      var c = size > 0 ? QN.taskCost({ promptTokens: size, turns: cTurns.value, taskId: sel.value, overrides: state.guide, blockLimit: state.limits.block }) : null;
      if (!c) { cOut.replaceChildren(note('cost_none')); return; }
      cOut.replaceChildren(
        el('div', { cls: 'stats' }, [
          stat('cost_raw', fmt(c.raw)),
          stat('cost_after', fmt(c.after)),
          stat('cost_share', c.shareRaw == null ? '–' : pct(c.shareRaw) + ' → ' + pct(c.shareAfter))
        ]),
        note('cost_note')
      );
    }
    cPrompt.addEventListener('input', drawCost);
    cTurns.addEventListener('input', drawCost);

    sel.addEventListener('change', function () { draw(); drawCost(); });
    refreshers.push(function () { draw(); drawCost(); });
    draw();
    drawCost();

    return el('section', { cls: 'panel', id: 'p-model', role: 'tabpanel' }, [
      el('h2', { t: 'mdl_h' }),
      el('div', { cls: 'card' }, [el('label', { t: 'mdl_task' }), sel, out]),
      el('div', { cls: 'card' }, [el('div', { cls: 'table-wrap' }, [table])]),
      el('div', { cls: 'card' }, [
        el('h3', { t: 'cost_h' }),
        el('label', { t: 'cost_prompt' }), cPrompt,
        el('label', { t: 'cost_turns' }), cTurns,
        cOut
      ])
    ]);
  }

  /* ---------- CLAUDE.md / AGENTS.md ---------- */

  function panelDocs() {
    var a = el('textarea', { id: 'doc-a', rows: '6', 'aria-label': 'CLAUDE.md' });
    var b = el('textarea', { id: 'doc-b', rows: '6', 'aria-label': 'AGENTS.md' });
    var out = el('div', { cls: 'card', 'aria-live': 'polite' });
    var last = false;

    function run(silent) {
      var files = [];
      if (a.value.trim()) files.push({ name: t('doc_a_name'), text: a.value });
      if (b.value.trim()) files.push({ name: t('doc_b_name'), text: b.value });
      if (!files.length) { if (!silent) toast(t('err_empty')); return; }
      last = true;
      var r = QN.analyzeInstructions(files);
      var parts = [];
      parts.push(el('h3', { t: 'doc_files' }));
      parts.push(el('ul', { cls: 'plain' }, r.files.map(function (f) {
        return el('li', null, [f.name + ' — ' + fmt(f.chars) + ' ' + t('doc_chars') + ', ' + fmt(f.lines) + ' ' + t('doc_lines') + ', ' + fmt(f.tokens) + ' ' + t('doc_tokens')]);
      })));
      if (!r.duplicates.length && !r.verbose.length && !r.splits.length) {
        parts.push(note('doc_none'));
      }
      if (r.duplicates.length) {
        parts.push(el('h3', { t: 'doc_dup' }));
        parts.push(el('ul', { cls: 'plain' }, r.duplicates.map(function (d) {
          return el('li', null, [t('doc_dup_item', { n: d.count, t: d.places.join(', ') }) + ' — “' + d.text + '”']);
        })));
      }
      if (r.verbose.length) {
        parts.push(el('h3', { t: 'doc_verbose' }));
        parts.push(el('ul', { cls: 'plain' }, r.verbose.slice(0, 50).map(function (v) {
          return el('li', null, [v.name + ':' + v.line + ' — ' + t(v.reason === 'long' ? 'doc_v_long' : 'doc_v_filler')]);
        })));
      }
      if (r.splits.length) {
        parts.push(el('h3', { t: 'doc_split' }));
        parts.push(el('ul', { cls: 'plain' }, r.splits.map(function (s) {
          return el('li', null, [t('doc_split_item', { t: s.title || '-', c: fmt(s.chars) }) + ' (' + s.name + ')']);
        })));
      }
      parts.push(el('div', { cls: 'stats' }, [stat('doc_saving', fmt(r.saving))]));
      out.replaceChildren.apply(out, parts);
    }
    refreshers.push(function () { if (last) run(true); });

    return el('section', { cls: 'panel', id: 'p-docs', role: 'tabpanel' }, [
      el('h2', { t: 'doc_h' }),
      el('div', { cls: 'card' }, [
        el('label', { t: 'doc_a' }), a, fileButton(function (txt) { a.value = txt; }),
        el('label', { t: 'doc_b' }), b, fileButton(function (txt) { b.value = txt; }),
        note('doc_hint'),
        el('div', { cls: 'row' }, [el('button', { cls: 'btn', type: 'button', t: 'doc_run', on: { click: function () { run(); } } })])
      ]),
      out
    ]);
  }

  /* ---------- resume ---------- */

  function panelResume() {
    var input = el('textarea', { id: 'res-in', rows: '8', tp: 'res_in' });
    var sum = el('div', { cls: 'card', 'aria-live': 'polite' });
    var prompt = el('textarea', { readonly: '', rows: '8', 'aria-label': 'resume prompt' });
    var last = false;

    function list(arr) {
      return arr.length ? el('ul', { cls: 'plain' }, arr.map(function (x) { return el('li', null, [x]); })) : note('res_none');
    }
    function run(silent) {
      var txt = input.value;
      if (!txt.trim()) { if (!silent) toast(t('err_empty')); return; }
      last = true;
      var s = QN.summarizeSession(txt);
      prompt.value = QN.buildResumePrompt(s, state.lang);
      sum.replaceChildren(
        el('h3', { t: 'res_goal' }), el('p', null, [s.goal || '-']),
        el('h3', { t: 'res_decisions' }), list(s.decisions),
        el('h3', { t: 'res_files' }), list(s.files),
        el('h3', { t: 'res_errors' }), list(s.errors),
        el('h3', { t: 'res_todos' }), list(s.todos),
        note('res_hint')
      );
    }
    refreshers.push(function () { if (last) run(true); });

    return el('section', { cls: 'panel', id: 'p-resume', role: 'tabpanel' }, [
      el('h2', { t: 'res_h' }),
      el('div', { cls: 'card' }, [
        el('label', { t: 'res_in' }), input,
        el('div', { cls: 'row' }, [
          el('button', { cls: 'btn', type: 'button', t: 'res_run', on: { click: function () { run(); } } }),
          fileButton(function (txt) { input.value = txt; run(); })
        ])
      ]),
      sum,
      el('div', { cls: 'card' }, [
        el('label', { t: 'res_prompt' }), prompt,
        el('div', { cls: 'row' }, [el('button', { cls: 'btn ghost', type: 'button', t: 'res_copy', on: { click: function () { if (prompt.value) copyText(prompt.value); } } })])
      ])
    ]);
  }

  /* ---------- tips and habit checklist ---------- */

  function panelTips() {
    var count = el('p', { cls: 'note', 'aria-live': 'polite' });
    var bar = el('progress', { max: String(QN.HABIT_IDS.length), value: '0' });
    var boxes = [];
    var items = QN.HABIT_IDS.map(function (id, i) {
      var cb = el('input', { type: 'checkbox', id: id, on: { change: function () {
        state.habits = state.habits.filter(function (h) { return h !== id; });
        if (cb.checked) state.habits.push(id);
        save(); draw();
      } } });
      boxes.push({ id: id, cb: cb });
      return el('li', { cls: 'check' }, [
        el('label', { cls: 'check-l', for: id }, [cb, el('span', { t: 'tip_' + (i + 1) })])
      ]);
    });

    function draw() {
      var p = QN.habitProgress(state.habits, QN.HABIT_IDS);
      bar.value = p.done;
      boxes.forEach(function (b) { b.cb.checked = state.habits.indexOf(b.id) >= 0; });
      count.textContent = t('habit_progress', { n: p.done, total: p.total });
    }
    var reset = el('button', { cls: 'btn ghost', type: 'button', t: 'habit_reset', on: { click: function () {
      state.habits = []; save(); draw();
    } } });
    refreshers.push(draw);
    draw();

    return el('section', { cls: 'panel', id: 'p-tips', role: 'tabpanel' }, [
      el('h2', { t: 'tips_h' }),
      el('div', { cls: 'card' }, [count, bar, el('ul', { cls: 'checklist' }, items)]),
      el('div', { cls: 'row' }, [reset])
    ]);
  }

  /* ---------- settings ---------- */

  function panelSettings() {
    var status = el('p', { cls: 'note' });
    var langSel = el('select', { id: 'set-lang', 'aria-label': 'language' }, LANGS.map(function (k) {
      return el('option', { value: k }, [NATIVE[k]]);
    }));
    langSel.value = state.lang;
    langSel.addEventListener('change', function () {
      state.lang = langSel.value; save(); applyI18n();
    });

    var themeSel = el('select', { id: 'set-theme', 'aria-label': 'theme' }, [
      el('option', { value: 'system', t: 'theme_system' }),
      el('option', { value: 'light', t: 'theme_light' }),
      el('option', { value: 'dark', t: 'theme_dark' })
    ]);
    themeSel.value = state.theme;
    themeSel.addEventListener('change', function () {
      state.theme = THEMES.indexOf(themeSel.value) >= 0 ? themeSel.value : 'system';
      save(); applyTheme();
    });

    function drawStatus() {
      status.textContent = state.license.ok ? t('set_status_on') : t('set_status_off');
      status.className = state.license.ok ? 'note good' : 'note';
    }
    refreshers.push(drawStatus);
    drawStatus();

    var fileIn = fileButton(function (txt) {
      var obj;
      try { obj = JSON.parse(txt); } catch (e) { obj = null; }
      var data = QN.normalizeImport(obj, MAX_RECORDS);
      if (!data) { toast(t('set_bad_file')); return; }
      state.records = data.records; recRev++;
      state.limits = data.limits;
      state.calib = data.calib;
      state.guide = data.guide;
      state.habits = data.habits;
      state.budget = data.budget;
      if (!save()) return;
      toast(t('set_imported'));
      // Input fields keep their old values, so reload to show the imported data.
      setTimeout(function () { location.reload(); }, 800);
    });

    return el('section', { cls: 'panel', id: 'p-settings', role: 'tabpanel' }, [
      el('h2', { t: 'set_h' }),
      el('div', { cls: 'card' }, [
        el('label', { t: 'set_lang' }), langSel,
        el('label', { t: 'set_theme' }), themeSel
      ]),
      el('div', { cls: 'card' }, [
        el('h3', { t: 'set_license' }), status
      ]),
      el('div', { cls: 'card' }, [
        el('div', { cls: 'row' }, [
          el('button', { cls: 'btn ghost', type: 'button', t: 'set_export', on: { click: function () {
            var copy = JSON.parse(JSON.stringify(state));
            delete copy.license;
            download('quotanest-data-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(copy, null, 2));
          } } }),
          el('label', { cls: 'btn ghost', style: 'display:inline-block;cursor:pointer;margin:0', t: 'set_import' }, [fileIn])
        ]),
        el('div', { cls: 'row' }, [
          el('button', { cls: 'btn danger', type: 'button', t: 'set_clear', on: { click: function () {
            if (!window.confirm(t('set_clear_ok'))) return;
            var license = state.license, theme = state.theme;
            aiKeyClear();
            state = defaults(); recRev++; state.license = license; state.theme = theme; state.lang = langSel.value;
            save(); langSel.value = state.lang; themeSel.value = state.theme; applyI18n(); toast(t('toast_cleared'));
          } } })
        ]),
        note('set_data_note')
      ])
    ]);
  }

  /* ---------- licence gate ---------- */

  function buildGate() {
    var msg = el('p', { cls: 'note gate-msg' });
    var key = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', id: 'gate-key', 'aria-label': 'licence key' });
    var unlock = el('button', { cls: 'btn', type: 'button', t: 'gate_unlock' });
    var buy = SITE.checkoutUrl
      ? el('a', { cls: 'btn ghost', href: SITE.checkoutUrl, rel: 'noopener', target: '_blank', t: 'gate_buy' })
      : note('gate_not_sale');
    var box = el('div', { cls: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gate-t' }, [
      el('h2', { id: 'gate-t', t: 'gate_t' }),
      el('p', { t: 'gate_b' }),
      el('label', { t: 'gate_key' }), key,
      el('div', { cls: 'row' }, [unlock, buy]),
      msg,
      el('div', { cls: 'links' }, [el('a', { href: '/privacy.html', t: 'nav_privacy' }), el('a', { href: '/terms.html', t: 'nav_terms' })])
    ]);
    var overlay = el('div', { cls: 'gate', hidden: true }, [box]);

    function setMsg(k) { msg.textContent = k ? t(k) : ''; }
    function submit() {
      var k = key.value.trim();
      if (!k) { setMsg('gate_invalid'); return; }
      setMsg('gate_checking');
      unlock.disabled = true;
      fetch('/api/license', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: k }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          unlock.disabled = false;
          if (j && j.configured === false) { showGate(false); return; }
          if (j && j.ok === true) {
            state.license = { ok: true, key: k };
            save(); showGate(false); refreshAll();
            return;
          }
          var reasons = { invalid: 'gate_invalid', bad_request: 'gate_invalid', refunded: 'gate_refunded', unreachable: 'gate_unreachable' };
          setMsg(reasons[j && j.reason] || 'gate_unreachable');
        })
        .catch(function () { unlock.disabled = false; setMsg('gate_unreachable'); });
    }
    unlock.addEventListener('click', submit);
    key.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });

    return overlay;
  }

  function showGate(on) {
    gateVisible = !!on;
    if (!gate) return;
    // Hiding the dialog would drop focus to the top of the page, so move it to the current tab first.
    if (!on && gate.contains(document.activeElement) && buttons[current]) buttons[current].focus();
    gate.hidden = !on;
    // The licence dialog is modal, so move focus into it.
    if (on) { var k = gate.querySelector('input'); if (k) k.focus(); }
  }

  /* On first load, ask the server whether licensing is configured. An unconfigured server answers configured:false
     and the app stays open, like the other apps in this repository. A bad or missing key never reaches the upstream. */
  function probeLicence() {
    if (state.license.ok) return;
    showGate(true);
    gate.querySelector('.gate-msg').textContent = t('gate_checking');
    fetch('/api/license', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (j && j.configured === false) showGate(false);
        else gate.querySelector('.gate-msg').textContent = '';
      })
      .catch(function () { gate.querySelector('.gate-msg').textContent = t('gate_unreachable'); });
  }

  /* ---------- shell ---------- */

  var tabs = [
    ['estimate', 'tab_estimate', panelEstimate],
    ['compress', 'tab_compress', panelCompress],
    ['usage', 'tab_usage', panelUsage],
    ['model', 'tab_model', panelModel],
    ['docs', 'tab_docs', panelDocs],
    ['resume', 'tab_resume', panelResume],
    ['tips', 'tab_tips', panelTips],
    ['settings', 'tab_settings', panelSettings]
  ];
  var buttons = {}, panels = {}, built = {};
  var current = 'estimate';

  /* Panels are built the first time their tab opens, so startup only pays for the visible one. */
  function ensure(name) {
    if (built[name]) return;
    built[name] = true;
    var fresh = FACTORY[name]();
    panels[name].replaceWith(fresh);
    panels[name] = fresh;
  }

  function show(name) {
    ensure(name);
    current = name;
    tabs.forEach(function (x) {
      var on = x[0] === name;
      buttons[x[0]].setAttribute('aria-selected', on ? 'true' : 'false');
      buttons[x[0]].setAttribute('tabindex', on ? '0' : '-1');
      panels[x[0]].classList.toggle('on', on);
    });
    try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ }
  }

  /* Light, dark or follow the system. An empty attribute means the system setting applies (see style.css). */
  function applyTheme() {
    var root = document.documentElement;
    try {
      if (state.theme === 'light' || state.theme === 'dark') root.setAttribute('data-theme', state.theme);
      else root.removeAttribute('data-theme');
    } catch (e) { /* ignore */ }
  }

  function applyI18n() {
    document.documentElement.lang = state.lang;
    applyTheme();
    document.querySelectorAll('[data-t]').forEach(function (n) { n.textContent = t(n.dataset.t); });
    document.querySelectorAll('[data-tp]').forEach(function (n) { n.placeholder = t(n.dataset.tp); });
    refreshAll();
  }

  var FACTORY = {};
  tabs.forEach(function (x) { FACTORY[x[0]] = x[2]; });

  /* Logo mark: a constant SVG built with DOM calls (no user data). */
  function markSvg() {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', 'mark'); s.setAttribute('viewBox', '0 0 64 64'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    function add(tag, attrs, cls) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (cls) n.setAttribute('class', cls);
      s.appendChild(n);
    }
    add('rect', { width: 64, height: 64, rx: 14 }, 'm-bg');
    add('rect', { x: 14, y: 18, width: 36, height: 6, rx: 3 }, 'm-bar');
    add('rect', { x: 14, y: 30, width: 22, height: 6, rx: 3, opacity: 0.55 }, 'm-bar');
    add('rect', { x: 14, y: 42, width: 30, height: 6, rx: 3, opacity: 0.85 }, 'm-bar');
    return s;
  }

  function build() {
    var root = document.getElementById('root');
    var nav = el('nav', { cls: 'tabs', role: 'tablist' });
    var main = el('main', { id: 'main' });
    tabs.forEach(function (x) {
      buttons[x[0]] = el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', tabindex: '-1', t: x[1], on: { click: function () { show(x[0]); } } });
      nav.appendChild(buttons[x[0]]);
      panels[x[0]] = el('section', { cls: 'panel', id: 'p-' + x[0], role: 'tabpanel' });
      main.appendChild(panels[x[0]]);
    });
    // Arrow keys, Home and End move between tabs (roving focus).
    nav.addEventListener('keydown', function (e) {
      var names = tabs.map(function (x) { return x[0]; });
      var i = names.indexOf(current), next = -1;
      if (e.key === 'ArrowRight') next = (i + 1) % names.length;
      else if (e.key === 'ArrowLeft') next = (i - 1 + names.length) % names.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = names.length - 1;
      if (next < 0) return;
      e.preventDefault();
      show(names[next]);
      buttons[names[next]].focus();
    });
    root.replaceChildren(
      el('header', { cls: 'top' }, [
        el('a', { cls: 'brand', href: '/' }, [
          markSvg(),
          el('span', { cls: 'brand-text' }, [
            el('span', { cls: 'brand-name', t: 'brand' }),
            el('span', { cls: 'brand-tag', t: 'app_tagline' })
          ])
        ]),
        el('span', { cls: 'hdr-links' }, [
          el('a', { href: '/privacy.html', t: 'nav_privacy' }), ' ',
          el('a', { href: '/terms.html', t: 'nav_terms' })
        ])
      ]),
      nav,
      main,
      el('div', { cls: 'gate-slot' }),
      el('footer', { cls: 'site-foot' }, [
        el('div', { cls: 'foot-brand' }, [
          el('a', { cls: 'brand', href: '/' }, [markSvg(), el('span', { cls: 'brand-name', t: 'brand' })]),
          el('p', { cls: 'foot-desc', t: 'footer_note' }),
          el('p', { cls: 'foot-desc', t: 'app_footer_privacy' })
        ]),
        el('nav', { cls: 'foot-nav', 'aria-label': 'Legal' }, [
          el('a', { href: '/privacy.html', t: 'nav_privacy' }),
          el('a', { href: '/terms.html', t: 'nav_terms' })
        ]),
        el('p', { cls: 'foot-copy', t: 'foot_copy' })
      ])
    );
    gate = buildGate();
    document.body.appendChild(gate);
    applyI18n();
    var hash = (location.hash || '').replace('#', '');
    show(tabs.some(function (x) { return x[0] === hash; }) ? hash : 'estimate');
    probeLicence();
  }

  try { build(); } catch (e) {
    var fallback = document.getElementById('root');
    fallback.textContent = 'Quotanest could not start. / Quotanest를 시작하지 못했습니다.';
    console.error(e);
  }
})();
