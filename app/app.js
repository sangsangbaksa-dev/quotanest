/* Quotanest UI. Plain DOM, built with textContent only (no innerHTML). Data stays in localStorage on this device. */
(function () {
  'use strict';

  var I18N = window.QN_I18N, SITE = window.QN_SITE || {}, QN = window.QN;
  var KEY = 'quotanest.v1';
  var LANGS = ['en', 'ko', 'ja', 'zh', 'es'];
  var NATIVE = { en: 'English', ko: '한국어', ja: '日本語', zh: '中文', es: 'Español' };
  var LOCALE = { en: 'en-US', ko: 'ko-KR', ja: 'ja-JP', zh: 'zh-CN', es: 'es-ES' };
  var MAX_RECORDS = 5000;
  var refreshers = [];
  var gate = null;
  var gateVisible = false;

  /* ---------- state ---------- */

  function detectLang() {
    var n = ((navigator.language || 'en') + '').slice(0, 2).toLowerCase();
    return LANGS.indexOf(n) >= 0 ? n : 'en';
  }
  function defaults() {
    return { v: 1, lang: detectLang(), records: [], limits: { block: 0, week: 0, metric: 'io' }, calib: [], guide: {}, license: { ok: false, key: '' } };
  }
  function load() {
    var d = defaults();
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return d;
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return d;
      d.lang = LANGS.indexOf(s.lang) >= 0 ? s.lang : d.lang;
      d.records = Array.isArray(s.records) ? s.records : [];
      d.limits = Object.assign(d.limits, s.limits || {});
      d.calib = Array.isArray(s.calib) ? s.calib : [];
      d.guide = s.guide && typeof s.guide === 'object' ? s.guide : {};
      d.license = Object.assign(d.license, s.license || {});
      return d;
    } catch (e) { return d; }
  }
  var state = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { toast(t('toast_fail')); return false; }
  }

  /* ---------- helpers ---------- */

  function t(key, vars) {
    var s = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); });
    return s;
  }
  function fmt(n) { return Math.round(n || 0).toLocaleString(LOCALE[state.lang] || 'en-US'); }
  function pct(x) { return x == null ? '–' : Math.round(x * 100) + '%'; }

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
      if (!txt.trim() || !(n > 0)) { toast(t('err_empty')); return; }
      state.calib.push({ estimated: QN.estimateTokens(txt).tokens, actual: n });
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

    return el('section', { cls: 'panel', id: 'p-estimate', role: 'tabpanel' }, [
      el('h2', { t: 'est_h' }),
      el('div', { cls: 'card' }, [
        el('label', { t: 'est_in' }), input,
        el('label', { t: 'est_file' }), file,
        el('div', { cls: 'row' }, [runBtn]),
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
    var last = false;

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
    function run(silent) {
      var txt = input.value;
      if (!txt.trim()) { if (!silent) toast(t('err_empty')); return; }
      last = true;
      var r = QN.compressText(txt);
      output.value = r.text;
      draw(r);
    }
    refreshers.push(function () { if (last) run(true); });

    return el('section', { cls: 'panel', id: 'p-compress', role: 'tabpanel' }, [
      el('h2', { t: 'cmp_h' }),
      el('div', { cls: 'card' }, [
        el('label', { t: 'cmp_in' }), input,
        el('div', { cls: 'row' }, [
          el('button', { cls: 'btn', type: 'button', t: 'cmp_btn', on: { click: function () { run(); } } }),
          fileButton(function (txt) { input.value = txt; run(); })
        ]),
        stats
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

    function draw() {
      var f = QN.forecast({
        records: state.records, now: Date.now(), metric: state.limits.metric,
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
        nodes.push(eta);
      } else {
        nodes.push(note('use_no_block'));
      }
      nodes.push(el('h3', { t: 'use_week' }));
      nodes.push(el('div', { cls: 'stats' }, [
        stat('use_used', fmt(f.week.used)),
        stat('use_pct', pct(f.week.pct)),
        stat('use_week_per_day', fmt(f.week.perDay))
      ]));
      nodes.push(note('use_disclaimer'));
      box.replaceChildren.apply(box, nodes);
    }

    function setLimit(input, key) {
      input.addEventListener('input', function () {
        state.limits[key] = Number(input.value) > 0 ? Number(input.value) : 0;
        save(); draw();
      });
    }
    setLimit(blockIn, 'block');
    setLimit(weekIn, 'week');
    metric.addEventListener('change', function () { state.limits.metric = metric.value; save(); draw(); });

    function addRecords(list) {
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

    var fileIn = fileButton(function (txt) {
      var r = QN.parseUsage(txt);
      addRecords(r.records);
      parsedNote.textContent = t('use_parsed', { n: fmt(r.records.length), s: fmt(r.skipped) });
      draw();
    });

    var addBtn = el('button', { cls: 'btn', type: 'button', t: 'use_add', on: { click: function () {
      var ts = when.value ? Date.parse(when.value) : Date.now();
      var n = Number(tokens.value);
      if (!isFinite(ts) || !(n > 0)) { toast(t('err_empty')); return; }
      addRecords([{ ts: ts, input: n, output: 0, cacheRead: 0, cacheWrite: 0, source: 'manual' }]);
      tokens.value = '';
      draw();
    } } });

    var clearBtn = el('button', { cls: 'btn danger', type: 'button', t: 'use_clear', on: { click: function () {
      if (!window.confirm(t('use_clear') + '?')) return;
      state.records = []; save(); parsedNote.textContent = ''; draw(); toast(t('toast_cleared'));
    } } });

    refreshers.push(draw);
    draw();

    return el('section', { cls: 'panel', id: 'p-usage', role: 'tabpanel' }, [
      el('h2', { t: 'use_h' }),
      el('div', { cls: 'card' }, [
        el('label', { t: 'use_file' }), fileIn, parsedNote
      ]),
      el('div', { cls: 'card' }, [
        el('h3', { t: 'use_limits_h' }),
        el('label', { t: 'use_block_limit' }), blockIn,
        el('label', { t: 'use_week_limit' }), weekIn,
        el('label', { t: 'use_metric' }), metric
      ]),
      box,
      el('div', { cls: 'card' }, [
        el('h3', { t: 'use_add_h' }),
        el('label', { t: 'use_when' }), when,
        el('label', { t: 'use_tokens' }), tokens,
        el('div', { cls: 'row' }, [addBtn, clearBtn])
      ])
    ]);
  }

  /* ---------- model guide ---------- */

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
        state.guide[x.id] = { tier: tier.value, saving: Number(saving.value) || 0 };
        save(); draw();
      };
      tier.addEventListener('change', onChange);
      saving.addEventListener('change', onChange);
      table.appendChild(el('tr', null, [el('td', { t: 'task_' + x.id }), el('td', null, [tier]), el('td', null, [saving])]));
    });

    sel.addEventListener('change', draw);
    refreshers.push(function () { draw(); });
    draw();

    return el('section', { cls: 'panel', id: 'p-model', role: 'tabpanel' }, [
      el('h2', { t: 'mdl_h' }),
      el('div', { cls: 'card' }, [el('label', { t: 'mdl_task' }), sel, out]),
      el('div', { cls: 'card' }, [table])
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

  /* ---------- tips ---------- */

  function panelTips() {
    var items = [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return el('li', { t: 'tip_' + i }); });
    refreshers.push(function () {
      items.forEach(function (li, i) { li.textContent = t('tip_' + (i + 1)); });
    });
    return el('section', { cls: 'panel', id: 'p-tips', role: 'tabpanel' }, [
      el('h2', { t: 'tips_h' }),
      el('div', { cls: 'card' }, [el('ol', { cls: 'plain' }, items)])
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

    function drawStatus() {
      status.textContent = state.license.ok ? t('set_status_on') : t('set_status_off');
      status.className = state.license.ok ? 'note good' : 'note';
    }
    refreshers.push(drawStatus);
    drawStatus();

    var fileIn = fileButton(function (txt) {
      var obj;
      try { obj = JSON.parse(txt); } catch (e) { obj = null; }
      if (!obj || obj.v !== 1 || !Array.isArray(obj.records)) { toast(t('set_bad_file')); return; }
      state.records = obj.records.filter(function (r) { return r && typeof r.ts === 'number' && isFinite(r.ts); }).slice(-MAX_RECORDS);
      if (obj.limits && typeof obj.limits === 'object') state.limits = Object.assign(state.limits, obj.limits);
      if (Array.isArray(obj.calib)) state.calib = obj.calib.slice(-20);
      if (obj.guide && typeof obj.guide === 'object') state.guide = obj.guide;
      save(); toast(t('set_imported')); refreshAll();
    });

    return el('section', { cls: 'panel', id: 'p-settings', role: 'tabpanel' }, [
      el('h2', { t: 'set_h' }),
      el('div', { cls: 'card' }, [
        el('label', { t: 'set_lang' }), langSel
      ]),
      el('div', { cls: 'card' }, [
        el('h3', { t: 'set_license' }), status
      ]),
      el('div', { cls: 'card' }, [
        el('div', { cls: 'row' }, [
          el('button', { cls: 'btn ghost', type: 'button', t: 'set_export', on: { click: function () {
            var copy = JSON.parse(JSON.stringify(state));
            delete copy.license;
            download('quotanest-data.json', JSON.stringify(copy, null, 2));
          } } }),
          el('label', { cls: 'btn ghost', style: 'display:inline-block;cursor:pointer;margin:0', t: 'set_import' }, [fileIn])
        ]),
        el('div', { cls: 'row' }, [
          el('button', { cls: 'btn danger', type: 'button', t: 'set_clear', on: { click: function () {
            if (!window.confirm(t('set_clear_ok'))) return;
            var license = state.license;
            state = defaults(); state.license = license; state.lang = langSel.value;
            save(); langSel.value = state.lang; applyI18n(); toast(t('toast_cleared'));
          } } })
        ]),
        note('set_data_note')
      ])
    ]);
  }

  /* ---------- licence gate ---------- */

  function buildGate() {
    var msg = el('p', { cls: 'note' });
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
    if (gate) gate.hidden = !on;
  }

  /* On first load, ask the server whether licensing is configured. An unconfigured server answers configured:false
     and the app stays open, like the other apps in this repository. A bad or missing key never reaches the upstream. */
  function probeLicence() {
    if (state.license.ok) return;
    showGate(true);
    gate.querySelector('.note').textContent = t('gate_checking');
    fetch('/api/license', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (j && j.configured === false) showGate(false);
        else gate.querySelector('.note').textContent = '';
      })
      .catch(function () { gate.querySelector('.note').textContent = t('gate_unreachable'); });
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
  var buttons = {}, panels = {};

  function show(name) {
    tabs.forEach(function (x) {
      var on = x[0] === name;
      buttons[x[0]].setAttribute('aria-selected', on ? 'true' : 'false');
      panels[x[0]].classList.toggle('on', on);
    });
    try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ }
  }

  function applyI18n() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll('[data-t]').forEach(function (n) { n.textContent = t(n.dataset.t); });
    document.querySelectorAll('[data-tp]').forEach(function (n) { n.placeholder = t(n.dataset.tp); });
    refreshAll();
  }

  function build() {
    var root = document.getElementById('root');
    var nav = el('nav', { cls: 'tabs', role: 'tablist' });
    var main = el('main', { id: 'main' });
    tabs.forEach(function (x) {
      buttons[x[0]] = el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', t: x[1], on: { click: function () { show(x[0]); } } });
      nav.appendChild(buttons[x[0]]);
      panels[x[0]] = x[2]();
      main.appendChild(panels[x[0]]);
    });
    root.replaceChildren(
      el('header', { cls: 'top' }, [
        el('p', { cls: 'brand', t: 'brand' }),
        el('span', { cls: 'hdr-links' }, [
          el('a', { href: '/privacy.html', t: 'nav_privacy' }), ' ',
          el('a', { href: '/terms.html', t: 'nav_terms' })
        ])
      ]),
      nav,
      main,
      el('div', { cls: 'gate-slot' })
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
