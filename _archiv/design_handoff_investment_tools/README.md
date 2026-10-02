# Investment Tools — Design Handoff

Personální platforma Martina Dlouhého: hub vlastních aplikací (osobní + pracovní + ProfiLend) ve stylu editoriálního finančního deníku — temné pozadí, Fraunces display, amber akcent, Mercury/Linear-vibe.

---

## ✦ O souborech v balíčku

Soubory v `apps/` a `hero-preview.html` jsou **HTML prototypy**, ne produkční kód. Demonstrují vizuální jazyk, layout, mikrointerakce a copywriting — ale nejsou určeny k přímému nasazení.

**Tvůj úkol:** Tyto designy znovuvytvoř v cílovém prostředí (React / Next.js / Vue / Astro — podle volby). Pokud existující stack **není**, doporučuji **Next.js 14 (App Router) + Tailwind CSS + shadcn/ui** — sedí na prototyp 1:1 a všechny komponenty jsou už hotové.

---

## ✦ Fidelita

**High-fidelity.** Pixel-perfect: barvy, typografie (Fraunces 300/400 italic), spacing, mikroanimace, copywriting v češtině jsou finální. Tokeny v `tokens.css` jsou kanonické — přenes je 1:1 do `globals.css` / `tailwind.config.ts`.

---

## ✦ Architektura projektu

```
investment-tools/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # globální layout + nav header
│   ├── page.tsx                  # hero-preview.html → homepage
│   ├── debt-calculator/page.tsx
│   ├── re-prompt-generator/page.tsx
│   ├── sp500-calculator/page.tsx
│   ├── portfolio-dashboard/page.tsx
│   ├── termsheet-generator/page.tsx
│   ├── loan-documentation/page.tsx
│   └── marketing-agent/page.tsx
├── components/
│   ├── ui/                       # shadcn primitives
│   ├── shell/
│   │   ├── nav-header.tsx        # globální header s dropdowny
│   │   ├── app-meta.tsx          # crumbs + tools row
│   │   ├── app-head.tsx          # eyebrow + title + sub + actions
│   │   └── app-footer.tsx
│   ├── hero/
│   │   ├── curtain-reveal.tsx    # 3s load animace
│   │   ├── hero-image.tsx        # Krumlov + řeka + light decay
│   │   └── apps-list.tsx         # 3 sekce s app-rows
│   └── apps/
│       └── (specifické komponenty per aplikace)
├── lib/
│   ├── google-drive.ts           # OAuth + Drive API
│   ├── one-drive.ts              # OAuth + Graph API
│   └── claude.ts                 # Anthropic SDK (Sonnet 4.5)
├── styles/
│   ├── globals.css               # @import tokens.css + base
│   └── tokens.css                # ← z handoff balíčku
└── public/
    └── assets/
        ├── hero.png              # Krumlov fotografie
        └── river-mask.svg        # SVG maska pro animaci řeky
```

---

## ✦ Design tokens

Plný seznam je v `tokens.css`. Klíčové hodnoty:

### Surfaces (tmavá paleta)
| Token | Hex | Použití |
|---|---|---|
| `--bg-deep` | `#070910` | body |
| `--bg` | `#0b0f17` | default surface |
| `--bg-raised` | `#11161f` | karty, header |
| `--bg-elevated` | `#161c27` | modaly, dropdowny |
| `--bg-input` | `rgba(232,223,208,0.04)` | inputy |

### Akcent (amber — ProfiLend značka)
| Token | Hex |
|---|---|
| `--amber` | `#e8b97c` |
| `--amber-warm` | `#f4c98a` |
| `--amber-deep` | `#b8884c` |
| `--amber-tint` | `rgba(232,185,124,0.08)` |
| `--amber-glow` | `rgba(232,185,124,0.18)` |

### Text
| Token | Hex / opacity |
|---|---|
| `--text` | `#f1ece1` (off-white, papírový) |
| `--text-soft` | 72% off-white |
| `--text-mute` | 46% |
| `--text-faint` | 30% |

### Sémantické
| Token | Hex | Použití |
|---|---|---|
| `--success` | `#7fd99a` | up/positive deltas |
| `--warning` | `#f0b056` | flagy |
| `--danger` | `#e87c6e` | down/negative deltas |
| `--info` | `#8ab4d8` | info badges |

