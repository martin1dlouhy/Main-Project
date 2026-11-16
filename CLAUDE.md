# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Workspace-level guidance (Martin's hard rules, Czech replies, Kritik review, no `localStorage` writes from tooling, no OneDrive, no auto-push) lives in `../../CLAUDE.md` and `~/.claude/CLAUDE.md`. This file only covers what's specific to **Investment Tools — main project**.

## What this is

**Martin's personal web of tools.** GitHub repo `martin1dlouhy/Main-Project`, deployed at https://main-five-alpha.vercel.app. Vanilla HTML apps, each one large self-contained `.html` file with inline `<style>` and `<script>`:

- **Osobní:** `debt-calculator.html`, `real-estate-prompt-generator.html`, `sp500-calculator.html`
- **Private Credit** (lending tools Martin uses for Spolumajitelé Private Credit a.s. until its own internal app exists): `termsheet-generator.html`, `loan-documentation.html`, `marketing-agent.html`, `database.html`, `crm.html`
- **Dashboard:** `dashboard.html` (case pipeline on Google Sheets, events from the other apps via `dashboard-bridge.js`)
- Landing `index.html`, catalogue `apps.html`

Martin does not want the name of his former company anywhere visible on this web (since 2 Oct 2026). Lender in documents and AI prompts = Spolumajitelé Private Credit a.s. Business facts come from `../SPM - Private Credit/` (introduction + website texts).

**Resist refactoring shared modules out of these files.** Self-containment is intentional. 2–7k line files are normal here.

## Shared modules

- `design-system/` — `tokens.css` (editorial dark palette, amber accent, Fraunces + Inter + JetBrains Mono, 1440 px container, legacy DayNight aliases), `app-shell.css` (nav, buttons, inputs, custom dropdown, tables, info-notes, toast), `apps-list.css` (index + apps only), `nav.js` (nav dropdowns, custom dropdown widget: `convertSelectsToDropdowns(selector)`, `syncCustomDropdown(id)`). Rules in skill `web-app-builder`.
- `profilend-auth.js` — unified 6-digit PIN → device token (~90 days) → Google token + AI session token. **Internal identifiers keep the legacy name on purpose** (file name, `window.ProfilendAuth`, `localStorage` keys `profilend-device-token`, `profilend-session-token`); renaming them would log out every device.
- `google-drive-sync.js` — `GDriveSync` (save/load/list on Drive). Root folder `Investment Tools`; the legacy root folder name is still looked up as a fallback (`LEGACY_ROOT_FOLDER_NAME`) until Martin renames the folder on Drive. Same fallback in `dashboard.html` and `database.html`.
- `dashboard-bridge.js` — localStorage event bus between apps and the Dashboard.

Other intentional legacy identifiers: IndexedDB `ProfiLendTermSheets`, CSS class `.profilend-badge`, Marketing Agent brand slug `profilend` and Drive path `brand-assets/profilend/`, Dashboard `LEGACY_SHEET_TITLE` (fallback lookup of the old Google Sheet name, same idea as `LEGACY_ROOT_FOLDER_NAME`) — stored user data depends on them.

## CRM (`crm.html`, since Nov 2026)

People Martin has a business relationship with (intermediaries and clients). `database.html` stays the LinkedIn prospecting tool; only people who replied move to the CRM. Spec: `claude-workspace/specs/2026-11-12-crm-etapa-1-design.md` (stage 1; deployment 1 = people, card, table import; deployment 2 = „Dnes“, contact log, bulk e-mail copy, settings, backup). Stage 1 (both deployments), stage 2 (saved recipient lists, e-mail templates, Outlook draft, salutations and mail-merge table) and stage 3 (hand-over from Database, cases from the Dashboard, partner numbers) are built (12–13 Nov 2026).

