/* Applies the shared strings to the landing and legal pages. Language: ?lang=, then the saved app setting, then the browser. */
(function () {
  'use strict';
  var I18N = window.QN_I18N || {}, SITE = window.QN_SITE || {};
  var LANGS = ['en', 'ko', 'ja', 'zh', 'es'];
  var KEY = 'quotanest.v1';

  function readSaved() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function pick() {
    try {
      var q = new URLSearchParams(location.search).get('lang');
      if (LANGS.indexOf(q) >= 0) return q;
    } catch (e) { /* ignore */ }
    var s = readSaved();
    if (s && LANGS.indexOf(s.lang) >= 0) return s.lang;
    var n = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return LANGS.indexOf(n) >= 0 ? n : 'en';
  }
  function t(key, vars) {
    var s = (I18N[current] && I18N[current][key]) || (I18N.en && I18N.en[key]) || '';
    s = s.split('{price}').join(SITE.price || '');
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  var current = 'en';

  function apply(lang) {
    current = I18N[lang] ? lang : 'en';
    document.documentElement.lang = current;
    document.querySelectorAll('[data-t]').forEach(function (n) { n.textContent = t(n.dataset.t, n.dataset.d ? { d: n.dataset.d } : null); });
    document.querySelectorAll('[data-t-body]').forEach(function (n) {
      n.textContent = '';
      t(n.dataset.tBody).split(/\n\n+/).forEach(function (para) {
        var p = document.createElement('p');
        p.textContent = para;
        n.appendChild(p);
      });
    });
    var sel = document.getElementById('lang');
    if (sel) sel.value = current;
  }

  var sel = document.getElementById('lang');
  if (sel) sel.addEventListener('change', function () {
    var lang = sel.value;
    try {
      var s = readSaved() || {};
      s.lang = lang;
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) { /* private mode: language still applies for this page */ }
    apply(lang);
  });

  apply(pick());
})();