### Typografie
- **Display:** `'Fraunces', serif` — pro nadpisy, kurzíva pro akcenty (`<em>` slova v amber-warm)
- **Body:** `'Inter', sans-serif`
- **Mono:** `'JetBrains Mono', monospace` — čísla, statistiky, kódy

Velikostní škála: `--fs-display 56px` / `--fs-h1 40px` / `--fs-h2 28px` / `--fs-h3 20px` / `--fs-body 15px` / `--fs-small 13.5px` / `--fs-tiny 11px`.

Tracking: `--tracking-display -0.02em` / `--tracking-eyebrow 0.18em uppercase`.

### Spacing
8px scale: `4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56 / 80`. V Tailwindu mapuje 1:1 na `space-1, space-2, …, space-20`.

### Radii
`--r-sm 6px` / `--r-md 8px` / `--r-lg 12px` / `--r-xl 18px`.

### Motion
- `--ease: cubic-bezier(0.4, 0, 0.2, 1)` (standard)
- `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` (entries)
- Durations: `150 / 250 / 400 ms`

---

## ✦ Komponentní inventář (app-shell.css)

### Globální header (`.nav`)
- Sticky top, výška `76px`
- Pozadí: `var(--bg-raised)` s `backdrop-filter: blur(20px)`
- 3 sekce: logo (vlevo) — nav menu (uprostřed) — slot (vpravo)
- 3 nav-itemy s dropdowny: **Osobní**, **Pracovní**, **ProfiLend**
- Dropdown: `position:absolute`, otevírá se hover/click, položky s ikonkou + name + meta

### Stránkový shell
1. `.app-meta` — crumbs vlevo, tools vpravo (currency switcher, refresh)
2. `.app-head` — eyebrow uppercase + h1 (Fraunces, italic em pro akcenty) + subtitle + actions
3. `.workspace-wide` — content container (max-width 1200px)
4. `.app-footer` — minimal copy + odkaz do Drive

### Karty
- `.panel` — `background:var(--bg-raised)` / `border:1px solid var(--line-faint)` / `border-radius:var(--r-lg)`
- `.panel-head` — title + meta (oddělen `border-bottom`)
- `.panel-body` — `padding:24px 28px`

### Inputy
- `.input` — outline-style, focus dává amber glow `box-shadow: 0 0 0 3px var(--amber-glow)`
- `.input-currency` / `.input-pct` — grid s suffixem (CZK / % p.a. / let)
- `.dropdown-field` — custom dropdown (button trigger + ul menu)
- `.field-row` — 2-column grid (1fr 1fr) — **MUSÍ mít `min-width:0` na children kvůli grid overflow!**

### Buttony
- `.btn-primary` — amber gradient, dark text, ikona vpravo
- `.btn-secondary` — outline, hover amber-tint
- `.btn-ghost` — transparent, jen hover bg
- `.btn-icon` — square 32px, transparent

### Tabulky
- `.table` — first column left, ostatní `.right`
- Hover row: `background: var(--bg-input)`
- Sticky header pokud `.table-wrap` má `max-height`

### Stat cards (dashboard)
- `.stat-card` — eyebrow label + h2 number (Fraunces) + delta + meta
- `.stat-delta.up/.down` — barva success/danger, **`white-space:nowrap`**!

### Toasty
- `.toast` — bottom-right, `transform: translateY(100%)` → `0` na class `.show`
- 2.4s timeout, ikona check

---

## ✦ Stránky / aplikace

### 0. Hero / homepage (`hero-preview.html`)

**Účel:** Vstupní brána. Curtain reveal → klid → seznam aplikací po scrollu.

**Layout:**
- Full-viewport hero (100vh)
- Levý sloupec (`grid-template-columns: 1.1fr 1fr`): meta-eyebrow "MARTIN DLOUHÝ · 2026" + h1 *"Tichá místnost s výhledem"* (Fraunces 300, 56px) + subtitle + scroll prompt
- Pravý sloupec: hero foto (`assets/hero.png` — Krumlov) s SVG maskou animace řeky
- **Curtain reveal:** body má 3s overlay z `--bg-deep` se 4 frame keyframes, pak fade-out (lze přeskočit klikem)
- **Apps section:** 3 sekce po scrollu
  - 01 Osobní — Debt Calculator, R-E Prompt Generator, S&P 500 Portfolio
  - 02 Pracovní — Portfolio Dashboard
  - 03 ProfiLend — Term Sheet, Úvěrová dokumentace, Marketing Agent
