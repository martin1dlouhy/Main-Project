# Debt Financing — Plán nového webu

> **Verze:** 1.0
> **Datum:** 2. dubna 2026
> **Autor:** Martin Dlouhý + Claude
> **Status:** Plánovací fáze

---

## 1. CÍL PROJEKTU

Vytvořit **nový samostatný web** s názvem **Debt Financing**, který bude obsahovat tři aplikace z původního projektu Investment Tools. Web bude mít novou grafiku (jiný template), vlastní doménu na Vercelu a zachová 100% funkčnost stávajících aplikací.

### Co zůstává beze změny
- Veškerá logika aplikací (JavaScript)
- Napojení na Claude API (Anthropic SDK)
- Railway API server (PIN ověření, LV parsing, generování dokumentů)
- OneDrive integrace (File System Access API)
- ARES napojení (české IČO vyhledávání)
- IndexedDB ukládání dat
- Vercel serverless funkce (api/parse-lv.js, api/ares.js)

### Co se mění
- Nová grafika / šablona webu (landing page, navigace, layout)
- Nový Vercel projekt = nová URL (nová doména)
- Nový GitHub repozitář
- Úprava CORS whitelistu na Railway serveru (přidání nové domény)

---

## 2. APLIKACE NA NOVÉM WEBU

### 2.1 Real Estate Valuator (R-E Prompt Generator)
- **Zdrojový soubor:** `real-estate-prompt-generator.html` (5 213 řádků)
- **Funkce:** 6-krokový wizard pro generování AI promptů pro oceňování nemovitostí
- **API závislosti:** Railway API (Claude AI generování), OneDrive (ukládání)
- **Lokální úložiště:** localStorage + IndexedDB (3-vrstvý backup)

### 2.2 Term Sheet Creator
- **Zdrojový soubor:** `termsheet-generator.html` (2 950 řádků)
- **Funkce:** Generátor term sheetů v DOCX formátu
- **API závislosti:** Railway API (PIN ověření, LV parsing), Vercel API (ARES lookup)
- **Bezpečnost:** PIN ochrana (SHA-256, server-side)
- **Knihovny:** PizZip (DOCX generování), docxtemplater

### 2.3 Loan Documentation (Úvěrová dokumentace)
- **Zdrojový soubor:** `loan-documentation.html` (2 289 řádků)
- **Funkce:** Vytváření a správa úvěrové dokumentace
- **API závislosti:** Railway API (LV parsing, generování dokumentů)
- **Lokální úložiště:** IndexedDB

---

## 3. DOPORUČENÉ ZDROJE ŠABLON (ZDARMA)

### 3.1 HTML šablony — TOP doporučení

| Zdroj | URL | Proč |
|-------|-----|------|
| **HTML5 UP** | https://html5up.net | Profesionální, responzivní, CC licence, čisté HTML/CSS/JS |
| **Tailwind UI (free)** | https://tailwindui.com/components#product-application-ui | Moderní komponenty, lze použít bez Tailwind frameworku jako inspirace |
| **Starter Templates** | https://startbootstrap.com/themes | Bootstrap-based, SaaS/dashboard styly |
| **Colorlib** | https://colorlib.com/wp/templates/ | Velký výběr, filtr podle typu |
| **Cruip** | https://cruip.com/free-templates/ | Moderní SaaS landing pages, Tailwind |
| **One Page Love** | https://onepagelove.com/templates/free-templates | Curated one-page šablony |

### 3.2 Na co se zaměřit při výběru šablony

Šablona by měla splňovat:

1. **SaaS / App landing page styl** — hero sekce, features grid, CTA tlačítka
2. **Dark mode podpora** nebo snadná přizpůsobitelnost (CSS proměnné)
3. **Čistý, moderní design** — profesionální vzhled pro finanční sektor
4. **Responzivní** — funguje na mobilu i desktopu
5. **Vanilla HTML/CSS/JS** — žádný React/Vue/Angular (konzistence s Investment Tools)
6. **Volná licence** — MIT, CC BY, nebo podobná

### 3.3 Doporučený postup výběru

1. Projdi HTML5 UP a Cruip — najdi 2–3 kandidáty
2. Pošli mi screenshoty nebo odkazy — společně vybereme
3. Stáhnu šablonu a upravím pro Debt Financing

---

## 4. TECHNICKÁ ARCHITEKTURA

### 4.1 Nový repozitář

```
Debt-Financing/
├── index.html                    # Nová landing page (z šablony)
├── apps.html                     # Katalog 3 aplikací (nový design)
├── styles.css                    # Globální styly (NOVÉ z šablony + DayNight)
├── script.js                     # Theme switching (stejná logika)
├── package.json                  # Závislosti (anthropic SDK, cheerio)
├── vercel.json                   # Vercel konfigurace
│
├── real-estate-valuator.html     # App 1 — R-E Prompt Generator
├── termsheet-creator.html        # App 2 — Term Sheet Creator
├── loan-documentation.html       # App 3 — Úvěrová dokumentace
│
├── api/                          # Vercel serverless funkce
│   ├── ares.js                   # ARES lookup (kopie)
│   └── parse-lv.js               # LV parser (kopie)
│
├── assets/                       # Nové grafické assety
│   ├── images/
│   └── icons/
│
└── docs/                         # Dokumentace
    └── PROJECT-SUMMARY.md
```

