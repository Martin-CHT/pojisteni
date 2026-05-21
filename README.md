# Srovnání pojištění — Insurance Terminal

Webová aplikace pro investičního poradce, která **plně nahrazuje Excel `Vzor-2024.xlsm`** a jde výrazně dál. Umožňuje rychle a přehledně:

- evidovat **celou rodinu** klienta (každá osoba má vlastní příjem, OSVČ status, rok narození);
- katalogizovat **stávající pojistné smlouvy** s detailem všech 13 pojistných kategorií;
- sestavit **návrh nového portfolia** a srovnat ho s aktuálním stavem položku po položce;
- evidovat **úvěry a závazky** a hlídat podpojištění / přepojištění;
- simulovat **modelové scénáře plnění** (PN, hospitalizace, úraz, chirurgie) na stávajícím i navrženém portfoliu;
- volat **Groq AI** pro odborné posouzení portfolia (5 přednastavených úkolů + vlastní dotaz);
- tisknout **profesionální 5stránkovou sestavu pro klienta** s podpisovým blokem.

## Spuštění

```text
Otevřete v prohlížeči: index.html
```

Veškerá data jsou ukládána pouze do `localStorage` Vašeho prohlížeče (klíč `insurance_compare_data`). Aplikace běží offline kromě:
- volání Groq API (volitelné, pouze po nastavení klíče),
- CDN pro Tailwind / Chart.js / Lucide ikony.

## Struktura souborů

```
srovnání pojištění/
├── index.html               ← hlavní aplikace (vstupní bod)
├── README.md                ← tento soubor
└── soubory/                ← složka s ostatními soubory (POZOR: malé "s" — GitHub Pages je case-sensitive)
    ├── style.css            ← design v duchu Finance Terminalu (tmavé/světlé téma)
    ├── insurance-data.js    ← pojistné kategorie, sazby ČSSZ, pojišťovny, právní rámec, ukázková data
    ├── insurance-app.js     ← hlavní aplikační logika
    └── tisk.html            ← profesionální tisková sestava (otevírá se v novém okně)
```

## Mapování na původní Excel `Vzor-2024.xlsm`

| List v Excelu                  | Modul aplikace                                  |
|--------------------------------|-------------------------------------------------|
| `List0` (rodina Hozna)         | Klienti + Stávající smlouvy + Návrh + Úvěry     |
| `Návrh` (abstrahovaný klient)  | Stejný datový model, jen bez napevno vázané rodiny |
| `Součty - k tisku`             | `soubory/tisk.html` (5 stran A4)                |
| `Tabulka1` (existing)          | `state.currentContracts`                        |
| `Tabulka2` (proposed)          | `state.proposedContracts`                       |
| Vzorce `SUMIF` po klientech    | Funkce `sumItemFor()` v `insurance-app.js`      |
| Vzorce sazeb ČSSZ              | `D.SICKLEAVE_BRACKETS` v `insurance-data.js`    |
| Scénář PN/hospitalizace        | Záložka „Scénáře plnění"                        |

## 13 pojistných kategorií (sloupce z Tabulky1/Tabulky2)

| Klíč        | Český název                  | Typ            |
|-------------|------------------------------|----------------|
| smrt        | Smrt                         | částka         |
| smrtUraz    | Smrt úrazem                  | částka         |
| invalidita  | Invalidita                   | částka         |
| zavOn       | Závažné onemocnění           | částka         |
| tnUraz      | Trvalé následky úrazu        | částka         |
| tnUraz10    | TN úrazu od 10 %             | částka         |
| uraz        | Drobný úraz                  | denní dávka    |
| urazVelky   | Vážný úraz                   | denní dávka    |
| hosp        | Hospitalizace                | denní dávka    |
| hospUraz    | Hospitalizace úrazem         | denní dávka    |
| pn28        | PN od 28. dne                | denní dávka    |
| pn61        | PN od 61. dne                | denní dávka    |
| chir        | Chirurgický zákrok           | částka         |

## Výpočetní jádro

- **Sazby nemocenské ČSSZ** podle pásem z Excelu (1–49 k = 64 %, …, 120 k+ = 36 %), strop 48 000 Kč/měs.
- **Pojistné plnění při PN**: rozlišení standardního plnění (od 29. dne) a klauzule „zpětně od 1. dne".
- **Doporučené krytí smrti**: závazky × 1,15 (15% rezerva pro pozůstalé).
- **Doporučené krytí invalidity**: minimum 50–80 % výše úvěrů.
- **Cílový čistý měsíční příjem v PN** ≈ 75 % hrubého (orientačně).
- **Frekvence placení**: měsíční / čtvrtletní (×4) / roční (×12) / jednorázové (0).