- App-row: `64px ikona + 1fr name+desc + auto tag + auto arrow`, hover posune content +10px a obarví name amber

**Technické:**
- Curtain animace: CSS only, `prefers-reduced-motion` → skip
- River animation: SVG mask s `animateMotion` nebo `<g>` translate keyframes
- IntersectionObserver pro fade-in app sections

---

### 1. Debt Calculator (`apps/debt-calculator.html`)

**Účel:** Výpočet měsíční splátky úvěru/hypotéky. Anuitní + lineární.

**Layout:** 2-col grid `minmax(380px,440px) 1fr`
- **Levý panel:** Form
  - Částka úvěru (input s CZK suffix)
  - Úroková sazba | Splatnost (field-row 1fr 1fr s % p.a. / let suffixy)
  - Typ splácení (dropdown: Anuitní / Lineární / Bullet)
- **Pravý panel:** Result hero
  - Velký amber gradient na pozadí, Fraunces 80px číslo splátky
  - Pruh "Rozložení celkových plateb" (jistina vs úroky)
  - 3-column grid: Celkem zaplaceno / Úroky / RPSN
  - Sticky tabulka splátkového kalendáře (toggle ročně/měsíčně)

**State:**
```ts
type DebtCalcState = {
  amount: number;       // CZK
  rate: number;         // % p.a.
  years: number;        // let
  type: 'annuity' | 'linear' | 'bullet';
};
```
**Výpočet:** `m = P*r*(1+r)^n / ((1+r)^n - 1)` kde `r = rate/12/100`, `n = years*12`.

**Interakce:** `onChange` debounced 300ms → recompute. Reset btn → výchozí hodnoty.

---

### 2. R-E Prompt Generator (`apps/re-prompt-generator.html`)

**Účel:** 6-krokový wizard pro tvorbu strukturovaných promptů pro AI valuaci nemovitostí. Output je formátovaný YAML-like prompt → kopírovat / Otevřít v ChatGPT.

**Layout:** 3-col grid: stepper rail (240px) | wizard panel (1fr) | output preview (1fr)
- **Stepper:** Vertikální 6 kroků, sticky. Aktivní = amber border + glow, done = ✓ amber fill
- **Wizard panel:** title v Fraunces, body s field-grids, foot = Zpět / progress / Další
- **Output preview:** mono font, syntax highlight (key amber, val text-soft, comment muted), kopírovací btn

**State:**
```ts
type WizardState = {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  property: { type, area, location, street };
  condition: { overall, floor, elevator };
  amenities: string;
  energy: string;
  // … další kroky
};
```

**6 kroků:** Lokace | Fyzika nemovitosti | Stav & vybavení | Cena & kontext | Trh | Zaměření výstupu

---

### 3. S&P 500 Portfolio (`apps/sp500-calculator.html`)

**Účel:** Rozklad zadané investiční částky na 503 akcií S&P 500 podle market cap.

**Layout:** Vertikální stack (full-width)
1. **Calc panel:** input "Investiční částka" (Fraunces 24px) + currency switch + 5 quick-amount chips | summary (Akcií / Sektorů / Vážený P/E / USD/CZK kurz)
2. **Sektorová alokace:** 2-col grid 11 sektorů s horizontálním bar (3px height, amber fill)
3. **Top 30 pozic:** Tabulka — # | Společnost (ticker chip + name + sector) | Sektor | Váha | Investice | Akcie | Cena | D/D pill
4. **Note:** disclaimer ohledně zlomků akcií, daní, FX

**Data zdroj:** Statický JSON nebo external API (např. Twelve Data / Polygon). V prototypu hard-coded top 15.

---

### 4. Portfolio Dashboard (`apps/portfolio-dashboard.html`)

**Účel:** Přehled celkového portfolia (nemovitosti + akcie + dluhopisy + PE + cash).

**Layout:**
1. **Stats grid 4-col:** Hodnota portfolia / IRR 12M / Aktivní pozice / Volná hotovost (s deltami)
2. **2-col:** Performance chart (SVG line + benchmark dashed) | Allocation donut (5 segmentů, legend vpravo)
3. **Holdings table:** filter bar (search + segmented Vše/Real Estate/Akcie/Bonds/PE) + tabulka 8 řádků s holding-mark avatarem

