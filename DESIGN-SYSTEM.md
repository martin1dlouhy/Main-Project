# Investment Tools - Design System

## 🎨 Jednotný vizuální design

Tento dokument popisuje design systém pro všechny aplikace Investment Tools.

## 📁 Struktura souborů

### Globální soubory (sdílené mezi všemi stránkami):
- **styles.css** - obsahuje všechny základní styly, barvy, navigaci, footer
- **script.js** - obsahuje theme switching a základní funkce

### App-specifické soubory:
- **index.html** - homepage
- **apps.html** - seznam aplikací
- **debt-calculator.html** - kalkulačka (s vlastními inline styly pro funkcionalitu)
- **real-estate-prompt-generator.html** - prompt generator
- **APP-TEMPLATE.html** - šablona pro nové aplikace

## 🎯 Design principy

### 1. Barvy

**Light Mode (Snow Edition):**
```css
--bg-primary: #FFFFFF      /* Hlavní pozadí */
--bg-secondary: #F8FAFC    /* Sekundární pozadí */
--bg-surface: #F1F5F9      /* Plochy, inputy */
--border-color: #E2E8F0    /* Bordery */
--text-primary: #1E293B    /* Hlavní text */
--text-secondary: #64748B  /* Sekundární text */
--accent: #38BDF8          /* Accent barva (světle modrá) */
```

**Dark Mode (Carbon Edition):**
```css
--bg-primary: #0F0F0F      /* Hlavní pozadí */
--bg-secondary: #171717    /* Sekundární pozadí */
--bg-surface: #1F1F1F      /* Plochy, inputy */
--border-color: #2E2E2E    /* Bordery */
--text-primary: #F5F5F5    /* Hlavní text */
--text-secondary: #A3A3A3  /* Sekundární text */
--accent: #38BDF8          /* Accent barva (stejná) */
```

### 2. Typografie

**Font:** DM Sans (Google Fonts)
```css
font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
```

**Velikosti:**
- Page title: 2.5rem (40px)
- Section title: 1.75rem (28px)
- App title: 1.75rem (28px)
- Body text: 0.9375rem (15px)
- Small text: 0.875rem (14px)
- Tiny text: 0.8125rem (13px)

### 3. Spacing

Používáme jednotnou škálu:
- xs: 0.25rem (4px)
- sm: 0.5rem (8px)
- md: 1rem (16px)
- lg: 1.5rem (24px)
- xl: 2rem (32px)

### 4. Border Radius

- Malé prvky (tlačítka, inputy): 8px
- Střední (karty): 12px
- Velké (containery): 16px

### 5. Shadows

```css
--shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.05);
```

## 🧩 Komponenty

### Navigace

Použití:
```html
<nav class="top-nav">
    <div class="nav-container">
        <div class="nav-left">
            <a href="index.html" class="logo">...</a>
            <div class="nav-menu">
                <a href="#" class="nav-link active">Text</a>
            </div>
        </div>
        <div class="nav-right">
            <div class="theme-toggle">...</div>
        </div>
    </div>
</nav>
```

### Tlačítka

```html
<!-- Primární tlačítko -->
<button class="btn btn-primary">Text</button>

<!-- Sekundární tlačítko -->
<button class="btn btn-export">Text</button>

<!-- Velké tlačítko -->
<button class="btn btn-primary btn-large">Text</button>
```

### Formuláře

```html
<div class="form-group">
    <label class="form-label">Label</label>
    <input type="text" class="form-input" placeholder="...">
</div>
```

### Karty

```html
<div class="app-card">
    <div class="app-card-header">
        <div class="app-icon green">$</div>
        <span class="app-badge live">● Live</span>
    </div>
    <h3 class="app-card-title">Název</h3>
    <p class="app-card-desc">Popis</p>
    <div class="app-card-tags">
        <span class="tag">Tag</span>
    </div>
</div>
```

## 📝 Jak vytvořit novou aplikaci

### Krok 1: Použijte template
```bash
cp APP-TEMPLATE.html my-new-app.html
```

### Krok 2: Upravte metadata
```html
<title>Název Aplikace | Investment Tools</title>
```

### Krok 3: Změňte obsah
- Upravte `.app-title` a `.app-subtitle`
- Přidejte své formuláře a funkcionalitu
- Zachovejte navigaci a footer

### Krok 4: Přidejte app-specifické styly
Pokud potřebujete vlastní styly, přidejte je do `<style>` tagu v hlavičce:
```html
<style>
    /* App-specific styles */
    .my-custom-class {
        /* ... */
    }
</style>
```

### Krok 5: NEMĚŇTE tyto části:
- ❌ Navigaci (`.top-nav`)
- ❌ Footer (`.footer`)
- ❌ CSS proměnné v styles.css
- ❌ Theme switching v script.js
- ✅ Pouze přidávejte vlastní funkce

## 🎭 Theme Switching

Všechny aplikace automaticky podporují light/dark mode.

**Jak to funguje:**
1. Uživatel klikne na ikonu slunce/měsíce
2. JavaScript přidá/odebere třídu `.carbon` na `<html>` a `<body>`
3. CSS automaticky použije dark mode proměnné
4. Stav se uloží do `localStorage`

**V nové aplikaci:**
Nemusíte nic dělat! Stačí použít CSS proměnné (`var(--bg-primary)` atd.) a vše funguje automaticky.

## 🔧 Příklady použití

### Sekce s formulářem
```html
<div class="form-section">
    <h2 class="section-title">Nadpis sekce</h2>
    <div class="form-grid">
        <div class="form-group">...</div>
        <div class="form-group">...</div>
    </div>
</div>
```

### Výsledkové karty
```html
<div class="results-section">
    <h2 class="section-title">Výsledky</h2>
    <div class="results-grid">
        <div class="result-card">
            <div class="result-label">Label</div>
            <div class="result-value">Value</div>
        </div>
    </div>
</div>
```

## ⚠️ Důležité

### DO:
✅ Používejte CSS proměnné (`var(--accent)`)
✅ Používejte komponenty z této dokumentace
✅ Testujte v light i dark módu
✅ Zachovejte navigaci a footer
✅ Používejte jednotné spacing

### DON'T:
❌ Neměňte globální styly bez konzultace
❌ Nepoužívejte fixed barvy (#2196f3) - používejte proměnné
❌ Neměňte strukturu navigace/footeru
❌ Nevytvářejte vlastní theme switching
❌ Nepoužívejte jiné fonty

## 📊 Checklist pro novou aplikaci

- [ ] Použit APP-TEMPLATE.html jako základ
- [ ] Změněn title a meta
- [ ] Zachována navigace se správnými odkazy
- [ ] Použity CSS proměnné pro barvy
- [ ] Otestován light mode
- [ ] Otestován dark mode
- [ ] Footer je kompletní
- [ ] Responzivní na mobilu
- [ ] JavaScript nerozbíjí theme switching

---

**Design System Version:** 1.0  
**Last Updated:** 14. února 2026  
**Maintainer:** Martin Dlouhý
