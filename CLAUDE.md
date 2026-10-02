# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Workspace-level guidance (Martin's hard rules, Czech replies, Kritik review, no `localStorage` writes from tooling, no OneDrive, no auto-push) lives in `../../CLAUDE.md` and `~/.claude/CLAUDE.md`. This file only covers what's specific to **Investment Tools — main project**.

## What this is

**Martin's personal web of tools.** GitHub repo `martin1dlouhy/Main-Project`, deployed at https://main-five-alpha.vercel.app. Vanilla HTML apps, each one large self-contained `.html` file with inline `<style>` and `<script>`:

- **Osobní:** `debt-calculator.html`, `real-estate-prompt-generator.html`, `sp500-calculator.html`
- **Private Credit** (lending tools Martin uses for Spolumajitelé Private Credit a.s. until its own internal app exists): `termsheet-generator.html`, `loan-documentation.html`, `marketing-agent.html`, `database.html`
- **Dashboard:** `dashboard.html` (case pipeline on Google Sheets, events from the other apps via `dashboard-bridge.js`)
- Landing `index.html`, catalogue `apps.html`

Martin does not want the name of his former company anywhere visible on this web (since 2 Oct 2026). Lender in documents and AI prompts = Spolumajitelé Private Credit a.s. Business facts come from `../SPM - Private Credit/` (introduction + website texts).

**Resist refactoring shared modules out of these files.** Self-containment is intentional. 2–7k line files are normal here.

## Shared modules

- `design-system/` — `tokens.css` (editorial dark palette, amber accent, Fraunces + Inter + JetBrains Mono, 1440 px container, legacy DayNight aliases), `app-shell.css` (nav, buttons, inputs, custom dropdown, tables, info-notes, toast), `apps-list.css` (index + apps only), `nav.js` (nav dropdowns, custom dropdown widget: `convertSelectsToDropdowns(selector)`, `syncCustomDropdown(id)`). Rules in skill `web-app-builder`.
- `profilend-auth.js` — unified 6-digit PIN → device token (~90 days) → Google token + AI session token. **Internal identifiers keep the legacy name on purpose** (file name, `window.ProfilendAuth`, `localStorage` keys `profilend-device-token`, `profilend-session-token`); renaming them would log out every device.
- `google-drive-sync.js` — `GDriveSync` (save/load/list on Drive). Root folder `Investment Tools`; the legacy root folder name is still looked up as a fallback (`LEGACY_ROOT_FOLDER_NAME`) until Martin renames the folder on Drive. Same fallback in `dashboard.html` and `database.html`.
- `dashboard-bridge.js` — localStorage event bus between apps and the Dashboard.

Other intentional legacy identifiers: IndexedDB `ProfiLendTermSheets`, CSS class `.profilend-badge`, Marketing Agent brand slug `profilend` and Drive path `brand-assets/profilend/` (stored user data depends on them).

## Commands

No build, no lint, no test framework. Frontend is static HTML/CSS/JS served as-is.

**Local preview:** `.claude/launch.json` config `static` (port 3000, `.claude/serve.ps1`).

**Run Railway backend locally:**
```
cd railway-api && npm install && npm start
```
Listens on `PORT` env (default 3001). Env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PIN_HASH`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (optional `GOOGLE_CLIENT_ID`).

**Deploy:** push to `main` on `martin1dlouhy/Main-Project`; Vercel auto-builds in ~30 s, Railway redeploys `railway-api/`. Prepare commands for Martin — never push automatically. `.vercelignore` keeps `_archiv/` and all `*.md` off the public web.

## Architecture: dual backend (the why)

Vercel serverless functions cap at 60 s. Long-running or secret-heavy work goes to Railway Express:

| Vercel (`api/*.js`) | Railway (`railway-api/server.js`) |
|---|---|
| `sp500.js` — Cheerio scrape, 24h cache | `/api/verify-pin`, `/api/device/*`, `/api/google/*` — PIN, device tokens, Google refresh-token flow |
| `parse-lv.js` — Claude LV parser, 60s max | `/api/parse-lv` — same parser, no timeout |
| `ares.js` — ARES company lookup, 15s | `/api/generate-loan-doc` (+ `/preview`) — Claude/OpenAI DOCX template fill |
|  | `/api/marketing/generate`, `/generate-image` — OpenAI text + images |
|  | `/api/database/find-contacts`, `/build-prompt` — AI contact discovery |

The loan-doc system prompt exists twice: `buildLoanDocSystemPrompt` in `server.js` and the preview copy `buildSystemPromptPreview` in `loan-documentation.html`. Keep them identical.

**CORS gotcha:** strict allowlist `allowedOrigins` in `server.js`; `*` is not configured.

## Storage in apps (read-only from tooling)

Real user data lives in the browser and on Google Drive / Sheets. **Never write test data from tooling.** Notable: R-E `saved-valuations` + IndexedDB `re-prompt-backup`; Term Sheet IndexedDB `ProfiLendTermSheets`; Loan Doc IndexedDB `loanDocDB`; Marketing Agent `brand-preset-<slug>` + IndexedDB `MarketingAgentDB`; Dashboard `dashboard-sheet-id`, `dashboard-sort`; shared Google token `gdrive-shared-token`.

## Testing this code

No automated suite. Kritik walkthrough after every change: load → input → calc → export for the affected app, check the browser console, check mobile width. "The diff looks right" isn't enough.

## Reference

- [default-ai-prompt.md](default-ai-prompt.md) — master prompt for the Real Estate valuator.
- [APP-TEMPLATE.html](APP-TEMPLATE.html), [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) — legacy DayNight; for new apps follow skill `web-app-builder` instead.
- `_archiv/` — outdated project overviews and design handoff, kept for history only.