## AI integrace (Groq)

5 přednastavených úkolů + vlastní dotaz:

1. **Celkové vyhodnocení portfolia** — vhodnost návrhu vůči zadání, slabiny, doporučení.
2. **Podpojištění / přepojištění** — mezery v krytí podle závazků a příjmu.
3. **Analýza podmínek smluv** — klauzule PN, čekací doby, rizikové kategorie.
4. **Cost-benefit** — cena za jednotku krytí, návratnost.
5. **Soulad se zákonem** — § 79 zákona 170/2018, doporučení ČNB, daňové výhody, churning.

AI dostává **kompletní portfolio jako strukturovaný JSON** a kontext zadání poradce. Klíč nastavte v záložce **Nastavení** (sdíleno s Finance Terminalem přes `groq_api_key` v `localStorage` / cookie).

**Hromadný vstup** (záložka Stávající / Návrh → tlačítko „Hromadný vstup") — vložte text z e-mailu/PDF nabídky pojišťovny a AI ho rozparsuje na strukturované smlouvy.

## Tiskový výstup

Tlačítko **Tisk** v hlavičce otevře `soubory/tisk.html` v novém okně — 5stránková A4 sestava:

1. **Titulní strana** — souhrn KPI, závazky, pojištěné osoby, zadání poradce.
2. **Stávající portfolio** — přehled všech smluv po osobách.
3. **Navrhované portfolio** — totéž pro návrh.
4. **Srovnání** — položková tabulka + modelový scénář plnění.
5. **Závěry a doporučení** — automaticky generovaná zjištění + podpisový blok.

Sestava je responzivně optimalizovaná i pro tisk → PDF (`@page A4, 14mm`).

## Právní rámec (zabudováno)

Záložka **Právní rámec** obsahuje 8 bloků s aktuálním shrnutím:

- Zákon č. 170/2018 Sb. — distribuce pojištění (§ 79 záznam, vhodnost, IPID, storno provize)
- Zákon č. 277/2009 Sb. — o pojišťovnictví (Solvency II, garanční fondy)
- Občanský zákoník §§ 2756–2872 — pojistná smlouva (odstoupení do 14/30 dnů, výpověď, krácení plnění)
- Čekací doby a karenční doby (běžná praxe ČR 2024)
- Klauzule „PN zpětně od 1. dne" (Simplea / Uniqa Volba / Allianz RYTMUS)
- Daňové výhody § 6 + § 15 ZDP (odečet 48 000 Kč)
- Doporučení ČNB pro distribuci (zákaz churning)
- Postup při pojistné události (lhůty, šetření, promlčecí lhůta)

## Návrhy na rozšíření

- **Import z PDF** — drag & drop PDF nabídky → AI parsování (částečně implementováno přes „Hromadný vstup").
- **Cloud sync přes Finance Terminal** — sdílet `insurance_compare_data` přes existující Apps Script backend.
- **Generování návrhu smlouvy** pro konkrétní pojišťovnu na základě cílů klienta (AI).
- **Karenční / čekací doby dynamicky podle data počátku** — kontrola, zda už platí plnění.
- **Statistika napříč klienty** — pokud poradce eviduje více klientů (multi-klientský režim).
- **Notifikace o blížícím se konci smluv** (pole `end`).
- **PDF export přes server-side** (puppeteer) pro pixel-perfect výstup bez print dialogu prohlížeče.
- **Více tisku variant**: ultra-stručná verze (1 strana), poradenský detail (10+ stran).
- **Integrace s CRM** — odeslání portfolia do interního systému.

## Poznámky k přesnosti

- Sazby nemocenské, čekací doby a OP pojišťoven jsou **informativní** podle veřejných zdrojů 2024. Pro závazný výpočet vždy konzultujte aktuální OP konkrétní pojišťovny a kalkulačku ČSSZ.
- AI odpovědi jsou **návrhy poradci**, nikoli závazná pojistná doporučení. Konečné rozhodnutí leží na poradci a klientovi.
- Aplikace neukládá data nikam mimo Váš prohlížeč. Při změně PC použijte **Export → Import JSON**.
