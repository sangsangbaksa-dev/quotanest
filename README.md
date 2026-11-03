# Quotanest

A paid, browser-only workbench that helps Claude Code and Codex users use less of their 5-hour and weekly limits. Static site, no server of its own, no AI API calls, no account login. Data lives in `localStorage` on the device. 5 languages (en, ko, ja, zh, es).

Working name: the folder and the product name are not final. Check trademarks (KIPRIS / USPTO / EUIPO) before launch and rename the folder and `config.js` if needed. Names like "Claude", "Codex", "OpenAI" and "ChatGPT" are used only to describe compatibility, and the landing page carries a non-affiliation notice.

## What it does

- **Tokens**: heuristic token estimate with a ±30% range, calibrated against a number the user reads from their own tool.
- **Compress**: rule-based cleanup (filler words, repeated lines, long stack traces, extra spaces). Code fences are never touched. Shows the token difference.
- **Limits**: parses Claude Code JSONL and Codex JSONL (best effort) or a JSON array, or takes manual entries. Groups usage into 5-hour blocks and forecasts "at this pace, the limit in N hours". The limits are numbers the user types in. The app does not know or show official limits.
- **Model guide**: task type → light, middle or heavy tier with an estimated saving. The table is dated and editable.
- **CLAUDE.md / AGENTS.md check**: size, duplicate lines across both files, wordy lines, sections worth moving into separate imported files.
- **Resume**: extracts goal, decisions, touched files, errors and open items with rules (no AI) and builds a continuation prompt.
- **Tips**, **export / import JSON**, **delete all data**.

## Layout

- `index.html`, `landing.css`, `landing.js`: landing page.
- `privacy.html`, `terms.html`: legal pages, text in `i18n.js`.
- `i18n.js`: all user-visible strings (five languages, same keys).
- `config.js`: `siteUrl`, `checkoutUrl`, `price`. Change these before launch.
- `app/`: the app. `core.js` is pure logic (no DOM, no network) and is unit-tested. `app.js` builds the UI with `textContent` only.
- `functions/api/license.js` + `lib/license-core.js`: Cloudflare Pages Function for the licence check (Lemon Squeezy License API). Same contract as the other apps in this repository.
- `scripts/build.js`: writes `sitemap.xml` and `robots.txt`, and with `--dist` copies the public files to `dist/`.
- `test/`: `core.test.js`, `license.test.js`.

## Tests and build

```sh
cd quotanest
node --test test/*.test.js
node scripts/build.js --dist
```

## Deploy

`../.github/workflows/deploy-cloudflare.yml` tests, builds and deploys this folder to a Cloudflare Pages project named `quotanest` on pushes to `main`. The project must exist first (Cloudflare dashboard → Workers & Pages → Create → Pages → Direct Upload, name `quotanest`). Then set these variables on the project (Settings → Variables and Secrets):

- `LEMONSQUEEZY_PRODUCT_ID`: pins licence keys to this product.
- `LEMONSQUEEZY_DISABLED`: set to `1` to answer `configured: false`, which keeps the app open (the state before the product is on sale).

Before launch, set `checkoutUrl` in `config.js` to the Lemon Squeezy checkout link and `price` to the one-time price, then push.

## Behaviour when not on sale

If the server answers `configured: false`, the app opens without a key. If licensing is configured, the app shows the unlock screen, and a valid active key unlocks it on that device only.

## Known limits

- Token counts are estimates. The official tokenizers cannot run offline here.
- The Codex log format is read on a best-effort basis; unknown lines are ignored.
- The block limit and week limit are user input and are not official values.