### 4.2 Dva Vercel projekty

| Parametr | Investment Tools (stávající) | Debt Financing (nový) |
|----------|------------------------------|----------------------|
| GitHub repo | martin1dlouhy/Main-Project | martin1dlouhy/Debt-Financing |
| Vercel URL | main-five-alpha.vercel.app | debt-financing-xxx.vercel.app |
| Vlastní doména | (volitelně) | (volitelně) |
| Aplikace | Všechny stávající | R-E Valuator, Term Sheet, Loan Doc |
| API funkce | sp500.js, ares.js, parse-lv.js | ares.js, parse-lv.js |

### 4.3 Railway API — sdílený server

Railway server zůstává **JEDEN** pro oba weby. Je potřeba pouze:

1. **Přidat novou doménu do CORS whitelistu** v `railway-api/server.js`:
```javascript
const allowedOrigins = [
    'https://main-five-alpha.vercel.app',     // Investment Tools
    'https://debt-financing-xxx.vercel.app',   // Debt Financing (nová URL)
    'http://localhost:3000',
    'http://localhost:8080'
];
```

2. **Žádné další změny** na Railway serveru nejsou potřeba — endpointy jsou univerzální.

### 4.4 Vercel serverless funkce

Funkce `api/ares.js` a `api/parse-lv.js` budou zkopírovány do nového repozitáře. Je potřeba:

1. **Nastavit ANTHROPIC_API_KEY** jako environment variable ve Vercel dashboardu nového projektu
2. **Aktualizovat CORS** v api souborech — přidat novou doménu
3. **vercel.json** — zkopírovat konfiguraci timeoutů

---

## 5. POSTUP REALIZACE — KROK PO KROKU

### FÁZE 1: Příprava (den 1)

**Krok 1.1 — Výběr šablony**
- [ ] Projít doporučené zdroje šablon (HTML5 UP, Cruip, Colorlib)
- [ ] Vybrat 2–3 kandidáty
- [ ] Martin schválí finální šablonu

**Krok 1.2 — Vytvoření repozitáře**
- [ ] Vytvořit nový GitHub repo: `martin1dlouhy/Debt-Financing`
- [ ] Naklonovat šablonu do repo
- [ ] Základní struktura složek

### FÁZE 2: Landing page a navigace (den 2–3)

**Krok 2.1 — Přizpůsobení šablony**
- [ ] Upravit šablonu pro Debt Financing branding
- [ ] Implementovat DayNight theme system (CSS proměnné)
- [ ] Vytvořit navigační panel (nový design, ale stejná logika)
- [ ] Vytvořit apps.html s kartami 3 aplikací
- [ ] Footer s ProfiLend odkazem

**Krok 2.2 — Vercel deployment**
- [ ] Napojit repo na Vercel
- [ ] Nastavit environment variables (ANTHROPIC_API_KEY)
- [ ] Ověřit, že landing page funguje na nové URL

### FÁZE 3: Migrace aplikací (den 4–7)

**Krok 3.1 — Real Estate Valuator**
- [ ] Zkopírovat `real-estate-prompt-generator.html`
- [ ] Adaptovat navigaci a styly na nový design
- [ ] Aktualizovat API URL (pokud se mění)
- [ ] Otestovat kompletní 6-krokový wizard
- [ ] Otestovat AI generování (Railway API)
- [ ] Otestovat OneDrive integraci
- [ ] Otestovat IndexedDB ukládání/načítání
- [ ] Testovat light + dark mode

**Krok 3.2 — Term Sheet Creator**
- [ ] Zkopírovat `termsheet-generator.html`
- [ ] Adaptovat navigaci a styly
- [ ] Otestovat PIN ověření (Railway API)
- [ ] Otestovat ARES lookup (Vercel API)
- [ ] Otestovat LV parsing
- [ ] Otestovat DOCX generování (PizZip)
- [ ] Testovat light + dark mode

**Krok 3.3 — Loan Documentation**
- [ ] Zkopírovat `loan-documentation.html`
- [ ] Adaptovat navigaci a styly
- [ ] Otestovat všechny funkce
- [ ] Testovat light + dark mode

### FÁZE 4: Backend integrace (den 5–6)

**Krok 4.1 — Vercel API funkce**
- [ ] Zkopírovat `api/ares.js` do nového repo
- [ ] Zkopírovat `api/parse-lv.js` do nového repo
- [ ] Aktualizovat CORS whitelist v obou souborech
- [ ] Nastavit vercel.json s timeouty

**Krok 4.2 — Railway CORS update**
- [ ] Přidat novou Vercel doménu do CORS allowedOrigins
- [ ] Otestovat, že oba weby (starý i nový) fungují s Railway API
- [ ] Redeploy Railway serveru

### FÁZE 5: Testování a finalizace (den 7–8)

