# Investment Tools — Kompletní projektový kontext

> **Účel tohoto souboru:** Poskytnout AI asistentovi (nebo novému spolupracovníkovi) veškerý potřebný background pro pokračování v práci na projektu. Obsahuje cíle, architekturu, stav, konvence a plány.
>
> **Poslední aktualizace:** 24. března 2026

---

## 1. O čem projekt je

**Investment Tools** je webová platforma profesionálních investičních nástrojů — kalkulaček, generátorů a analytických dashboardů. Slouží investičním profesionálům ke správě financí, analýze dluhového financování a oceňování nemovitostí v kontextu české legislativy.

Projekt je součástí ekosystému **ProfiLend** (https://profilend.cz/cs/) — platformy pro investiční služby a správu kapitálu pro klientelu s vysokým majetkem (HNWI).

---

## 2. Vlastník

- **Martin Dlouhý** — CEO ProfiLend, investiční profesionál (správa peněz pro miliardáře)
- Martin není programátor; Claude funguje jako jeho technický partner
- Komunikace probíhá vždy v češtině
- Kontakt: martin1dlouhy@gmail.com

---

## 3. Cíle projektu

1. Poskytnout sadu profesionálních finančních nástrojů dostupných z webu
2. Podpořit investiční rozhodování — IRR výpočty, dluhové financování, portfoliový rozklad
3. Automatizovat generování AI promptů pro valuaci nemovitostí podle bankovních standardů (česká legislativa)
4. Budovat profesionální brand Investment Tools jako součást ekosystému ProfiLend
5. Postupně rozšiřovat o nové nástroje (IRR Calculator, Real Estate Analyzer)

---

## 4. Technický stack

| Vrstva | Technologie |
|---|---|
| Frontend | Čistý HTML5, CSS3, vanilla JavaScript (žádný framework) |
| Backend API | Vercel Serverless Functions (Node.js) |
| Hosting | Vercel — auto-deploy z GitHubu |
| Závislosti | cheerio (server-side scraping S&P 500 dat) |
| Font | DM Sans (Google Fonts) |
| Design systém | DayNight — minimalistický flat design, light/dark mode |
| Repozitář | https://github.com/martin1dlouhy/Main-Project |
| Produkce | https://main-five-alpha.vercel.app |

Důležité: Projekt záměrně nepoužívá žádný JS framework (React, Vue apod.). Vše je vanilla HTML/CSS/JS — jednoduchost a přímá kontrola jsou prioritou.

---

## 5. Struktura projektu a soubory

```
Investment Tools - main project/
│
├── index.html                          # Homepage — hero, přehled aplikací, features
├── apps.html                           # Stránka se seznamem všech aplikací
├── styles.css                          # Globální styly (921 řádků) — light/dark mode, komponenty
├── script.js                           # Theme switching Snow/Carbon (46 řádků)
│
├── debt-calculator.html                # Debt Financing Calculator (2872 řádků) — hlavní aplikace
├── real-estate-prompt-generator.html   # R-E Prompt Generator (5198 řádků) — největší aplikace
├── sp500-calculator.html               # S&P 500 Portfolio Breakdown (728 řádků)
├── portfolio-dashboard.html            # Portfolio Dashboard (837 řádků) — Chart.js vizualizace
├── portfolio-preview.html              # Portfolio Dashboard v3 Preview (826 řádků)
│
├── api/
│   └── sp500.js                        # Vercel serverless — scraping S&P 500 dat z slickcharts.com
│
├── APP-TEMPLATE.html                   # Šablona pro tvorbu nových aplikací
├── default-ai-prompt.md                # Master prompt pro AI valuaci nemovitostí
├── DESIGN-SYSTEM.md                    # Dokumentace design systému DayNight
├── PROJEKT - Popis.md                  # Starší kompletní popis projektu
├── RE-Prompt-Generator-Vylepšení.md    # Návrhy vylepšení pro R-E Prompt Generator
├── README.md                           # Deployment guide
├── README-DEPLOY.md                    # Podrobný deployment návod
├── package.json                        # NPM závislosti (cheerio)
└── vercel.json                         # Vercel konfigurace
```

Celkový rozsah kódu: cca **12 600 řádků** (HTML/CSS/JS).

---

## 6. Aplikace — aktuální stav

### 6.1 Debt Financing Calculator (LIVE)
- **Soubor:** `debt-calculator.html` (2872 řádků, self-contained)
- **Co dělá:** Pokročilá kalkulačka pro dluhové financování se zástavou nemovitostí
- **Funkce:** IRR kalkulace, kompletní splátkový kalendář, export PDF/Excel, podpora CZK/EUR/USD, měnový přepínač
- **Stav:** Plně funkční, v produkci

### 6.2 R-E Prompt Generator (LIVE)
- **Soubor:** `real-estate-prompt-generator.html` (5198 řádků, největší aplikace)
- **Co dělá:** Generuje profesionální AI prompty pro valuaci nemovitostí podle bankovních standardů
- **Funkce:**
  - 6-krokový wizard (účel úvěru → typ nemovitosti → materiály → údaje → vygenerovaný prompt → AI porovnání)
  - 6 typů nemovitostí: pozemek, byt, rodinný dům, komerční objekt, bytový dům, průmyslový objekt
  - Bankovní metodika oceňování (porovnávací, výnosová, nákladová, reziduální, DCF)
  - Red flags screening (právní vady, technické problémy, tržní rizika)
  - Ukládání a správa valuací (localStorage + IndexedDB + OneDrive File System API)
  - Duplikování, porovnávání, poznámky, PDF tisk, grafy, filtrování
- **Legislativní základ:** Zákon č. 151/1997 Sb., Zákon č. 190/2004 Sb., IVS/EVS standardy
- **Stav:** Plně funkční, aktivně vyvíjený, nejkomplexnější aplikace projektu
- **Plánovaná vylepšení:** Viz `RE-Prompt-Generator-Vylepšení.md` — live preview, API integrace pro přímé odeslání do AI, export do .md/.pdf, konfigurovatelné bezpečnostní koeficienty, nové typy nemovitostí

### 6.3 S&P 500 Portfolio Breakdown (LIVE)
- **Soubor:** `sp500-calculator.html` (728 řádků)
- **Backend:** `api/sp500.js` (Vercel serverless)
- **Co dělá:** Rozklad investice do S&P 500 na jednotlivé tituly (všech 503)
- **Funkce:** Automatická denní aktualizace dat (scraping, cache 24h), sektorová analýza, podpora CZK/EUR/USD
- **Stav:** Plně funkční

### 6.4 Portfolio Dashboard (WIP/Preview)
- **Soubory:** `portfolio-dashboard.html`, `portfolio-preview.html`
- **Co dělá:** Vizuální dashboard pro portfoliové investice s Chart.js grafy
- **Stav:** Ve vývoji / preview verze

### 6.5 IRR Calculator (PLÁNOVÁNO — Q2 2026)
- **Co bude dělat:** Výpočet IRR, XIRR, NPV pro investiční projekty, cash flow analýza, sensitivity analysis

### 6.6 Real Estate Analyzer (PLÁNOVÁNO — Q3 2026)
- **Co bude dělat:** Kompletní analýza výnosnosti nemovitostních investic — ROI, cash flow projekce, cap rate, scenario modeling

---

## 7. Design systém — DayNight

### Principy
- Minimalistický flat design se dvěma režimy: **Snow** (light) a **Carbon** (dark)
- Třída `.carbon` na `<html>` a `<body>` aktivuje dark mode
- Stav se ukládá do `localStorage` pod klíčem `daynight-theme`
- Všechny barvy řízeny CSS proměnnými — stačí je používat a dark mode funguje automaticky

### Klíčové barvy

**Light (Snow):** pozadí #FFFFFF / #F8FAFC, text #1E293B, accent #38BDF8

**Dark (Carbon):** pozadí #0B1120 / #111827, text #F1F5F9, accent #38BDF8 (stejný)

### Typografie
- Font: DM Sans, fallback: -apple-system, BlinkMacSystemFont, sans-serif
- Velikosti: title 2.5rem, section 1.75rem, body 0.9375rem, small 0.875rem

### Spacing: xs 4px, sm 8px, md 16px, lg 24px, xl 32px
### Border radius: tlačítka/inputy 8px, karty 12px, kontejnery 16px

### Pravidla pro nové aplikace
1. Zkopírovat `APP-TEMPLATE.html` jako základ
2. Používat výhradně CSS proměnné (`var(--accent)`, `var(--bg-primary)` atd.)
3. NEMĚNIT: navigaci, footer, theme switching, globální CSS
4. Testovat v obou módech + responzivitu na mobilu

---

## 8. AI Prompt Template (Master Prompt)

Soubor `default-ai-prompt.md` definuje profesionální prompt pro AI valuaci nemovitostí. Klíčové:

- **Role:** Seniorní bankovní supervizor (Collateral Risk Manager)
- **Výstupy:** Tržní hodnota, zástavní hodnota (pro LTV), identifikace red flags
- **Metodiky:** Reziduální, porovnávací, výnosová, nákladová, DCF — volba podle typu nemovitosti
- **Bezpečnostní koeficienty:** Byty 80 %, domy 70 %, pozemky 60 %, komerční 65–75 %
- **Strukturovaný výstup:** Strojově zpracovatelný blok `===SHRNUTÍ===` na konci odpovědi

---

## 9. Deployment a CI/CD

- **Platforma:** Vercel, auto-deploy při push na `main`
- **Build:** ~30 sekund
- **Git repozitář:** https://github.com/martin1dlouhy/Main-Project (branch: main)
- **API cache:** s-maxage=86400 (24h), stale-while-revalidate=3600 (1h)
- **Postup deploymentu:** Martin ručně pushuje přes Git CMD — Claude připraví příkazy, ale nikdy nepushuje automaticky

---

## 10. Pravidla pro práci na projektu

### Bezpečnost a kvalita
- Zachovat 100 % funkčnost; každá změna musí být zpětně kompatibilní
- Nepřidávat zbytečné závislosti a knihovny
- Dodržovat stávající design systém a konvence
- Neměnit části kódu nesouvisející s aktuálním úkolem
- NIKDY nezapisovat do localStorage/sessionStorage v prohlížeči testovací data

### OneDrive
- NIKDY neotvírat, neupravovat, nemazat soubory na OneDrive
- Nové soubory ukládat na lokální disk C (pokud nejsou součástí projektu)

### Soubory
- NIKDY nemazat soubory bez výslovného souhlasu Martina

### Revizní proces "Kritik"
- Po každé změně Claude automaticky provede nezávislou revizi vlastní práce
- Kontroluje: funkčnost, konzistenci (light/dark mode), vedlejší efekty, UX
- Funkčně testuje celý proces krok po kroku
- Žádná změna nesmí být předána bez dokončené revize

### Git konvence
- Commit message anglicky: `Fix: ...`, `Add: ...`, `Update: ...`
- Claude nikdy nepushuje automaticky — vždy jen připraví příkazy pro Martina

---

## 11. Nedávná historie vývoje (posledních 20 commitů)

Aktivní vývoj se soustředí především na **R-E Prompt Generator**:
- Přidání cenové mapy ČÚZK v kroku 3
- 3-vrstvý auto-backup systém (localStorage + IndexedDB + OneDrive FSA)
- Rozšíření na 6 typů nemovitostí (bytový dům, průmyslový objekt)
- 6-krokový wizard s účelem úvěru (refinancování/akvizice/obecný)
- Funkce C1-C6: duplikování, porovnávání, poznámky, PDF tisk, grafy, filtrování
- Vizuální přepracování — navigace, ikony, skládací panely
- Ukládání/načítání valuací, AI shrnutí, export/import pro OneDrive sync
- Krok 5: AI porovnání, strukturovaný výstupní blok

---

## 12. Plánovaný vývoj

### Krátkodobě (Q1-Q2 2026)
- Dokončení vylepšení R-E Prompt Generator (viz `RE-Prompt-Generator-Vylepšení.md`)
- Live preview promptu v reálném čase (kroky 2-3)
- API integrace pro přímé odeslání promptu do ChatGPT/Claude/Gemini
- Export promptu do .txt, .md, .pdf
- Konfigurovatelné bezpečnostní koeficienty

### Střednědobě (Q2-Q3 2026)
- IRR Calculator — výpočet IRR, XIRR, NPV, cash flow analýza
- Real Estate Analyzer — ROI, cash flow projekce, cap rate, scenario modeling
- Nové typy nemovitostí v R-E Generatoru (polyfunkční dům, rekreační objekt)

### Portfolio Dashboard
- Dokončení a nasazení vizuálního dashboardu (aktuálně preview)

---

## 13. Klíčové URL

| Co | URL |
|---|---|
| Produkce | https://main-five-alpha.vercel.app |
| GitHub repo | https://github.com/martin1dlouhy/Main-Project |
| ProfiLend | https://profilend.cz/cs/ |

---

*Tento soubor slouží jako vstupní bod pro pokračování práce na projektu. Pro detailní informace viz příslušné soubory: `DESIGN-SYSTEM.md`, `default-ai-prompt.md`, `RE-Prompt-Generator-Vylepšení.md`.*
