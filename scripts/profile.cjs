// Quotanest profiling harness: loads the app at 390px with mobile-class CPU (4x slowdown), seeds 5000 records and
// large pasted text, then measures startup, per-keystroke cost in the limit fields, and tab switches.
// Usage: npm i playwright (or any copy that resolves 'playwright'), serve the repo root, then:
//   node scripts/profile.cjs http://127.0.0.1:8000 <label>
const { chromium } = require('playwright');

const base = process.argv[2] || 'http://127.0.0.1:8000';
const label = process.argv[3] || 'run';

function seedRecords(n) {
  const recs = [];
  const start = Date.now() - 6 * 24 * 3600 * 1000;
  for (let i = 0; i < n; i++) {
    recs.push({
      ts: start + i * 120000 + (i % 7) * 1000,
      input: 800 + (i * 37) % 4000, output: 200 + (i * 13) % 900,
      cacheRead: 5000 + (i * 91) % 20000, cacheWrite: 300 + (i * 7) % 900,
      source: i % 2 ? 'claude' : 'manual'
    });
  }
  return recs;
}

const LOG_LINE = '    at Object.<anonymous> (/home/user/project/src/module-' + 'x'.repeat(40) + '.js:12:5)\n';
function bigText(kb) {
  let s = '';
  let i = 0;
  while (s.length < kb * 1024) {
    s += 'Please make sure to kindly check the file src/app/core.js and fix the error ' + (i % 50) + ' in parser.\n';
    s += 'Please make sure to kindly check the file src/app/core.js and fix the error ' + (i % 50) + ' in parser.\n';
    s += '## Section ' + i + '\n- decided to use the new parser; we will use it everywhere\n';
    s += 'TODO: next step remaining work on module ' + i + '\n';
    if (i % 9 === 0) s += 'Error: failed to parse input\n' + LOG_LINE.repeat(7);
    s += '\n\n\n';
    i++;
  }
  return s;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const records = seedRecords(5000);
  const state = {
    v: 1, lang: 'en', records, limits: { block: 500000, week: 3000000, metric: 'io' },
    calib: [], guide: {}, habits: [], budget: 0, theme: 'system', chartDays: 7,
    license: { ok: true, key: 'bench' }
  };
  await ctx.addInitScript((seed) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('quotanest.v1', seed);
      sessionStorage.setItem('seeded', '1');
    }
    window.__lt = [];
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: 'longtask', buffered: true }); } catch (e) { }
    window.__saves = { n: 0, ms: 0, bytes: 0 };
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k.indexOf('quotanest.v1') === 0) {
        const t0 = performance.now();
        const r = orig.call(this, k, v);
        window.__saves.n++; window.__saves.ms += performance.now() - t0; window.__saves.bytes = v.length;
        return r;
      }
      return orig.call(this, k, v);
    };
  }, JSON.stringify(state));

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  // Mobile-class CPU: 4x slowdown, so the numbers are closer to a phone than to this sandbox.
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const metrics = async () => {
    const r = await cdp.send('Performance.getMetrics');
    const o = {};
    r.metrics.forEach((m) => { o[m.name] = m.value; });
    return o;
  };

  // Cold load
  const m0 = await metrics();
  const tNav = Date.now();
  await page.goto(base + '/app/index.html', { waitUntil: 'load' });
  await page.waitForSelector('nav.tabs');
  const readyAt = await page.evaluate(() => performance.now());
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd };
  });
  const m1 = await metrics();
  const startup = await page.evaluate(() => ({
    longtasks: window.__lt.length, longtaskTotal: window.__lt.reduce((a, b) => a + b, 0),
    maxLongtask: Math.max(0, ...window.__lt), nodes: document.querySelectorAll('*').length
  }));
  // Time to interactive: wait until the main thread is idle for 1s after the nav is up.
  const idleAt = await page.evaluate(() => new Promise((res) => {
    let last = performance.now();
    const tick = () => { if (performance.now() - last > 1000) res(performance.now()); else setTimeout(tick, 100); };
    setTimeout(tick, 100);
  }));
  const startupScriptMs = (m1.ScriptDuration - m0.ScriptDuration) * 1000;
  const startupTaskMs = (m1.TaskDuration - m0.TaskDuration) * 1000;

  // Heavy but realistic content: big pasted text in several tabs, each run once.
  const big = bigText(40);
  await page.evaluate((txt) => {
    const set = (sel, v) => { const n = document.querySelector(sel); n.value = v; };
    document.querySelector('.tabs button:nth-child(2)').click();
    set('#cmp-in', txt);
    [...document.querySelectorAll('#p-compress button')].find((b) => b.textContent === 'Compress').click();
  }, big);
  await page.evaluate((txt) => {
    document.querySelector('.tabs button:nth-child(5)').click();
    document.querySelector('#doc-a').value = txt.slice(0, 20000);
    document.querySelector('#doc-b').value = txt.slice(20000, 40000);
    [...document.querySelectorAll('#p-docs button')].find((b) => b.textContent.length > 0).click();
  }, big);
  await page.evaluate((txt) => {
    document.querySelector('.tabs button:nth-child(6)').click();
    document.querySelector('#res-in').value = txt;
    [...document.querySelectorAll('#p-resume button')][0].click();
  }, big);
  await page.evaluate((txt) => {
    document.querySelector('.tabs button:nth-child(1)').click();
    document.querySelector('#est-in').value = txt;
    [...document.querySelectorAll('#p-estimate button')][0].click();
  }, big);

  // Keystrokes in the Limits tab: change the block limit one digit at a time (real key presses).
  await page.evaluate(() => document.querySelector('.tabs button:nth-child(3)').click());
  await page.evaluate(() => { window.__saves = { n: 0, ms: 0, bytes: 0 }; });
  const keyTimes = await page.evaluate(() => {
    const el = document.querySelector('#use-block');
    const out = [];
    let v = '';
    for (let i = 0; i < 40; i++) {
      v += String(i % 10);
      el.value = v;
      const t0 = performance.now();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      document.body.offsetHeight; // include style and layout
      out.push(performance.now() - t0);
    }
    return out;
  });
  const saves1 = await page.evaluate(() => window.__saves);
  const stat = (a) => {
    const s = a.slice().sort((x, y) => x - y);
    return { mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) };
  };

  // Keystrokes in the budget field on the Compress tab.
  await page.evaluate(() => document.querySelector('.tabs button:nth-child(2)').click());
  const budgetTimes = await page.evaluate(() => {
    const el = document.querySelector('#cmp-budget');
    const out = []; let v = '';
    for (let i = 0; i < 20; i++) {
      v += String(i % 10); el.value = v;
      const t0 = performance.now();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      document.body.offsetHeight;
      out.push(performance.now() - t0);
    }
    return out;
  });

  await page.waitForTimeout(1200); // let any debounced save finish so it is not measured
  // Ticking a habit checkbox (save + redraw), and adding a manual usage record (save + redraw + list).
  await page.evaluate(() => document.querySelector('.tabs button:nth-child(7)').click());
  const habitMs = await page.evaluate(() => {
    const cb = document.querySelector('#tip_1');
    const t0 = performance.now(); cb.click(); document.body.offsetHeight; return performance.now() - t0;
  });
  await page.evaluate(() => document.querySelector('.tabs button:nth-child(3)').click());
  const addMs = await page.evaluate(() => {
    document.querySelector('#use-tokens').value = '1234';
    const btn = [...document.querySelectorAll('#p-usage button')].find((b) => b.textContent === 'Add');
    const t0 = performance.now(); btn.click(); document.body.offsetHeight; return performance.now() - t0;
  });

  // Tab switching with real clicks (wall time from click to next frame).
  const tabMs = [];
  for (let i = 1; i <= 8; i++) {
    const ms = await page.evaluate((i) => {
      const b = document.querySelector('.tabs button:nth-child(' + i + ')');
      const t0 = performance.now(); b.click(); document.body.offsetHeight; return performance.now() - t0;
    }, i);
    tabMs.push(+ms.toFixed(2));
  }

  const result = {
    label,
    startup: {
      domContentLoadedMs: +nav.dcl.toFixed(1), loadMs: +nav.load.toFixed(1), navUiReadyMs: +readyAt.toFixed(1),
      interactiveIdleMs: +idleAt.toFixed(1), scriptMs: +startupScriptMs.toFixed(1), taskMs: +startupTaskMs.toFixed(1),
      longtasks: startup.longtasks, longtaskTotalMs: +startup.longtaskTotal.toFixed(1), maxLongtaskMs: +startup.maxLongtask.toFixed(1),
      domNodes: startup.nodes
    },
    blockLimitKeystroke: { ...stat(keyTimes), saves: saves1.n, saveMsTotal: +saves1.ms.toFixed(2), storedBytes: saves1.bytes },
    budgetKeystroke: stat(budgetTimes),
    habitToggleMs: +habitMs.toFixed(2),
    addRecordMs: +addMs.toFixed(2),
    tabSwitchMs: tabMs,
    errors: errors.slice(0, 5)
  };
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