**Krok 5.1 — Kompletní testování**
- [ ] Proklikat všechny 3 aplikace end-to-end
- [ ] Testovat na mobilu (responsivita)
- [ ] Testovat light + dark mode na všech stránkách
- [ ] Ověřit, že Investment Tools (starý web) stále funguje bez problémů
- [ ] Cross-browser test (Chrome, Firefox, Edge)

**Krok 5.2 — Dokumentace**
- [ ] PROJECT-SUMMARY.md pro nový projekt
- [ ] Aktualizovat CLAUDE.md / globální instrukce
- [ ] Git příkazy pro Martina

### FÁZE 6: Budoucí rozvoj (průběžně)

- [ ] Přidávání dalších aplikací
- [ ] Vylepšení stávajících aplikací
- [ ] Případná vlastní doména (debt-financing.cz apod.)

---

## 6. CO SI CLAUDE MUSÍ ZAPAMATOVAT

### Klíčové informace pro nový projekt

```
PROJEKT: Debt Financing
TYP: Samostatný web (nový Vercel projekt)
REPO: martin1dlouhy/Debt-Financing (bude vytvořen)
TECH STACK: Vanilla HTML/CSS/JS (žádné frameworky)
DESIGN: Nová šablona (bude vybrána) + DayNight theme system
DEPLOY: Vercel (auto-deploy z main branch)

APLIKACE:
1. Real Estate Valuator (z real-estate-prompt-generator.html)
2. Term Sheet Creator (z termsheet-generator.html)
3. Loan Documentation (z loan-documentation.html)

API ZÁVISLOSTI:
- Railway server: https://main-project-production-b048.up.railway.app
  - POST /api/verify-pin (Term Sheet PIN)
  - POST /api/parse-lv (LV parsing — Claude AI)
- Vercel serverless: api/ares.js, api/parse-lv.js
- Claude API: @anthropic-ai/sdk (klíč v env vars)

SDÍLENÉ KOMPONENTY (zachovat z Investment Tools):
- DayNight CSS proměnné (light/dark mode)
- Theme switching logika (localStorage: daynight-theme)
- Flash-prevention script v <head>
- Font: DM Sans (Google Fonts)
- Toast notifikace systém
- PIN ochrana pattern (4 oddělené inputy)
- Custom select šipky (SVG, cyan)
- Custom checkboxy
- formatAmount() pro české formátování čísel
- IndexedDB pattern (verze 2+)
- PizZip pro DOCX (synchronní!)
- File System Access API (OneDrive připojení)

PRAVIDLA:
- Nikdy nemazat soubory bez souhlasu Martina
- Nikdy neupravovat OneDrive soubory
- Nikdy nepsat testovací data do localStorage
- 100% zpětná kompatibilita
- Kritik revize po každé změně
- Git příkazy vždy připravit pro Martina (nepushovat automaticky)

CORS — PO DEPLOYI AKTUALIZOVAT:
- railway-api/server.js → přidat novou Vercel doménu
- api/ares.js → přidat novou doménu
- api/parse-lv.js → přidat novou doménu
```

### Složky a soubory k použití

```
ZDROJOVÉ SOUBORY (kopírovat z Investment Tools):
├── real-estate-prompt-generator.html  → real-estate-valuator.html
├── termsheet-generator.html           → termsheet-creator.html
├── loan-documentation.html            → loan-documentation.html
├── api/ares.js                        → api/ares.js
├── api/parse-lv.js                    → api/parse-lv.js
├── script.js                          → script.js (theme logika)
├── default-ai-prompt.md               → docs/default-ai-prompt.md
└── styles.css                         → NOVÝ (z šablony + DayNight vars)

NOVÉ SOUBORY (vytvořit):
├── index.html                         (nová landing page ze šablony)
├── apps.html                          (nový katalog 3 aplikací)
├── styles.css                         (nový design + DayNight vars)
├── vercel.json                        (kopie + úprava)
└── package.json                       (kopie + úprava)
```

---

## 7. RIZIKA A ŘEŠENÍ

| Riziko | Řešení |
|--------|--------|
| Railway CORS blokuje nový web | Přidat doménu do allowedOrigins PŘED migrací |
| Vercel API nefunguje | Nastavit ANTHROPIC_API_KEY v env vars nového projektu |
| Ztráta dat v IndexedDB | IndexedDB je per-domain — na novém webu začínáme s prázdnou DB (to je OK, uživatel si data znovu uloží) |
| Starý web přestane fungovat | NIC se na starém webu nemění — běží nezávisle |
| Šablona neodpovídá požadavkům | Vybrat 2–3 kandidáty a konzultovat s Martinem |

---

## 8. ČASOVÝ ODHAD

| Fáze | Odhadovaný čas |
|------|----------------|
| Výběr šablony | 1 den |
| Landing page + navigace | 2 dny |
| Migrace 3 aplikací | 3–4 dny |
| Backend integrace | 1 den |
| Testování + opravy | 1–2 dny |
| **Celkem** | **8–10 dní** |

---

*Tento dokument slouží jako zadání pro nový Claude projekt. Při zahájení práce na Debt Financing načti tento soubor jako první.*