**Performance chart:**
- SVG `viewBox="0 0 600 240"`, gridlines, benchmark dashed (text-faint), portfolio gradient fill (amber → transparent)
- End dot s glow halo
- Tabs: 1M / 3M / 6M / YTD / 1R / 5R

**Donut:** SVG circle s `stroke-dasharray` segmenty, center = celková hodnota Fraunces.

---

### 5. Term Sheet Generator (`apps/termsheet-generator.html`)

**Účel:** Tvorba klientského term sheetu. Form + live preview + export Word/PDF.

**Layout:** 2-col grid
- **Levý panel:** form sekce (Klient / Nemovitost / Úvěr / Splácení / Sankce)
- **Pravý panel:** Word/A4-style preview na světlém papírovém pozadí (`#f4eee2`)
  - Fraunces nadpisy, struktura I.–VII., highlighted varianty (amber tint na změnách)
  - Pravý sloupec sticky s actions: Náhled v Drive / Stáhnout DOCX / Stáhnout PDF / Sdílet odkaz

**Drive integrace:** badge "Drive: připojeno", tlačítko "Uložit do Drive / Klienti / [název]"

---

### 6. Úvěrová dokumentace (`apps/loan-documentation.html`)

**Účel:** Generování úvěrových smluv ze šablon na Drive. AI doplní parametry, zvýrazní změny.

**Layout:** 2-col
- **Levý panel:** Template picker (4 karty: Úvěrová / Zástavní / Smlouva budoucí / Splátkový kalendář) + Drive-row se zvolenou šablonou + form (Klient / Nemovitost / Úvěr)
- **Pravý column:**
  - Live document preview (papírový styl jako termsheet)
  - **AI strip nahoře:** badge "Claude Sonnet 4.5" + popis + Přegenerovat btn
  - **Highlighted changes:** `<span class="doc-edit">` má amber tint background + "AI" badge top-right
  - **Changes panel:** seznam úprav s ikonkou (→ vlož / + přidat / ! flag) + popis + akce

**API:**
```ts
async function generateContract(template: TemplateId, params: ContractParams) {
  const drive = await getDriveTemplate(template);
  const result = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    system: 'Doplň parametry do šablony ProfiLend úvěrové smlouvy. Vrať diff s flagy ke kontrole.',
    messages: [{ role: 'user', content: [drive.text, params] }],
  });
  return parseDiff(result);
}
```

---

### 7. Marketing Agent (`apps/marketing-agent.html`)

**Účel:** AI generování příspěvků na sociální sítě podle ProfiLend Brand Guide.

**Layout:** 2-col
- **Levý panel — Brief & parametry:**
  - Téma (textarea)
  - Kanály (chips multi-select: Instagram / LinkedIn / Newsletter / X)
  - Tón hlasu (4 karty: Edukativní / Důvěryhodný / Inspirativní / Konverzační)
  - Délka (slider 50–600 znaků)
  - Klíčová data + CTA inputs
  - Drive-row: "Marketing / Brand kit / ProfiLend Visual v1.0"
- **Pravý panel — Preview:**
  - Tabs: Instagram feed / LinkedIn / var. B/3 indicator
  - **IG post mockup** — bílé pozadí, square image (Krumlov-style dark gradient s Fraunces title), avatar, ikony likes/comments/save, caption + hashtags, schedule meta
  - **3 varianty pod tím** (A věcná / B příběh / C otázka) — klikatelné karty
  - **Kalendář** — týdenní view se značkami plánovaných postů

**Brand guide enforced:**
- Žádné emoji
- Fraunces na imagery
- Tone: důvěryhodný, věcný, datově podložený
- Hashtagy: `#ProfiLend #financovani #nemovitosti #hypoteka`

---

## ✦ Drive / OneDrive integrace

Aplikace ProfiLend (loan-documentation, marketing-agent, term-sheet) jsou propojeny s **Google Drive** pro šablony a uložené dokumenty. Doporučený stack:

```ts
// lib/google-drive.ts
import { google } from 'googleapis';

export async function listTemplates(folderId: string) { ... }
export async function readDocx(fileId: string): Promise<string> { ... }
export async function saveDocument(folderId: string, name: string, content: Blob) { ... }
```