- **Demo mode is automatic on `localhost` / `127.0.0.1` and cannot be switched off there.** It is decided before anything touches `ProfilendAuth` or `localStorage`: made-up people, no Google, no Railway, no ARES, no browser storage. The code is the same as on the live site; only `gfetch` is answered by an in-memory fake of Drive + Sheets (`createFakeGoogle`) that enforces the real grid limits (26 columns × 1000 rows until expanded), shifts rows on delete and can return 401 / 429 on request (`window.__crmFake.failNext`). Test here, never on Martin's data.
- **Storage:** Google Sheet „Investment Tools CRM“ in `Investment Tools/CRM`, tabs `Lide`, `Historie`, `Nastaveni`; its id in `localStorage` `crm-sheet-id`. New columns only at the end.
- **Write layer follows `database.html`, not the Dashboard:** one write queue, grid expansion before every write, people are patched by `id` with only the changed cells, and `aktualizovano` is compared first (a stale tab must not overwrite a newer change → conflict, reload).
- **„Neposílat“ is tracked per e-mail address, not per card.** Unsubscribing is permanent (re-enable only with a newly recorded consent). Erasing a person can leave a stub row with fingerprints only (`otisk_email`, `otisk_telefon`, `otisk_jmeno`); rows with an empty `typ` are stubs and never shown.
- Defaults by source (`ZDROJ_DEFAULTS`): people from ads get „Neposílat“ until they consent, everyone else „Posílat“ (Martin's decision, 12 Nov 2026).
- Every text from the sheet or an uploaded file goes through `escapeHtml`; values are written `RAW`.
- **„Dnes“ (`computeDnes`)**: every step with a deadline today or earlier is always shown; rhythm adds people with importance A / B after `rytmus_a_dni` / `rytmus_b_dni` days without a personal contact (phone, e-mail, meeting; counted from the later of `posledni_kontakt` and `rytmus_od`, empty = immediately). Rhythm slots = `strop_denne` − open due steps − people contacted today; „Ukázat dalších 5“ adds slots until reload. Settings live in the `Nastaveni` tab, defaults in `DEFAULTS`.
- **Contact log (`logContact`)**: the history row and the changed person cells go out in one `values:batchUpdate`. Each opening of the window gets one entry id, and a retry first checks whether that id is already in `Historie`, so a repeated save cannot duplicate it. A contact logged for an earlier day is stored as `YYYY-MM-DDT12:00:00` without a zone; always read the day through `histDay()`.
- **Bulk e-mail**: recipients are the visible people for whom `mailBlockReason()` returns `''` (it also checks other cards and stub fingerprints with the same address). Addresses are only copied for classic Outlook (BCC), nothing is sent from the app. Only one batch can be open at a time; it is remembered in `Nastaveni` under `rozesilka_rozpracovana` (JSON: `den`, `ids`, `nazev`, `davka`) and „Odesláno, zapsat“ is idempotent through the shared `davka_id`.
- **Stage 2 storage:** two more tabs, `Seznamy` and `Predlohy`, and one more `Lide` column, `osloveni` (the full tab list is `ALL_TABS`; an older sheet gets the tabs and the column on the next load). A list is either `pravidlo` (people who match the stored filters right now, same rules as the list tabs: `matchRule`) or `rucni` (ids in the JSON cell `clenove`; ids of erased people are ignored and dropped on the next save). Lists and templates are patched through `patchRowById` with the same `aktualizovano` conflict check as people.
- **Outlook draft (`buildDraftEml`)**: a downloaded `.eml` with `X-Unsent: 1` (pattern from `buildReviewEml` in the R-E app). **Recipients are never written into the file**: classic Outlook does not reliably read `Bcc` from an `.eml`, so the addresses go to the clipboard and Martin pastes them into „Skrytá kopie“. `To:` is added only when the setting `adresa_komu` is filled (not verified in his Outlook; the header set without it is). Signature, company identification and the opt-out sentence come from settings (`podpis`, `paticka_firmy`, `veta_odhlaseni`) and are appended by `buildMailText` / `buildMailHtml`; the hex colours there belong to the e-mail, not to the app.
- **Built-in templates (`BUILTIN_TPL`)** follow `SPM - Private Credit/marketing/pokyny-marketing.md` (facts from ch. 1, vykání, „úvěr“, labelled model example, no exclamation marks). Change them only together with those guidelines.
- **Salutations (`suggestSalutation`, `vocWord`)** are rule-based guesses of the Czech vocative. They are always shown as a suggestion Martin confirms (form button „Navrhnout“, bulk window „Doplnit oslovení“); the mail-merge table falls back to „Dobrý den“ when nothing is stored. Never write a guessed salutation without his confirmation.
- **Stage 3, Database → CRM:** `database.html` has a „Do CRM“ button (detail footer and the „Mají zájem“ cards) that calls `sendToCrm(id)`: it writes `{ ts, data }` to `localStorage` under `crm-handoff` (same one-shot, 10-minute pattern as `dashboard-bridge.js`) and opens `crm.html` in a new tab. The CRM takes it once after loading (`takeHandoff` → `applyHandoff`), opens the pre-filled add form and saves only when Martin confirms; `ext_id = 'db:<id>'` prevents a second card. Nothing is written back to Database. The button is purely additive in `database.html`; keep it that way.
- **Stage 3, Dashboard → CRM (read-only):** the Dashboard is never modified. Its `Pripady` tab has no partner id (only the free-text `zdroj`), no loan maturity, and uses 25 of the default 26 columns with no grid expansion, so adding columns there would break saving. The CRM reads the tab (`loadCases`, sheet id from the Dashboard's `dashboard-sheet-id` key, fallback lookup by name) and keeps the person ↔ case links in its own tab `Vazby` (`vztah`: `privedl`, `klient`, `bez_partnera`). If the Dashboard cannot be read, `state.casesOk` is false and the CRM runs without cases. Cases merged in the Dashboard (`vysledek = slouceno`) are hidden from pickers and not counted.
- **Stage 3, „Dnes“:** `eventTrigger()` adds two event reminders on top of the rhythm: a partner whose last brought case is older than 60 days, and a client whose loan maturity (`Lide.splatnost`, typed on the card because the Dashboard has no such date) is within 90 days. Both shorten the rhythm to 30 days and also apply to importance C. A bar on „Dnes“ lists Dashboard cases past valuation with no partner assigned (`unassignedCases`).
- **Morning reminders:** the scheduled task `spm-ranni-pripominky` only adds a one-line pointer to the CRM. It cannot list names: the Drive connector returns just a sample of a sheet's rows, so reading the CRM sheet there would be unreliable.
- **Testing these parts in the demo:** the demo seeds a second in-memory book as a made-up Dashboard (`sheet_dash_ukazka`); test the hand-over with `window.__crm.applyHandoff(data)`, and test `sendToCrm` by extracting the function from `database.html` and running it with stand-in `state`, `toast`, `window` and `localStorage` (do not load `database.html` on localhost, it has no demo mode). Stub `navigator.clipboard.writeText` and `document.execCommand` first (never touch Martin's real clipboard), stub `HTMLAnchorElement.prototype.click` and `XLSX.writeFile` before any download path (draft, mail-merge table), never click „Stáhnout zálohu“ (call `window.__crm.buildBackup()` and inspect the workbook), and check the phone layout at 375 px with the viewport tool; the preview pane's own width (about 600 px) hides overflow.
- **Building a larger change while an earlier one waits for Martin's deploy:** work in a copy such as `crm-etapa2.wip.html` listed in `.git/info/exclude` (served by the preview, invisible to `git add .`), then copy it over `crm.html` when it is finished. Otherwise his pending deploy command would publish half-built code.

## Database: tab „Web“ (`database.html`, since 16 Nov 2026)

Outreach to firms through their contact form or by e-mail, at Martin's own pace (no daily cap). The app sends nothing: it opens the contact page with the message already in the clipboard, or downloads an Outlook draft, and records what Martin did. All code sits between the markers `// >>> WEB-START` and `// <<< WEB-END` at the end of the script (functions `web*`, state `state.web`).

- **The list is a Google Sheet prepared by Claude** (one row = one website; columns `pořadí, firma, otevřít (kontakt), jak napsat, e-mail z webu, stav, datum, poznámka, …`). Columns are found by header name. Its id comes from an app-created mailbox doc „Web oslovení – odkaz (nemazat, spravuje Claude) – <ID>“ (same idea as the LinkedIn batches: the app only sees Drive files it created, so Claude switches lists by renaming that doc through the Drive connector), fallback `WEB_SEZNAM_VYCHOZI`. It loads only when the tab is opened and again after every sync.
- **State lives in that sheet, not in Contacts:** „Odesláno“, „Nejde“ and „Vrátit“ write only the cells `stav` and `datum` of the row, which is located by `pořadí` in the current sheet right before each write (Martin may sort the sheet). Anything Martin types into `stav` by hand counts as handled (`webState`). In test mode (`?testSheet=`) nothing is written to the list, because it is shared with the live database.
- **Contacts gets a record only for „Ozval se“ and „Nemá zájem“**: a firm without a contact person, `spolehlivost = 'web-seznam'` (`WEB_SPOLEHLIVOST`). Contacts is written first, the list second, and a repeated click patches the same record (`webFindContact`: same IČO or same web host). „Ozval se“ opens the contact detail so Martin can add the person's name (needed for „Do CRM“).
- **A firm that refused is skipped in the LinkedIn batches too**: `liBatchView` drops batch rows whose IČO or normalised firm name matches a `web-seznam` record with a refusal. This is the only change outside the Web block; LinkedIn queues ignore these records (no `li_pozvanka_kdy`, not `claude-kandidat`).
- **Texts are Martin's own** (`SPM - Private Credit/marketing/predstaveni/texty-oslovovani.md`, 16 Oct 2026): `webTextFormular()`, `webTextEmail()`, subject `WEB_PREDMET`. Never reword them without asking. The e-mail text carries the signature block, because a draft opened from a file gets no Outlook signature.
- **Outlook draft (`webBuildEml`)**: `.eml` with `X-Unsent: 1`, `To:` and the presentation PDF attached, the same structure as the pre-made drafts in `SPM - Private Credit/obchod/web-osloveni/koncepty-emailu`. The PDF is fetched from `assets/spolumajitele-private-credit-predstaveni.pdf`, a copy of `SPM - Private Credit/marketing/predstaveni/Spolumajitelé Private Credit - představení.pdf`: replace the copy whenever the presentation changes. Whether classic Outlook keeps `To:` and the attachment from such a file was not verified by tooling (`OpenSharedItem` does not open `.eml`); Martin checks the first draft.
- **Testing:** `_web.test.html` (ignored through `.git/info/exclude`, never deployed) pulls the styles, the section markup, the Web block and the named helper functions out of `database.html` and runs them over an in-memory fake of Drive + Sheets with made-up firms; the clipboard, downloads, `confirm` and links to new tabs are replaced by recorders (`window.__t`). It also syntax-checks the whole inline script. Open `http://127.0.0.1:3000/_web.test.html` (`?n=1200` large list, `?test=1` test mode, `?delay=40` slow network). Never test this tab on Martin's data.

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

**CORS gotcha:** strict allowlist `allowedOrigins` in `server.js`; `*` is not configured. Production domain stays `main-five-alpha.vercel.app` (Martin's decision, 6 Oct 2026). The alias `investment-tools-md.vercel.app` was added in Vercel and is listed in the allowlists (`server.js`, `api/ares.js`, `api/parse-lv.js`) but isn't used. A new frontend origin must be added in all three places, and in Google Cloud Console → OAuth client → Authorized JavaScript origins (GIS fallback login).

## Access gate (whole site behind the PIN, since Oct 2026)

- `proxy.ts` (Vercel Routing Middleware, wired via `vercel.json` → `proxy.entrypoint` + `proxy.matcher`) guards `/`, every `*.html` and every `/api/*` except `/login.html`, `/api/login`, `/api/logout` and `/privacy.html` (public privacy policy, required by Google for the OAuth app in production; no data). The entrypoint must end in `.js`/`.ts` (`.mjs` fails the build); TypeScript keeps it ESM while the rest of the project is CommonJS. It's written to type-check without Node types (`@ts-ignore` on the `node:crypto` import, `declare const process`). Without a valid cookie: pages → 302 `/login.html?next=…`, API → 401 JSON. Shared CSS/JS/images stay public (no data, app logic is inline in the HTML).
- Cookie `it_auth` = Railway `deviceToken` (`exp.HMAC-SHA256(key=PIN_HASH, 'device:'+exp)`, 90 days), set by `api/login.js`: `{deviceToken}` from `localStorage` (already registered device, no PIN) or `{pin}` → forwarded to Railway `/api/device/register` (rate limits + global daily fail cap live there). On success `login.html` stores the tokens under the `profilend-auth.js` keys, so Drive/AI don't ask again.
- **`PIN_HASH` must be identical on Railway and on Vercel** (Production + Preview). Changing the PIN = new hash on both → every device and cookie is logged out. Hash helper: `claude-workspace/outputs/2026-10-06_novy-pin-hash.ps1`.
- Server-side Google access = Railway `GOOGLE_REFRESH_TOKEN`. If it stops working (`invalid_grant` → apps fall back to manual „Připojit Google Drive“, lawyer sees „Přístup k Martinovu Google Drive vypršel“), Martin renews it via `google-setup.html` (owner only → Railway `/api/google/setup` → copy the shown token to Railway Variables → Deploy). The OAuth app (Google Cloud project „Trading“, client `765274611389-…`) must be **In production**: in Testing, Google expires refresh tokens after 7 days.
- `railway-api` is in `.vercelignore` (backend source must not be served by Vercel). Marketing endpoints on Railway require the session token (`X-Database-Token`) like the other AI endpoints.
- Test gate changes on a preview branch first; production rollback = Vercel → Deployments → Instant Rollback.
- **Lawyer access (since Oct 2026)** — a second 6-digit code, env `LAWYER_PIN_HASH` (Railway + Vercel, must differ from `PIN_HASH`; missing or equal = lawyer access off). Token `exp.lawyer.HMAC-SHA256(key=LAWYER_PIN_HASH, 'lawyer:'+exp)`: every owner check rejects it, so the lawyer never gets the Google token, an AI session or `/api/google/setup`. `proxy.ts` lets it reach only `/loan-documentation.html` and `/api/ares` (other pages → 302 there, other APIs → 403); `/api/logout` (public) clears the cookie, `login.html?odhlasit=1` also clears the stored tokens. Railway `/api/lawyer/templates|template|termsheet` serve templates from `Investment Tools/Šablony/Úvěrová dokumentace` and a single Term Sheet by id (without `notes`/`status`) read-only with the server's Google token; `/api/generate-loan-doc/preview` also accepts `lawyerToken`. In `loan-documentation.html` `LAWYER_MODE` (`ProfilendAuth.isLawyer()`) = own IndexedDB `loanDocDB-advokat`, no `GDriveSync`, templates mirrored by `syncLawyerTemplates`, template/category management blocked (`lawyerReadOnly`), CSS classes `lawyer-only` / `owner-only`. Hash helper: `claude-workspace/outputs/2026-10-21_kod-advokata-hash.ps1`. Revoke = delete `LAWYER_PIN_HASH` on both (Railway Deploy, Vercel Redeploy).

## Storage in apps (read-only from tooling)

Real user data lives in the browser and on Google Drive / Sheets. **Never write test data from tooling.** Notable: R-E `saved-valuations` + IndexedDB `re-prompt-backup`; Term Sheet IndexedDB `ProfiLendTermSheets`; Loan Doc IndexedDB `loanDocDB` (lawyer mode: `loanDocDB-advokat`); Marketing Agent `brand-preset-<slug>` + IndexedDB `MarketingAgentDB`; Dashboard `dashboard-sheet-id`, `dashboard-sort`; CRM `crm-sheet-id` (data in its own Google Sheet) and the short-lived `crm-handoff` (a contact handed over from Database, removed by the CRM when read); shared Google token `gdrive-shared-token`.

Loan Doc templates: the Drive folder `Investment Tools/Šablony/Úvěrová dokumentace` is the source of truth.
- Both modes mirror it **by version**: each IndexedDB record keeps `driveId` + `driveModified`. The owner does this in `syncTemplatesFromDrive`, the lawyer in `syncLawyerTemplates`.
- Legacy records without these fields are compared by size and upload time (`compareWithDrive`).
- Deleting a template, finishing a pending deletion (`loanDoc.deletedTemplates` + `loanDoc.deletedTemplateVersions`) and „Nahrát vše na Drive“ change Drive only when Drive still has the same version. They never overwrite or trash a newer version uploaded from another device.

## Testing this code

No automated suite. Kritik walkthrough after every change: load → input → calc → export for the affected app, check the browser console, check mobile width. "The diff looks right" isn't enough.

## Reference

- [default-ai-prompt.md](default-ai-prompt.md) — master prompt for the Real Estate valuator.
- [APP-TEMPLATE.html](APP-TEMPLATE.html), [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) — legacy DayNight; for new apps follow skill `web-app-builder` instead.
- `_archiv/` — outdated project overviews and design handoff, kept for history only.
