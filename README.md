# Investment Tools - GitHub Deployment Package

## 📦 Obsah balíčku

Tento balíček obsahuje všechny soubory potřebné pro nasazení Investment Tools na Vercel.

### ✅ Soubory k nahrání na GitHub:

#### Hlavní stránky:
1. **index.html** - Homepage s DayNight designem
2. **apps.html** - Přehled všech aplikací
3. **styles.css** - Globální styly (light/dark mode)
4. **script.js** - Theme switching a funkce

#### Aplikace:
5. **debt-calculator.html** - Debt Financing Calculator (aktualizováno)
6. **real-estate-prompt-generator.html** - Z původního projektu (nebo nahraďte novou verzí)

#### Konfigurace:
7. **vercel.json** - Vercel konfigurace

#### Dokumentace:
8. **APP-TEMPLATE.html** - Šablona pro nové aplikace
9. **DESIGN-SYSTEM.md** - Design system dokumentace
10. **default-ai-prompt.md** - AI prompt template
11. **README.md** - Tento soubor

## 🚀 Postup nasazení

### Způsob 1: Přes GitHub Web Interface (Jednodušší)

1. **Jděte na GitHub repozitář:**
   ```
   https://github.com/martin1dlouhy/Main-Project
   ```

2. **Pro každý soubor:**
   - Klikněte na soubor (např. `index.html`)
   - Klikněte na ikonu tužky (Edit)
   - Smažte obsah
   - Zkopírujte obsah z nového souboru
   - Klikněte "Commit changes"

3. **Pro nové soubory:**
   - Klikněte "Add file" → "Create new file"
   - Pojmenujte soubor (např. `APP-TEMPLATE.html`)
   - Vložte obsah
   - Klikněte "Commit changes"

### Způsob 2: Přes Git (Pro pokročilé)

```bash
# 1. Klonujte repozitář
git clone https://github.com/martin1dlouhy/Main-Project.git
cd Main-Project

# 2. Nahraďte soubory novými verzemi
# (překopírujte všechny soubory z tohoto balíčku)

# 3. Přidejte změny
git add .

# 4. Commitněte
git commit -m "Update: Unified DayNight design with dark/light mode"

# 5. Pushněte na GitHub
git push origin main
```

## ⚙️ Automatický deployment na Vercel

Vercel automaticky detekuje změny na GitHubu a deployuje:

1. **Push na GitHub** → Změny nahrány
2. **Vercel detekuje** → Spustí build (~30 sekund)
3. **Live na webu** → https://main-five-alpha.vercel.app

## ✅ Kontrola po nasazení

Po deployi zkontrolujte:

- [ ] Homepage se načte správně
- [ ] Navigace funguje (Domů, Aplikace)
- [ ] Dark/Light mode přepínač funguje
- [ ] Debt Calculator funguje a počítá správně
- [ ] Apps stránka zobrazuje všechny aplikace
- [ ] Footer je kompletní
- [ ] Responzivní na mobilu

## 🎨 Design Features

### Nový unified design:
- ✅ **DayNight minimalistický styl**
- ✅ **Light/Dark mode** (přepínač vpravo nahoře)
- ✅ **Profesionální SVG logo**
- ✅ **Jednotné barvy** napříč stránkami
- ✅ **DM Sans font**
- ✅ **Responzivní design**

### Zachované funkce:
- ✅ Všechny kalkulace v Debt Calculator
- ✅ Export PDF/Excel (tlačítka připravena)
- ✅ Měnový přepínač
- ✅ Všechny stránky funkční

## 📁 Struktura projektu

```
Main-Project/
├── index.html                      # Homepage ✨ NOVÝ
├── apps.html                       # Aplikace ✨ NOVÝ
├── styles.css                      # Globální styly ✨ NOVÝ
├── script.js                       # JavaScript ✨ NOVÝ
├── debt-calculator.html            # Kalkulačka ✨ AKTUALIZOVÁNO
├── real-estate-prompt-generator.html  # Prompt gen (ponechat/nahradit)
├── vercel.json                     # Vercel config
├── default-ai-prompt.md            # AI template
├── APP-TEMPLATE.html               # Template ✨ NOVÝ
├── DESIGN-SYSTEM.md                # Dokumentace ✨ NOVÝ
└── README.md                       # Tento soubor
```

## 🔧 Pro budoucí aplikace

### Vytvoření nové aplikace:

1. **Zkopírujte template:**
   ```bash
   cp APP-TEMPLATE.html my-new-app.html
   ```

2. **Upravte obsah:**
   - Změňte `<title>` a `.app-title`
   - Přidejte své formuláře
   - Přidejte funkcionalitu

3. **NEMĚŇTE:**
   - Navigaci (`.top-nav`)
   - Footer (`.footer`)
   - Theme switching

4. **Přečtěte dokumentaci:**
   - Otevřete `DESIGN-SYSTEM.md`
   - Následujte best practices

## 🌓 Dark Mode

### Jak funguje:
- Uživatel klikne na ikonu slunce/měsíce
- JavaScript přidá třídu `.carbon` na `<html>` a `<body>`
- CSS automaticky použije dark mode proměnné
- Stav se uloží do `localStorage`

### Pro vývojáře:
Používejte CSS proměnné místo fixed barev:
```css
/* ✅ Správně */
color: var(--text-primary);
background: var(--bg-primary);

/* ❌ Špatně */
color: #1E293B;
background: #FFFFFF;
```

## 📞 Troubleshooting

### Vercel se neaktualizoval:
1. Zkontrolujte Vercel dashboard
2. Zkontrolujte deployment log
3. Hard refresh (Ctrl+F5) v prohlížeči

### CSS se nenačítá:
1. Zkontrolujte konzoli prohlížeče (F12)
2. Ověřte, že `styles.css` je na GitHubu
3. Zkontrolujte cesty (`href="styles.css"`)

### Dark mode nefunguje:
1. Zkontrolujte, že `script.js` se načítá
2. Otevřete konzoli prohlížeče
3. Zkontrolujte localStorage

## 📊 Design System

Kompletní dokumentace designu je v souboru `DESIGN-SYSTEM.md`.

Obsahuje:
- Barvy (light/dark mode)
- Typografii
- Spacing
- Komponenty
- Best practices
- Příklady kódu

## 🎯 Priority po nasazení

1. **Zkontrolujte funkčnost** všech stránek
2. **Otestujte dark mode** na všech stránkách
3. **Zkontrolujte mobil** (responzivita)
4. **Nahraďte R-E Prompt Generator** novou verzí (volitelné)

## 📝 Changelog

### Version 3.0 (14. února 2026)
- ✅ Nový DayNight minimalistický design
- ✅ Light/Dark mode support
- ✅ Jednotný vizuál napříč aplikacemi
- ✅ Aktualizovaný Debt Calculator
- ✅ Nové profesionální logo
- ✅ Design system dokumentace
- ✅ App template pro budoucí aplikace

## 👤 Autor

**Martin Dlouhý**
Email: martin@dlouhy.com

---

**Version**: 3.0  
**Last Updated**: 14. února 2026  
**License**: All rights reserved
