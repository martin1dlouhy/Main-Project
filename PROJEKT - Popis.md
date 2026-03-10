# Investment Tools — Kompletní popis projektu

## O projektu

**Investment Tools** je webová platforma profesionálních investičních nástrojů a kalkulaček, vytvořená Martinem Dlouhým (CEO projektu ProfiLend). Projekt slouží jako sada nástrojů pro správu financí, investiční analýzy a oceňování nemovitostí — zaměřený primárně na dluhové financování se zástavou nemovitostmi v prostředí české legislativy.

Projekt je součástí širšího ekosystému **ProfiLend** (https://profilend.cz/cs/), platformy zaměřené na investiční služby a správu kapitálu pro klientelu s vysokým majetkem.

---

## Vlastník a autor

- **Jméno:** Martin Dlouhý
- **Role:** CEO ProfiLend, investiční profesionál spravující prostředky pro miliardáře
- **Obor:** Investice, dluhové financování, nemovitostní zajištění
- **Email:** martin@dlouhy.com
- **Kontaktní email:** martin1dlouhy@gmail.com

---

## Technický stack

- **Frontend:** Čistý HTML5, CSS3, vanilla JavaScript (žádný framework)
- **Hosting:** Vercel (automatický deployment z GitHubu)
- **Repozitář:** https://github.com/martin1dlouhy/Main-Project
- **Produkční URL:** https://main-five-alpha.vercel.app
- **Backend API:** Vercel Serverless Functions (Node.js)
- **Závislosti:** cheerio (pro server-side scraping S&P 500 dat)
- **Font:** DM Sans (Google Fonts)
- **Design systém:** DayNight — minimalistický flat design s light/dark mode

---

## Struktura projektu

```
Main-Project/
├── index.html                         # Homepage — hero + přehled aplikací + features
├── apps.html                          # Stránka se seznamem všech aplikací (detailní)
├── styles.css                         # Globální styly (light/dark mode, komponenty)
├── script.js                          # Theme switching (Snow/Carbon)
├── debt-calculator.html               # Debt Financing Calculator (hlavní aplikace)
├── real-estate-prompt-generator.html  # R-E Prompt Generator pro AI valuaci
├── sp500-calculator.html              # S&P 500 Portfolio Breakdown
├── api/
│   └── sp500.js                       # Vercel serverless funkce — scraping S&P 500 dat
├── vercel.json                        # Vercel konfigurace
├── package.json                       # NPM závislosti (cheerio)
├── APP-TEMPLATE.html                  # Šablona pro tvorbu nových aplikací
├── DESIGN-SYSTEM.md                   # Dokumentace design systému
├── default-ai-prompt.md               # Master prompt pro AI valuaci nemovitostí
├── README.md                          # Deployment guide
├── README-DEPLOY.md                   # Podrobný deployment návod
└── PROJEKT.md                         # Tento soubor — kompletní popis projektu
```

---

## Aplikace

### 1. Debt Financing Calculator (LIVE)
- **Soubor:** `debt-calculator.html`
- **Účel:** Pokročilá kalkulačka pro dluhové financování s nemovitostní zástavou
- **Funkce:**
  - IRR kalkulace (vnitřní výnosové procento)
  - Kompletní splátkový kalendář
  - Export do PDF a Excel
  - Podpora více měn (CZK / EUR / USD)
  - Měnový přepínač
- **Tagy:** Finance, Real Estate, Calculator

### 2. R-E Prompt Generator (LIVE)
- **Soubor:** `real-estate-prompt-generator.html`
- **Účel:** Generování profesionálních AI promptů pro valuaci nemovitostí podle bankovních standardů
- **Funkce:**
  - 4 typy nemovitostí (pozemek, byt, rodinný dům, komerční objekt)
  - Bankovní metodika oceňování (porovnávací, výnosová, nákladová, reziduální, DCF)
  - Identifikace red flags (právní vady, technické problémy, tržní rizika)
  - Export promptu do AI nástrojů
- **Legislativní základ:** Zákon č. 151/1997 Sb., Zákon č. 190/2004 Sb., IVS/EVS standardy
- **Tagy:** AI, Valuace, Real Estate

### 3. S&P 500 Portfolio Breakdown (LIVE)
- **Soubor:** `sp500-calculator.html`
- **Backend:** `api/sp500.js` (Vercel serverless)
- **Účel:** Rozklad investice do S&P 500 na jednotlivé tituly
- **Funkce:**
  - Všech 503 titulů S&P 500
  - Automatická denní aktualizace dat (scraping ze slickcharts.com, cache 24h)
  - Sektorová analýza
  - Podpora více měn (CZK / EUR / USD)
- **Tagy:** Finance, Portfolio, S&P 500

### 4. IRR Calculator (PLÁNOVÁNO — Q2 2026)
- **Účel:** Výpočet vnitřního výnosového procenta a NPV pro investiční projekty
- **Plánované funkce:** IRR & XIRR, NPV kalkulace, cash flow analýza, sensitivity analysis
- **Tagy:** Finance, Analysis

### 5. Real Estate Analyzer (PLÁNOVÁNO — Q3 2026)
- **Účel:** Kompletní analýza výnosnosti nemovitostních investic
- **Plánované funkce:** ROI kalkulace, cash flow projekce, cap rate výpočet, scenario modeling
- **Tagy:** Real Estate, ROI, Analysis

---

## Design systém

### Princip
Minimalistický flat design nazvaný **DayNight** s dvěma režimy:

### Light Mode (Snow Edition)
| Proměnná | Hodnota | Použití |
|---|---|---|
| `--bg-primary` | #FFFFFF | Hlavní pozadí |
| `--bg-secondary` | #F8FAFC | Sekundární pozadí |
| `--bg-surface` | #F1F5F9 | Plochy, inputy |
| `--border-color` | #E2E8F0 | Bordery |
| `--text-primary` | #1E293B | Hlavní text |
| `--text-secondary` | #64748B | Sekundární text |
| `--accent` | #38BDF8 | Accent barva (světle modrá) |

### Dark Mode (Carbon — Navy Edition)
| Proměnná | Hodnota | Použití |
|---|---|---|
| `--bg-primary` | #0B1120 | Hlavní pozadí (navy-dark) |
| `--bg-secondary` | #111827 | Sekundární pozadí |
| `--bg-surface` | #1E293B | Plochy, inputy |
| `--text-primary` | #F1F5F9 | Hlavní text |
| `--text-secondary` | #94A3B8 | Sekundární text |
| `--accent` | #38BDF8 | Accent (stejná) |

### Typografie
- **Font:** DM Sans (Google Fonts)
- **Fallback:** -apple-system, BlinkMacSystemFont, sans-serif
- **Velikosti:** Page title 2.5rem, Section title 1.75rem, Body 0.9375rem, Small 0.875rem

### Spacing
- xs: 0.25rem (4px), sm: 0.5rem (8px), md: 1rem (16px), lg: 1.5rem (24px), xl: 2rem (32px)

### Border radius
- Tlačítka/inputy: 8px, Karty: 12px, Kontejnery: 16px

### Theme switching
- Třída `.carbon` na `<html>` a `<body>` aktivuje dark mode
- Stav se ukládá do `localStorage` pod klíčem `daynight-theme`
- Všechny barvy se řídí CSS proměnnými — stačí je používat a dark mode funguje automaticky

---

## AI Prompt Template (Master Prompt)

Soubor `default-ai-prompt.md` obsahuje profesionální master prompt pro AI valuaci nemovitostí pro bankovní zajištění. Klíčové aspekty:

- **Role:** Seniorní bankovní supervizor pro oceňování nemovitostí (Collateral Risk Manager)
- **Výstupy:** Tržní hodnota, zástavní hodnota (pro LTV), identifikace red flags
- **Metodiky podle typu nemovitosti:**
  - Pozemky: reziduální + porovnávací metoda
  - Byty/domy: porovnávací (primární) + výnosová + nákladová
  - Komerční: výnosová DCF (primární) + porovnávací
- **Bezpečnostní koeficienty pro zástavní hodnotu:**
  - Byty: 80 %, Rodinné domy: 70 %, Pozemky: 60 %, Komerční: 65–75 %
- **Red flags screening:** věcná břemena, přístupová cesta, zástavy, exekuce

---

## Navigační struktura webu

```
index.html (Homepage)
├── apps.html (Všechny aplikace)
├── debt-calculator.html
├── real-estate-prompt-generator.html
└── sp500-calculator.html
```

Navigace je jednotná na všech stránkách — 2 položky: **Domů** a **Aplikace**. V pravém horním rohu je přepínač Light/Dark mode (ikona slunce/měsíce).

---

## Deployment

- **Platforma:** Vercel
- **CI/CD:** Automatický deploy při push na `main` branch na GitHubu
- **Build čas:** ~30 sekund
- **Produkce:** https://main-five-alpha.vercel.app
- **CDN cache pro API:** s-maxage=86400 (24h), stale-while-revalidate=3600 (1h)

---

## Pravidla pro tvorbu nových aplikací

1. Zkopírovat `APP-TEMPLATE.html` jako základ
2. Změnit `<title>` a `.app-title`
3. Přidat vlastní formuláře a funkcionalitu
4. **NEMĚNIT:** navigaci (`.top-nav`), footer (`.footer`), theme switching, CSS proměnné
5. Používat výhradně CSS proměnné (`var(--accent)`, `var(--bg-primary)` atd.)
6. Otestovat v obou módech (light i dark)
7. Otestovat responzivitu na mobilu

---

## Klíčové vlastnosti webu

- Rychlé a přesné výpočty s profesionální přesností
- Bezpečné — všechny výpočty probíhají lokálně v prohlížeči (kromě S&P 500 API)
- Plně responzivní — funguje na PC, tabletu i mobilu
- Export dat do PDF a Excel
- Profesionální SVG ikonky s gradient efekty
- Jednotný vizuál napříč všemi aplikacemi

---

## Verze a changelog

| Verze | Datum | Popis |
|---|---|---|
| 3.0 | 14. února 2026 | Nový DayNight design, light/dark mode, jednotný vizuál, aktualizovaný Debt Calculator, nové logo, design system dokumentace, app template |

---

## Kontext pro AI asistenta

Při práci s tímto projektem pamatuj:
- Martin **není programátor** — je investiční profesionál a CEO ProfiLend
- Obor: správa peněz pro miliardáře, investice, dluhové financování
- Komunikace probíhá **v češtině**
- Soubory na OneDrive **NEUPRAVOVAT, NEMAZAT, NEOTVÍRAT**
- Nové soubory ukládat na lokální disk C, pokud nejsou součástí tohoto projektu
- Projekt ProfiLend: https://profilend.cz/cs/

---

**Poslední aktualizace:** 4. března 2026
**Verze projektu:** 3.0
**Autor:** Martin Dlouhý
