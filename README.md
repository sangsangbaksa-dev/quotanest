# Quotanest

A paid, browser-only workbench that helps Claude Code and Codex users use less of their 5-hour and weekly limits. Static site, no server of its own, no account login. Data lives in `localStorage` on the device. 5 languages (ko default, en, ja, zh, es). The language follows the browser when it is one of the five, and the choice is saved in `localStorage` (`quotanest.v1`).

The only network call is optional: an AI explanation that goes straight from the browser to the Anthropic API, and only when you have saved your own API key and pressed its button (see "AI analysis" below). Without a key the app makes no AI calls at all.

Working name: the folder and the product name are not final. Check trademarks (KIPRIS / USPTO / EUIPO) before launch and rename the folder and `config.js` if needed. Names like "Claude", "Codex", "OpenAI" and "ChatGPT" are used only to describe compatibility, and the landing page carries a non-affiliation notice.

## What it does

- **Tokens**: heuristic token estimate with a ±30% range, calibrated against a number the user reads from their own tool.
- **Compress**: rule-based cleanup (filler words, repeated lines, long stack traces, extra spaces). Code fences are never touched. Shows the token difference. Optional token budget for the prompt shows what is left, or how far over it is.
- **Limits**: parses Claude Code JSONL and Codex JSONL (best effort) or a JSON array, or takes manual entries. Groups usage into 5-hour blocks and forecasts "at this pace, the limit in N hours". Shows the time until the current block resets, a log of the last 10 blocks, a 7-day bar chart (inline SVG, per local day), and when the oldest counted record leaves the 7-day window. The limits are numbers the user types in. The app does not know or show official limits.
- **AI analysis (optional)**: in the Limits tab, a local summary is always shown: the trend over the last 7 days against the 7 days before, how many recent 5-hour blocks reached 80% of the block limit, and a suggested block and weekly limit for next month based on the user's own history (90th percentile block and busiest week, each with 10% headroom). With an Anthropic API key saved on this device, "Explain with AI" sends a short explanation request. See below.
- **Model guide**: task type → light, middle or heavy tier with an estimated saving. The table is dated and editable. A per-task cost estimate (prompt size × turns, minus the table saving, as a share of the block limit) sits under it. It is a rough estimate.
- **CLAUDE.md / AGENTS.md check**: size, duplicate lines across both files, wordy lines, sections worth moving into separate imported files.
- **Resume**: extracts goal, decisions, touched files, errors and open items with rules (no AI) and builds a continuation prompt.
- **Tips**: the eight token-saving habits as a checklist with progress. Checked items are saved on this device.
- **Limit alerts and summary**: the current block shows a warning from 80% of the block limit and an error at 100%. A plain-text summary of the block and the last 7 days can be copied. The chart range (7, 14 or 28 days) is set in Limits. The 10 most recent records can be deleted one by one.
- **Settings theme**: light, dark or follow the system. The choice is stored on this device only.
- **Export / import JSON**: the export covers records, limits, calibration, the model table, habits and budget (not the licence and not the API key). Import checks the file and drops bad rows; it replaces the data on this device and reloads the app. **Delete all data** also removes the saved API key.

## AI analysis

- **Model**: `claude-haiku-5-5`, called as `POST https://api.anthropic.com/v1/messages` with the header `anthropic-dangerous-direct-browser-access: true`. There is no backend, and no other host is contacted.
- **Key**: optional. Paste your own key in the Limits tab and press "Save key". It is stored in `localStorage` under `quotanest-ai-key`, separate from the app data, so it is not in exports. "Forget key" removes it. The key is never sent anywhere except `api.anthropic.com`.
- **When it runs**: only when you press "Explain with AI". Nothing is sent on load, on typing or on a timer. The request has a 30-second timeout.
- **What is sent**: only the summary numbers (weekly totals, daily activity, 5-hour block statistics, your typed limits and the local suggestion), plus the reply language. No records, timestamps, logs, text or file names are sent.
- **Reply handling**: the reply is shown as plain text (`textContent`), never as HTML. Errors (rejected key, HTTP error, network failure, empty reply) show a message and leave the local summary in place.
- **Pure logic**: `usageHistory`, `usageSummary`, `suggestLimits`, `localAdvice`, `buildUsagePrompt`, `buildAiRequest`, `parseAiReply`, `isPlausibleKey` and `sanitizeText` are in `app/core.js` and tested in `test/ai.test.js` without any network.
- **Content security**: `_headers` allows `https://api.anthropic.com` in `connect-src`, and nothing else new.

## Layout

- `index.html`, `landing.css`, `landing.js`: landing page.
- `privacy.html`, `terms.html`: legal pages, text in `i18n.js`.
- `i18n.js`: all user-visible strings (five languages, same keys; `ai_*` keys included).
- `config.js`: `siteUrl`, `checkoutUrl`, `price`. Change these before launch.
- `app/`: the app. `core.js` is pure logic (no DOM, no network, no storage) and is unit-tested; it also holds the import check (`normalizeImport`) and the AI helpers. `app.js` builds the UI with `textContent` only and builds each tab the first time it is opened.
- `functions/api/license.js` + `lib/license-core.js`: Cloudflare Pages Function for the licence check (Lemon Squeezy License API). Same contract as the other apps in this repository.
- `scripts/build.js`: writes `sitemap.xml` and `robots.txt`, and with `--dist` copies the public files to `dist/`.
- `scripts/profile.cjs`: the profiling harness used for the numbers below (Playwright).
- `test/`: `core.test.js`, `ai.test.js`, `license.test.js`.

