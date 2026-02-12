# Investment Tools - Update Documentation

## 📅 Datum aktualizace: 10. února 2026

## 🆕 Nové funkce a změny

### ✅ Nová aplikace: R-E Prompt Generator
- **Soubor**: `real-estate-prompt-generator.html`
- **Účel**: Generování profesionálních AI promptů pro valuaci nemovitostí
- **Funkce**:
  - Podporuje 4 typy nemovitostí: Pozemek, Byt, Rodinný dům, Komerční objekt
  - Profesionální bankovní prompty založené na zákoně č. 151/1997 Sb. a § 29 zákona o dluhopisech
  - Reziduální metoda pro developerské projekty
  - Výnosová, porovnávací a nákladová metoda ocenění
  - Identifikace Red Flags (právní vady, věcná břemena)
  - Výpočet zástavní hodnoty pro LTV
  - Export promptu do schránky pro použití v ChatGPT/Claude/Gemini

### 🔧 Vylepšení Debt Calculator
- **Přidáno**: Tlačítko "← Zpět" pro návrat na hlavní stránku
- **Soubor**: `debt-calculator.html`

### 🎨 Design úpravy
- **R-E Prompt Generator**: Barevné gradienty pro rozlišení typů nemovitostí
  - Pozemek: zelený gradient
  - Byt: modrý gradient
  - Dům: oranžový gradient
  - Komerční: fialový gradient
- **Profesionální vzhled**: Odstranění emoji, čistý finanční design
- **Konzistentní UI**: Stejný design napříč všemi aplikacemi

### 📝 Oprava inline CSS
- **index.html**: Přidán kompletní inline CSS pro zajištění správného načtení stylů
- **Důvod**: Řešení problému nenačítání externího `styles.css` na Vercel

## 📂 Struktura souborů

```
├── index.html                          # Hlavní vstupní stránka (s inline CSS)
├── styles.css                          # Globální styly
├── script.js                           # Základní JavaScript
├── apps.html                           # Přehled aplikací
├── about.html                          # O mně
├── debt-calculator.html                # Kalkulačka dluhového financování (+ tlačítko zpět)
├── real-estate-prompt-generator.html   # NOVÝ - R-E Prompt Generator
├── vercel.json                         # Vercel konfigurace
└── README.md                           # Tato dokumentace
```

## 🚀 Deployment instrukce

### Rychlý update přes GitHub:

1. **Nahraď všechny soubory v repozitáři**
   ```bash
   # Smažte staré soubory a nahraďte novými
   git pull
   # Zkopírujte všechny soubory z této složky
   git add .
   git commit -m "Update: Přidán R-E Prompt Generator, vylepšení UI"
   git push
   ```

2. **Vercel automaticky deployuje**
   - Vercel detekuje změny v GitHub
   - Automaticky spustí nový build
   - Za ~30-60 sekund budou změny live

### Kontrola po deployi:

✅ Zkontrolujte:
- [ ] `https://calculator-01-roan.vercel.app/` - hlavní stránka se načte
- [ ] CSS se načítá správně (barevný gradient pozadí)
- [ ] Debt Calculator má tlačítko "← Zpět"
- [ ] R-E Prompt Generator funguje
- [ ] Tlačítko "Kopírovat" ve R-E Prompt Generator funguje (na HTTPS už nebude error)

## 🔗 Odkazy na aplikace

Po deployi budou dostupné:
- **Hlavní stránka**: `https://calculator-01-roan.vercel.app/`
- **Debt Calculator**: `https://calculator-01-roan.vercel.app/debt-calculator.html`
- **R-E Prompt Generator**: `https://calculator-01-roan.vercel.app/real-estate-prompt-generator.html`

## 📊 Testovací checklist

Po nahrání na Vercel otestuj:

### Index.html
- [ ] Gradient pozadí se zobrazuje
- [ ] Navigace funguje
- [ ] 4 karty aplikací se zobrazují
- [ ] CTA tlačítka jsou klikací

### Debt Calculator
- [ ] Tlačítko "← Zpět" funguje
- [ ] Všechny výpočty fungují
- [ ] Export PDF/Excel funguje
- [ ] Měnový přepínač (CZK/EUR/USD) funguje

### R-E Prompt Generator
- [ ] 4 typy nemovitostí mají barevné pozadí (zelená/modrá/oranžová/fialová)
- [ ] Výběr typu funguje
- [ ] Checkboxy vstupů fungují
- [ ] Formulář se vyplňuje
- [ ] Prompt se generuje
- [ ] **Tlačítko "Kopírovat" funguje** (error zmizí na HTTPS!)
- [ ] Tlačítko "← Zpět" funguje

## 🐛 Známé problémy a řešení

### Clipboard API error (lokální testování)
**Problém**: `NotAllowedError: Failed to execute 'writeText' on 'Clipboard'`
**Řešení**: Error je pouze při lokálním testování (`file://`). Po nahrání na Vercel (HTTPS) funguje perfektně.

### CSS se nenačítá
**Problém**: Styly se neaplikují
**Řešení**: `index.html` má nyní inline CSS jako fallback. Externí `styles.css` zůstává pro ostatní stránky.

## 📞 Podpora

Pokud se po deployi objeví problémy:
1. Zkontroluj Vercel deployment log
2. Ověř, že všechny soubory byly nahrány
3. Hard refresh (Ctrl+F5) v prohlížeči

---

**Verze**: 2.0
**Datum**: 10. února 2026
**Autor**: Martin Dlouhý
