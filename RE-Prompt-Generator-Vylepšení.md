# Návrh vylepšení R-E Prompt Generator

## Kontext
R-E Prompt Generator je profesionální nástroj pro generování AI promptů k oceňování nemovitostí podle českých bankovních standardů. Aplikace má 4-krokový wizard (typ nemovitosti → dostupné materiály → údaje → vygenerovaný prompt) a podporuje 4 typy nemovitostí: Pozemek, Byt, Rodinný dům, Komerční objekt. Prompt se poté kopíruje do ChatGPT/Claude/Gemini.

Po důkladné analýze celého kódu (1126 řádků HTML/CSS/JS) navrhuji následující vylepšení, rozdělená do kategorií od nejpřínosnějších po nice-to-have:

---

## A. FUNKČNÍ VYLEPŠENÍ (Vysoký dopad)

### 1. Uložení a načtení rozpracované valuace (LocalStorage)
**Problém:** Při zavření prohlížeče nebo náhodném refreshi se všechna vyplněná data ztratí.
**Řešení:** Automatické ukládání stavu formuláře do localStorage + tlačítko "Načíst poslední valuaci". Umožní také uložit několik "šablon" pro opakované typy nemovitostí.

### 2. Historie vygenerovaných promptů
**Problém:** Po kliknutí na "Nová valuace" se předchozí prompt ztratí bez možnosti se k němu vrátit.
**Řešení:** Ukládat historii vygenerovaných promptů do localStorage s náhledem (typ nemovitosti, adresa, datum). Maximálně posledních 10-20 promptů.

### 3. Přímé odeslání do AI (API integrace)
**Problém:** Uživatel musí ručně kopírovat prompt a přepínat do jiné záložky.
**Řešení:** Přidat tlačítka "Otevřít v ChatGPT" / "Otevřít v Claude / "Otevřít v Gemini" - tyto otevřou nové okno s předvyplněným promptem (pomocí URL parametrů, kde to API umožňuje). Pro ChatGPT: `https://chat.openai.com/?q=...`, pro Claude: zatím jen copy + redirect. Podívej se, co je potřeba pro Gemini.

### 4. Export promptu do souboru
**Problém:** Prompt lze pouze kopírovat do schránky.
**Řešení:** Přidat možnost exportu jako:
- `.txt` soubor (pro archivaci)
- `.md` soubor (Markdown formát)
- `.pdf` soubor (profesionální výstup pro sdílení s kolegy/klienty)

### 5. Pole pro adresu/lokaci u všech typů + integrace mapy
**Problém:** U pozemků chybí explicitní pole pro přesnou adresu (jen parcelní číslo a katastrální území).
**Řešení:** Přidat textové pole "Adresa/Lokace" i pro pozemky. Volitelně: přidat mini-mapu (embed Google Maps/Mapy.cz) pro vizuální ověření lokality.

---

## B. UX/UI VYLEPŠENÍ (Střední dopad)

### 6. Progress bar místo kroků
**Problém:** Kroky indikátoru (1-4) jsou vizuálně statické – uživatel neví, kolik % je hotovo.
**Řešení:** Přidat plynulý progress bar nad/pod step indikátorem (25% → 50% → 75% → 100%).

### 7. Klikatelné step indikátory pro navigaci zpět
**Problém:** Uživatel se může vracet pouze tlačítkem "Zpět", ne kliknutím na konkrétní krok.
**Řešení:** Umožnit kliknutí na již navštívené kroky (1-3) pro přímou navigaci. Krok 4 (prompt) by zůstal dostupný pouze přes generování.

### 8. Náhled promptu v reálném čase (Live Preview)
**Problém:** Uživatel vidí výsledný prompt až na konci, v kroku 4.
**Řešení:** Přidat skládací panel "Náhled promptu" viditelný v krocích 2-3, který se aktualizuje v reálném čase podle vyplněných dat. Uživatel tak vidí, co se generuje.

### 9. Vylepšení mobilního zobrazení
**Problém:** Na mobilu jsou karty typů nemovitostí malé a step indikátor se nemusí vejít.
**Řešení:**
- Karty nemovitostí: swipeable carousel na mobilu
- Step indikátor: kompaktnější verze (jen čísla, bez textu)
- Lepší touch targets pro checkboxy