OneDrive (osobní aplikace) — Microsoft Graph SDK:
```ts
// lib/one-drive.ts
import { Client } from '@microsoft/microsoft-graph-client';
```

**UI vzor pro Drive integraci** je v `apps/loan-documentation.html` (.drive-row komponenta) — replikuj na ostatní aplikace tam, kde uživatel chce uložit/načíst kalkulaci.

---

## ✦ Mikrointerakce a chování

### Curtain reveal (hero)
- 3s na load, 4 frame keyframes
- `prefers-reduced-motion: reduce` → instant skip
- Klik kdekoli během animace → skip k finálu
- LocalStorage `hero_seen` → po prvním načtení skip

### Dropdown menu (header)
- Hover desktop / click mobile
- 250ms ease, `transform: translateY(-4px)` → `0` + opacity
- Click outside → close
- Šipka rotuje 180° na expanded

### Stepper (R-E wizard)
- Done krok = amber fill + ✓
- Active = amber border + 4px amber-glow shadow
- Klik na done krok → jump back; klik na future → blocked

### Live document highlight
- AI změny: amber tint background + "AI" badge top-right
- Hover na change = popup s "auto-doplněno z formuláře / čl. III, odst. 4"

### Toast
- Bottom-right, 2.4s, fade in/out
- Použito po Copy / Save / Export akcích

---

## ✦ Responsive

- **Desktop ≥1100px:** plný 2-3 column layout
- **Tablet 768–1100px:** 1 column, sidebar/preview pod sebou
- **Mobile <768px:** simplified — apps-list jen ikona+name, žádné tagy/arrows. Header dropdowny → hamburger menu (TODO).

V prototypech jsou breakpointy ošetřené @media; pro produkci doporučuji Tailwind `md:` / `lg:` / `xl:` ekvivalenty.

---

## ✦ Assety

| Soubor | Popis | Použití |
|---|---|---|
| `assets/hero.png` | Český Krumlov fotografie (večer, řeka, hrad) | Hero sekce homepage |
| `assets/river-mask.svg` | SVG maska pro animaci tekoucí Vltavy | Overlay nad hero.png |

**Poznámka:** Nahraď za vlastní finální fotku Krumlova ve vyšším rozlišení (ideálně 2400×1600px, soumrak/zlatá hodina). Aktuální `hero.png` je pracovní.

**Ikony aplikací:** SVG line icons inline v dropdownech a app-rows. Jsou to custom Fraunces-vibe glyphy (váha, dům, graf, donut, dokument, dokumenty, bublina). Lze migrovat na Lucide React (`Scale, Home, TrendingUp, PieChart, FileText, Files, MessageSquare`) — vizuálně stejný štýl.

---

## ✦ Soubory v balíčku

```
design_handoff_investment_tools/
├── README.md                        # tento dokument
├── tokens.css                       # design tokens (CSS variables)
├── app-shell.css                    # globální komponentní knihovna
├── hero-preview.html                # homepage / hero
├── design-system.html               # přehled všech tokenů a komponent
└── apps/
    ├── debt-calculator.html
    ├── re-prompt-generator.html
    ├── sp500-calculator.html
    ├── portfolio-dashboard.html
    ├── termsheet-generator.html
    ├── loan-documentation.html
    └── marketing-agent.html
```

---

## ✦ Doporučený postup implementace

1. **Setup Next.js 14** + TypeScript + Tailwind + shadcn/ui
2. **Migrace tokens.css** → `tailwind.config.ts` (extend theme: colors, fontFamily, fontSize, spacing, borderRadius)
3. **Globální layout** — header s dropdowny, footer
4. **Homepage** — curtain reveal jako client component s `useEffect` + IntersectionObserver pro apps fade-in
5. **Postupně aplikace** — od jednodušší (debt calc) ke složitějším (loan doc, marketing agent s AI)
6. **Drive/OneDrive integrace** — OAuth, server-side actions
7. **Anthropic SDK** — pro loan-doc + marketing agent (server actions, ne client)
8. **Deploy:** Vercel + env vars (`ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `MS_CLIENT_ID`, …)

---

**Brand:** ProfiLend (vlastník: Martin Dlouhý)
**Verze designu:** v1.0 — 26. dubna 2026
**Kontakt:** martin@profilend.cz