## Storage

- `quotanest.v1`: settings, limits, calibration, model table, habits, budget, theme, chart range and licence state.
- `quotanest.v1.records`: the usage records (up to 5000). Written only when they change. Versions before this split kept the records inside `quotanest.v1`; they are read automatically and moved on the next save.
- `quotanest-ai-key`: the optional API key.

## Performance

The app was profiled before the AI feature was added and again after. Method: `node scripts/profile.cjs <url> <label>` with Playwright in Chromium, a 390×844 viewport, a 4x CPU slowdown (a phone-class CPU), 5000 records in storage, and about 40 KB of pasted text in the Tokens, Compress, CLAUDE.md and Resume tabs. Keystroke numbers are the main-thread time of each `input` event, including the forced layout after it. Measured on a sandbox Linux container, so compare the ratios, not the absolute values.

| Measure | Before | After |
| --- | --- | --- |
| Script time at startup | 134 ms (one 134 ms long task) | 27 ms (no long tasks) |
| DOM nodes at startup | 402 | 72 |
| Limit field keystroke, mean / p95 | 37.5 ms / 45.1 ms | 6.4 ms / 8.7 ms |
| `localStorage` writes during 40 limit keystrokes | 40 writes of 500 KB each | 0 during typing; one write 400 ms after typing stops |
| Budget field keystroke, mean | 9.0 ms | 1.0 ms |
| Habit checkbox toggle | 13.4 ms | 1.4 ms |
| Add one usage record | 39 ms | 37 ms (rewrites the record list, expected for a discrete save) |
| Tab switch, first visit | 9–64 ms (all panels built at startup) | 19–68 ms (the first visit now builds the tab, about 15 ms) |

What changed:

- Typing in a limit field redraws only the Limits panel and schedules a save. Before, every keystroke redrew every tab, and the tabs that had already been run re-ran their analyses (compress, CLAUDE.md, resume, tokens) on the pasted text.
- Tabs are built the first time they open, so startup builds one panel instead of eight.
- The records are stored under their own key and rewritten only when they change. Habit, theme and limit saves no longer serialise the whole history.
- Keystroke-driven fields debounce their save, and a pending save is flushed on `pagehide` and when the page is hidden.
- `Intl` date and number formatters are created once per language instead of on every call.
- The record list is rebuilt only when the records, language or metric change, not on every redraw.
- The 28-day usage history is cached per records revision and minute, so a limit keystroke only re-applies the limits. The forecast skips its sort when the records are already in order.

Remaining cost, not fixed: showing a tab that holds about 40 KB of text in a `textarea` costs about 45 ms at 4x in the browser's own layout (measured separately: about 5 ms with empty fields). Adding a record rewrites the full record list, about 500 KB at 5000 records.

## Tests and build

```sh
cd quotanest
node --test test/*.test.js
node scripts/build.js --dist
```

Test counts: 44 in total (`core.test.js` 21, `license.test.js` 4, `ai.test.js` 12, `i18n.test.js` 7). `i18n.test.js` fails if any key is missing, empty or has different placeholders in any language, or if a page or script asks for a key the dictionary does not define.

## Deploy

`.github/workflows/deploy-cloudflare.yml` tests, builds and deploys this folder to a Cloudflare Pages project named `quotanest` on pushes to `main`. The project must exist first (Cloudflare dashboard → Workers & Pages → Create → Pages → Direct Upload, name `quotanest`). Then set these variables on the project (Settings → Variables and Secrets):

- `LEMONSQUEEZY_PRODUCT_ID`: pins licence keys to this product.
- `LEMONSQUEEZY_DISABLED`: set to `1` to answer `configured: false`, which keeps the app open (the state before the product is on sale).

Before launch, set `checkoutUrl` in `config.js` to the Lemon Squeezy checkout link and `price` to the one-time price, then push.

## Behaviour when not on sale

If the server answers `configured: false`, the app opens without a key. If licensing is configured, the app shows the unlock screen, and a valid active key unlocks it on that device only.

## Known limits

- Token counts are estimates. The official tokenizers cannot run offline here.
- The Codex log format is read on a best-effort basis; unknown lines are ignored.
- The block limit and week limit are user input and are not official values. The suggested limits are arithmetic on the user's own history, not a forecast of any provider's limits.
- The AI explanation is a model's text and can be wrong. It is given numbers only and is told not to state official limits.
- The API key sits in `localStorage`, which any script on the same origin could read. The app loads no third-party scripts. Use a key with a spending limit.

## Translations and review status

Five languages are in `i18n.js`: Korean (default), English, Japanese, Chinese (Simplified) and Spanish. Translations are written as natural text, not word for word.

Legal, tax and financial wording in the privacy policy, terms and the price line is machine-assisted and reviewed by native speaker: no. Before launch, have a native speaker check these keys in `ja`, `zh` and `es` (and `en` for the legal pages):

- `priv_*`, `terms_*` (privacy and terms text), `nonaff` (non-affiliation line), `cta_price`, `price` wording
- `footer_note`

Korean legal wording is also not checked by a lawyer; treat the pages as drafts.
