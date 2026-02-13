# Investment Tools - Deployment Guide

## 📦 Soubory k nahrání na GitHub

Nahraďte následující soubory na GitHubu:

### ✅ Soubory k nahrazení:
1. **index.html** - nová homepage s DayNight designem
2. **apps.html** - aktualizovaná stránka aplikací
3. **styles.css** - kompletní nové styly
4. **script.js** - JavaScript s theme switchingem

### 📁 Soubory ponechat beze změny:
- debt-calculator.html
- real-estate-prompt-generator.html
- default-ai-prompt.md
- ui-overview.html
- vercel.json
- README.md (nebo nahradit tímto)

## 🚀 Postup nasazení:

### 1. Nahrání na GitHub
```bash
# V lokální složce projektu:
git add index.html apps.html styles.css script.js
git commit -m "Update: New DayNight design with dark/light mode"
git push origin main
```

### 2. Vercel automaticky deployuje
- Vercel detekuje změny na GitHubu
- Spustí automatický build
- Za ~30-60 sekund budou změny live na https://main-five-alpha.vercel.app

### 3. Kontrola po deployi
✅ Zkontrolujte:
- [ ] Homepage se načte správně
- [ ] Dark/Light mode přepínač funguje (vpravo nahoře)
- [ ] Navigace mezi stránkami funguje
- [ ] App karty se zobrazují správně
- [ ] Footer je kompletní

## 🎨 Design Features:

### Nový design:
- ✅ **Minimalistický flat design** inspirovaný DayNight template
- ✅ **Dark/Light mode** (přepínač vpravo nahoře)
- ✅ **Profesionální SVG logo** místo emoji
- ✅ **Gradient app ikony** (zelená, modrá, fialová, oranžová)
- ✅ **Čisté barvy**: světle modrá accent (#38BDF8)
- ✅ **DM Sans font** pro profesionální vzhled

### Zachované funkce:
- ✅ **2 navigační položky**: Domů a Aplikace
- ✅ **4 app karty** s live/coming soon statusy
- ✅ **Features sekce**
- ✅ **CTA sekce**
- ✅ **Responzivní design**

## 🌓 Dark Mode:

### Jak funguje:
1. **Kliknutí na ikonu** slunce/měsíce v pravém horním rohu
2. **Automatické uložení** v localStorage prohlížeče
3. **Instant load** - stav se načte okamžitě při otevření
4. **Persistent** - zůstává zachován i po zavření prohlížeče

### Barvy:
**Light Mode (Snow Edition):**
- Background: #FFFFFF, #F8FAFC
- Text: #1E293B
- Accent: #38BDF8

**Dark Mode (Carbon Edition):**
- Background: #0F0F0F, #171717
- Text: #F5F5F5
- Accent: #38BDF8

## 📞 Podpora

Pokud se objeví problémy:
1. Zkontrolujte Vercel deployment log
2. Hard refresh (Ctrl+F5) v prohlížeči
3. Ověřte, že všechny soubory byly nahrány

---

**Verze**: 3.0  
**Design**: Based on DayNight Admin Template  
**Datum**: 14. února 2026  
**Autor**: Martin Dlouhý