### 10. Tooltip nápovědy u formulářových polí
**Problém:** Některá pole (KZP, KPP, GDV, yield) mohou být nejasná i pro profesionály z jiných oborů.
**Řešení:** Přidat ikonku `(i)` u složitějších polí s tooltip vysvětlením. Např.: "KZP = Koeficient zastavěné plochy – udává maximální % plochy pozemku, které může být zastavěno."

---

## C. OBSAHOVÁ/ODBORNÁ VYLEPŠENÍ (Vysoký odborný dopad)

### 11. Nový typ nemovitosti: "Polyfunkční dům"
**Problém:** Chybí velmi běžný typ – budova kombinující bytové a komerční prostory.
**Řešení:** Přidat 5. typ s vlastními specifickými poli (% bytových vs. komerčních ploch, různé nájemné pro každý segment).

### 12. Nový typ nemovitosti: "Rekreační objekt / Chata"
**Problém:** Rekreační nemovitosti mají specifická rizika (sezónnost, přístup, les) a jinou metodiku.
**Řešení:** Přidat 6. typ s polemi pro sezónnost, vzdálenost od krajského města, přístup k vodě atd.

### 13. Konfigurovatelné bezpečnostní koeficienty
**Problém:** Koeficienty (80% byt, 70% dům, 60% pozemek, 65-75% komerční) jsou pevně zakódované v promptu.
**Řešení:** Přidat volitelné pole v kroku 3, kde uživatel může přepsat výchozí koeficienty podle interní politiky konkrétní banky/fondu.


### 14. Volba jazyka výstupu promptu
**Problém:** Prompt je generován výhradně v češtině.
**Řešení:** Přidat přepínač CZ/EN, aby prompt mohl být generován i v angličtině (pro mezinárodní investory nebo zahraniční banky).

---

## D. TECHNICKÁ VYLEPŠENÍ (Údržba a kvalita kódu)

### 15. Oprava bugu v copyPrompt()
**Problém:** Funkce `copyPrompt()` hledá element `.copy-btn`, ale tlačítko nemá tuto třídu – má jen `btn btn-primary`. Proto po úspěšném kopírování nevizuálně nepotvrdí akci.
**Řešení:** Přidat třídu `copy-btn` na tlačítko nebo použít `event.currentTarget`.

### 16. Oprava dvojitého toggle checkboxů
**Problém:** Funkce `toggleInput()` manuálně přepíná `checkbox.checked`, ale click na checkbox samotný jej už přepnul – vzniká dvojitý toggle (klik přímo na checkbox nefunguje správně).
**Řešení:** Přidat `event.preventDefault()` na checkbox nebo lépe refaktorovat logiku tak, aby click handler na kontejneru nevolal toggle znovu.

### 17. Validace vstupních dat
**Problém:** Čísla nejsou validována (záporné plochy, nereálné hodnoty). Obsazenost může být >100%.
**Řešení:** Přidat min/max atributy na inputy + JS validaci (plocha > 0, obsazenost 0-100, rok stavby 1800-2026).

### 18. Keyboard navigace a accessibility
**Problém:** Karty výběru typu nemovitosti nejsou přístupné z klávesnice (chybí `tabindex`, `role`, `aria-label`).
**Řešení:** Přidat ARIA atributy, tabindex, keyboard event handlery (Enter/Space pro výběr).

---

## Doporučený postup implementace

**Fáze 1 (Quick wins):** #16, #17, #18 (opravy bugů) + #6, #7, #10 (UX)
**Fáze 2 (High value):** #1, #2 (localStorage) + #4 (export)
**Fáze 3 (Premium features):** #8 (live preview) + #3 (API integrace) + #15 (jazyk)
**Fáze 4 (Rozšíření):** #11, #12 (nové typy) + #13 (konfigurovatelné koeficienty)

---

## Klíčové soubory k úpravě
- `/sessions/nice-gracious-knuth/mnt/Main-Project/real-estate-prompt-generator.html` – hlavní soubor aplikace (vše v jednom)
- `/sessions/nice-gracious-knuth/mnt/Main-Project/default-ai-prompt.md` – master prompt šablona
