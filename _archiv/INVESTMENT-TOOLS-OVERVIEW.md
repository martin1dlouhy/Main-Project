# Investment Tools — Kompletni prehled projektu

> **Verze:** 2.0
> **Aktualizovano:** 16. dubna 2026
> **Autor:** Claude (pro Martina Dlouheho)
> **Ucel:** Referencni dokument celeho projektu — architektura, stav, funkce, plany

---

## 1. O projektu

**Investment Tools** je webova platforma profesionalnich investicnich nastroju — kalkulacek, generatoru, dashboardu a internich nastroju pro ProfiLend. Platforma slouzi investicnim profesionalum ke sprave financi, analyze dluhoveho financovani a ocenovani nemovitosti v kontextu ceske legislativy.

**Vlastnik:** Martin Dlouhy, CEO ProfiLend (https://profilend.cz/cs/)
**Obor:** Sprava kapitalu pro klientelu s vysokym majetkem (HNWI)

---

## 2. Technicka architektura

### Stack

| Vrstva | Technologie |
|---|---|
| Frontend | Cisty HTML5, CSS3, vanilla JavaScript (zadny framework) |
| Backend (Vercel) | Serverless Functions — Node.js (Cheerio, Anthropic SDK) |
| Backend (Railway) | Express.js server — OpenAI SDK, Anthropic SDK, Google AI SDK |
| Hosting | Vercel (frontend + serverless), Railway (API server) |
| Font | DM Sans (Google Fonts) |
| Design system | DayNight — minimalisticky flat design, light/dark mode |
| Repozitar | https://github.com/martin1dlouhy/Main-Project |
| Produkce | https://main-five-alpha.vercel.app |

### Struktura souboru

```
Investment Tools - main project/
|
|-- index.html                        # Landing page
|-- apps.html                         # Katalog vsech aplikaci (3 kategorie)
|-- styles.css                        # Globalni styly (921 radku, CSS promenne)
|-- script.js                         # Theme switching (light/dark)
|
|-- APLIKACE — Osobni
|   |-- debt-calculator.html          # Dluhova kalkulacka (2 946 r.) [LIVE]
|   |-- real-estate-prompt-generator.html  # AI valuace nemovitosti (5 339 r.) [LIVE]
|   |-- sp500-calculator.html         # S&P 500 rozklad portfolia (728 r.) [LIVE]
|
|-- APLIKACE — Pracovni
|   |-- portfolio-dashboard.html      # Portfolio dashboard (862 r.) [WIP]
|   |-- portfolio-preview.html        # Portfolio dashboard v3 (851 r.) [PROTOTYPE]
|
|-- APLIKACE — ProfiLend
|   |-- termsheet-generator.html      # Term Sheet generator (3 087 r.) [LIVE]
|   |-- loan-documentation.html       # Uverova dokumentace (3 809 r.) [LIVE]
|   |-- marketing-agent.html          # Marketing agent (3 200 r.) [DEV]
|
|-- API (Vercel Serverless)
|   |-- api/sp500.js                  # Scraper S&P 500 dat (Cheerio)
|   |-- api/parse-lv.js              # Parser katastru (Claude AI)
|   |-- api/ares.js                  # ARES lookup
|
|-- API (Railway Server)
|   |-- railway-api/server.js         # Express API — PIN, LV, loan-doc, marketing
|   |-- railway-api/package.json
|
|-- Konfigurace
|   |-- vercel.json                   # Vercel config (function timeouts)
|   |-- package.json                  # Frontend dependencies
|   |-- google-drive-sync.js          # OneDrive/File System API integrace
|   |-- APP-TEMPLATE.html             # Sablona pro nove aplikace
|
|-- Dokumentace
    |-- README.md
    |-- PROJECT-SUMMARY.md
    |-- DESIGN-SYSTEM.md
    |-- INVESTMENT-TOOLS-OVERVIEW.md   # << TENTO SOUBOR
```

---

## 3. Prehled aplikaci

### 3.1 OSOBNI — Investicni nastroje a kalkulacky

#### Debt Financing Calculator [LIVE]
- **Soubor:** debt-calculator.html (2 946 radku)
- **Ucel:** Profesionalni kalkulacka dluhoveho financovani s nemovitostni zastavou
- **Klicove funkce:**
  - Zadani parametru uveru (castka, urok, splatnost, ucel)
  - IRR (vnitrni vynosove procento) vypocet
  - Kompletni splatkovy kalendar (mesicni rozklad)
  - Poplatky (upfront / roll-in), vicekorokova struktura
  - Vybery meny: CZK / EUR / USD s konverzi
  - Export do PDF (jspdf) a Excel (xlsx)
  - Defaultni urok a penale vypocty
- **Technologie:** jspdf, xlsx, FileSaver.js

#### Real Estate Prompt Generator [LIVE]
- **Soubor:** real-estate-prompt-generator.html (5 339 radku) — NEJVETSI APLIKACE
- **Ucel:** AI generovani profesialnich promptu pro valuaci nemovitosti podle ceskych bankovnich standardu
- **6-krokovy wizard:**
  1. Ucel uveru (refinancovani / akvizice / obecna valuace)
  2. Typ nemovitosti (6 kategorii: pozemek, byt, rodinny dum, komercni, bytovy dum, prumyslovy)
  3. Detaily nemovitosti a materialy (vcetne embeddovanych cenovych map CUZK)
  4. Vlastnicka data, technicke detaily, trzni srovnani
  5. AI generovani promptu (Claude, ceske bankovni standardy)
  6. Porovnani AI vystupu side-by-side
- **Pokrocile funkce:**
  - 3-urovnove ukladani (localStorage + IndexedDB + OneDrive File System API)
  - Sprava valuaci (duplikace, porovnani, poznamky, PDF export)
  - Grafy a filtrace, CS/EN prepinani
- **Bankovni metodiky:** Porovnavaci, vynosova, nakladova, residualni, DCF
- **Technologie:** Claude API, IndexedDB, File System Access API

#### S&P 500 Portfolio Breakdown [LIVE]
- **Soubor:** sp500-calculator.html (728 radku)
- **Ucel:** Rozklad investice do S&P 500 na jednotlive tituly podle trzni kapitalizace
- **Klicove funkce:**
  - Zadani investicni castky v CZK/EUR/USD
  - Live data — denni aktualizace z api/sp500.js (scraping SlickCharts)
  - Summary karty (celkova alokace, pocet firem, prumer)
  - Sektorova analyza s horizontalnimi grafy
  - Tabulka firem (ticker, nazev, vaha %, alokace) se sortovanim a filtrem
  - Indikator cerstovsti dat
- **Backend:** api/sp500.js (Vercel serverless, Cheerio, cache 24h)

---

### 3.2 PRACOVNI — Sprava portfolia a business

#### Portfolio Dashboard [WIP]
- **Soubory:** portfolio-dashboard.html (862 r.) + portfolio-preview.html (851 r.)
- **Ucel:** Vizualni dashboard celeho investicniho portfolia
- **Klicove funkce:**
  - Taby: Holdings, Performance, Risk, Allocation, Geography
  - KPI karty (hodnota portfolia, YTD vynosy, volatilita, geografie)
  - Chart.js vizualizace (pie, bar, line)
  - Holdings tabulka se stromovou strukturou (firmy > projekty)
  - Risk matice (severity x likelihood)
  - Meny CZK/EUR/USD
- **Status:** Work in Progress — portfolio-preview.html je v3 iterace
- **Technologie:** Chart.js 4.4.1

---

### 3.3 PROFILEND — Interni nastroje

#### Term Sheet Generator [LIVE]
- **Soubor:** termsheet-generator.html (3 087 radku)
- **Ucel:** Tvorba, sprava a generovani Term Sheetu pro klienty ProfiLend
- **Klicove funkce:**
  - PIN ochrana (4-mistny PIN, SHA-256 hash, rate limiting 5 pokusu/5 min)
  - Formular: parametry uveru, zastavy (LV reference), poplatky, ucty, podpisy
  - Seznam ulozenych Term Sheetu s vyhledavanim
  - Transe system (vice cerpani)
  - Export do Word a PDF
  - Auto LTV kalkulace
- **Backend:** Railway server /api/verify-pin
- **Technologie:** pizzip, jszip, FileSaver.js, xlsx

#### Uverova dokumentace [LIVE]
- **Soubor:** loan-documentation.html (3 809 radku)
- **Ucel:** Automaticke generovani uverove dokumentace z Word sablon pomoci Claude AI
- **Klicove funkce:**
  - Spravce dokumentu (hledani, filtrace, seznam)
  - Upload DOCX sablon
  - Dynamicky formular generovany z metadat sablony
  - Mapovani dat ze zastavnich prav (LV analyza)
  - Claude AI identifikuje placeholdery a provadi nahrazeni
  - Real-time validace transi vs. castka uveru
  - Export vyplneneho DOCX
- **Backend:** Railway server /api/generate-loan-doc
- **Technologie:** Claude API, DOCX processing

#### Marketing Agent [DEV]
- **Soubor:** marketing-agent.html (3 200 radku)
- **Ucel:** AI marketingovy nastroj pro ProfiLend — multi-channel tvorba obsahu
- **Klicove funkce:**
  - Kanaly: Instagram, LinkedIn, Facebook, YouTube
  - Typy obsahu: prispevky, emaily, blogy, video scripty, carousely
  - Cilova skupina: vlastnici, brokeri, developeri, investori
  - Obsahove pilire: produkt, case study, edukace, brand
  - Ton a styl: fakticky, presvecdcivy, emocionalni
  - Nastaveni emoji a hashtagu
  - Batch generovani 1-5 prispevku najednou
  - Volitelna generace obrazku (DALL-E / gpt-image-1)
  - Vystup: text prispevku + visual hook + image prompt
- **ProfiLend knowledge base v promptu:**
  - Uvery 10-250M CZK, LTV max 70%, sazba 9%+, splatnost 1-20 let
  - Pouze ceske pravnicke osoby na ceskych nemovitostech
  - Portfolio 1.3B+ CZK, rozhodnuti do 48h
  - Zakazana slova: "nejlevnejsi", "garantujeme", "bez rizika"
  - Schvalene CTA: "Zjistit vice", "Napiste nam", "Nezavazna konzultace"
- **Backend:** Railway server /api/marketing/generate, /api/marketing/generate-image
- **Technologie:** OpenAI GPT-4o/GPT-4o-mini (text), DALL-E/gpt-image-1 (obrazky)

---

## 4. Backend API — endpointy

### Vercel Serverless Functions

| Endpoint | Soubor | Ucel | Timeout |
|---|---|---|---|
| GET /api/sp500 | api/sp500.js | Scraping S&P 500 dat (Cheerio) | 15s |
| POST /api/parse-lv | api/parse-lv.js | Analyza listu vlastnictvi (Claude AI) | 60s |
| GET /api/ares | api/ares.js | ARES lookup firemnich dat | 15s |

### Railway Express Server (railway-api/server.js)

| Endpoint | Metoda | Ucel |
|---|---|---|
| /api/verify-pin | POST | PIN overeni pro Term Sheet (SHA-256, rate limiting) |
| /api/parse-lv | POST | Railway verze LV parseru (bez timeout limitu) |
| /api/generate-loan-doc | POST | Vyplneni DOCX sablon pomoci Claude AI |
| /api/marketing/generate | POST | Generovani marketingoveho obsahu (OpenAI) |
| /api/marketing/generate-image | POST | Generovani obrazku (DALL-E / gpt-image-1) |
| /api/marketing/models | GET | Debug — seznam modelu |
| / a /health | GET | Health check |

### Environment variables (Railway)

| Promenna | Ucel |
|---|---|
| ANTHROPIC_API_KEY | Claude API klic |
| OPENAI_API_KEY | OpenAI klic (marketing + obrazky) |
| GEMINI_API_KEY | Google Gemini (fallback) |
| PIN_HASH | SHA-256 hash 4-mistneho PINu |
| PORT | Port serveru (default 3001) |

---

## 5. Design system — DayNight

### Barevne schema

**Light mode (Snow):**
- Pozadi: #FFFFFF / #F8FAFC / #F1F5F9
- Text: #1E293B (primarni) / #64748B (sekundarni)
- Accent: #38BDF8
- Border: #E2E8F0

**Dark mode (Carbon — Navy Edition):**
- Pozadi: #0B1120 / #111827 / #1E293B
- Text: #F1F5F9 / #94A3B8
- Accent: #38BDF8 (stejny)
- Border: #334155

### Typografie
- Font: DM Sans (Google Fonts) + system fallbacks
- Spacing: xs(4px), sm(8px), md(16px), lg(24px), xl(32px)
- Border-radius: 8px (inputy), 12px (karty), 16px (kontejnery)

### Theme switching
- Trida `.carbon` na `<html>` a `<body>`
- Ulozeni v localStorage: klic `daynight-theme`
- Hodnoty: `snow` (light) / `carbon` (dark)

### Konvence
- Vsechny barvy pres CSS promenne (var(--accent) atd.)
- Zadne hardcoded hex hodnoty v komponentach
- Responsivni design (mobile-first)
- Vlastni SVG ikony s gradienty

---

## 6. Stav vyvoje — souhrn

### Live a aktivni (6 aplikaci)
- Debt Financing Calculator
- Real Estate Prompt Generator
- S&P 500 Portfolio Breakdown
- Term Sheet Generator (PIN chraneny)
- Loan Documentation Generator
- Marketing Agent

### V rozpracovani (2)
- Portfolio Dashboard (v2 + v3 prototypy)

### Planovane (Q2-Q3 2026)
- IRR Calculator (analyza investicnich projektu)
- Real Estate Analyzer (ROI, cash flow projekce, cap rate)

---

## 7. Deployment

### Frontend (Vercel)
1. Commit na GitHub (branch `main`)
2. Vercel detekuje zmenu (webhook)
3. Build statickych HTML/CSS/JS (~30s)
4. Deploy na CDN: https://main-five-alpha.vercel.app

### Git prikazy (jeden blok):
```
cd "C:\Users\instal\.claude\claude-workspace\projects\Investment Tools - main project" && git add . && git commit -m "Commit message" && git push origin main
```

### Backend (Railway)
- Express.js na Node 18+
- Bez timeout limitu (vs. Vercel 60s)
- Pouzivano pro: Term Sheet, Loan Docs, Marketing

---

## 8. Frontend knihovny

| Knihovna | Ucel | Pouziti |
|---|---|---|
| jspdf | PDF export | debt-calculator |
| xlsx / xlsx-js-style | Excel export | debt-calculator, termsheet |
| FileSaver.js | Stahovani souboru | vice aplikaci |
| Chart.js 4.4.1 | Vizualizace portfolia | portfolio-dashboard |
| pizzip / jszip | DOCX zpracovani | termsheet, loan-doc |
| pdf.js | PDF cteni | termsheet |
| Cheerio | HTML parsing | sp500 (backend) |

---

## 9. Statistiky

| Metrika | Hodnota |
|---|---|
| Celkem HTML aplikaci | 10 (+ 1 sablona) |
| Celkem radku kodu | ~23 700 |
| Nejvetsi aplikace | real-estate-prompt-generator.html (5 339 r.) |
| API endpointu | 7+ |
| Podporovane meny | 3 (CZK, EUR, USD) |
| Typy nemovitosti (R-E) | 6 |
| Jazyky UI | 2 (CS, EN) |

---

## 10. Aktualni focus — Marketing Agent

Marketing Agent je nyni v aktivnim vyvoji (status: Dev). Aplikace je funkcni, ale budeme na ni dale pracovat. Detailni popis aktualniho stavu viz sekce 3.3.

---

*Tento dokument je zivym referencnim pruvodcem projektu. Aktualizuje se pri kazde vyznamne zmene.*
