# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Workspace-level guidance (Martin's hard rules, Czech replies, Kritik review, no `localStorage` writes from tooling, no OneDrive, no auto-push) lives in `../../CLAUDE.md` and `~/.claude/CLAUDE.md`. This file only covers what's specific to **Investment Tools — main project**.

## What this is

Public-facing GitHub repo `martin1dlouhy/Main-Project`, deployed at https://main-five-alpha.vercel.app. A collection of vanilla HTML investment tools (debt calc, real estate prompt generator, S&P 500 breakdown, portfolio dashboards) and ProfiLend internal apps (Term Sheet, Loan Doc generator, Marketing Agent). Each app is one large, self-contained `.html` file with inline `<style>` and `<script>` — they share only `styles.css` (tokens + nav/footer) and `script.js` (theme toggle).

**Resist refactoring shared modules out of these files.** Self-containment is intentional — apps must remain copy-pasteable as standalone pages. 2–5k line files are normal here.

## Commands

No build, no lint, no test framework. Frontend is static HTML/CSS/JS served as-is.

**Run Railway backend locally** (the only thing with a runtime):
```
cd railway-api && npm install && npm start
```
Listens on `PORT` env (default 3001). Required env vars depend on which endpoints you exercise:
- `ANTHROPIC_API_KEY` — `/api/parse-lv`, `/api/generate-loan-doc`
- `OPENAI_API_KEY` — `/api/marketing/generate`, `/api/marketing/generate-image`
- `GEMINI_API_KEY` — fallbacks
- `PIN_HASH` — SHA-256 of the 4-digit PIN for `/api/verify-pin` (Term Sheet gate)

**Serve frontend locally:** any static server pointed at the project root. The frontend talks to Vercel functions in production and to the Railway server (hardcoded URLs in each HTML file). To point at local Railway during dev, edit the `RAILWAY_API` constant inside the HTML file you're testing.

**Deploy:** push to `main` on `martin1dlouhy/Main-Project`; Vercel auto-builds in ~30s. Railway auto-deploys its own repo on push to `railway-api/`. Prepare commands for Martin to run — never push automatically.

```
git add . && git commit -m "Fix: ..." && git push origin main
```

## Architecture: dual backend (the why)

Vercel serverless functions cap at 60s. Anything that needs longer or holds long-lived secrets goes to Railway Express. The split is **not** "frontend vs. backend logic" — it's "fast/stateless on Vercel, long/secret-heavy on Railway":

| Vercel (`api/*.js`) | Railway (`railway-api/server.js`) |
|---|---|
| `sp500.js` — Cheerio scrape, 24h cache | `/api/verify-pin` — PIN gate (rate-limited 5/5min/IP) |
| `parse-lv.js` — Claude LV parser, 60s max | `/api/parse-lv` — same parser, no timeout |
| `ares.js` — ARES company lookup, 15s | `/api/generate-loan-doc` — Claude DOCX template fill |
|  | `/api/marketing/generate` — OpenAI text gen |
|  | `/api/marketing/generate-image` — gpt-image-1.5 / DALL-E |

`vercel.json` declares per-function `maxDuration` — when adding a new Vercel function that needs more than 10s, add it to `vercel.json` or it'll be killed at default.

**CORS gotcha:** Railway uses a strict allowlist in `server.js` (`allowedOrigins`). Adding a new frontend host (preview deploy, custom domain) requires editing that array and redeploying — `*` is not configured.

## Theme system (DayNight)

`script.js` toggles class `.carbon` on both `<html>` and `<body>`, persisted to `localStorage` key `daynight-theme` (`"snow"` = light, `"carbon"` = dark). All colors come from CSS variables in `styles.css` — never hardcode hex in components, always `var(--accent)` etc. Full token reference in [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md). Adding a new app: copy [APP-TEMPLATE.html](APP-TEMPLATE.html) and leave `.top-nav`, `.footer`, and theme-toggle markup untouched.

## Frontend libraries (loaded via CDN per-app)

`jspdf`, `xlsx` / `xlsx-js-style`, `FileSaver.js`, `Chart.js 4.4.1`, `pizzip` / `jszip`, `pdf.js`. Don't introduce npm-side bundling — each HTML file pulls the libraries it needs from a CDN.

## Storage in apps (read-only from tooling)

Several apps persist user data in browser storage. **Never write test data here from tooling — real client data lives in production.** Notable keys:
- `daynight-theme` — theme pref (every app)
- Real Estate Prompt Generator — uses both `localStorage` and IndexedDB; also writes to user-granted directories via File System Access API (acts as OneDrive sync replacement).
- Term Sheet & Loan Documentation — saved drafts in `localStorage`.

## Testing this code

There's no automated suite. The Kritik skill auto-runs after every change — walk the full user flow (load → input → calc → export → theme toggle in both modes → mobile width) for the affected app before declaring done. UI changes need a manual browser check; "the diff looks right" isn't enough.

## Reference docs in this repo

- [INVESTMENT-TOOLS-OVERVIEW.md](INVESTMENT-TOOLS-OVERVIEW.md) — full per-app breakdown (line counts, features, status). Read this before touching an unfamiliar app.
- [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) — color tokens, spacing, components.
- [APP-TEMPLATE.html](APP-TEMPLATE.html) — boilerplate for new apps.
- [default-ai-prompt.md](default-ai-prompt.md) — master Claude prompt for the Real Estate valuator.
