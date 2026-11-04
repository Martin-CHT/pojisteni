# Srovnání a modelace životního pojištění — Insurance Terminal (v2026)

Komplexní webová aplikace pro finančního a pojistného poradce, která umožňuje **auditovat stávající pojistné smlouvy**, **namodelovat cílové zajištění rodiny i jednotlivce** podle metodiky EFPA ČR / ČNB (s výpočty dle legislativy 2026) a vytvořit **srozumitelný, jednoznačně identifikovatelný tiskový výstup pro klienta**.

---

## Klíčové funkce a novinky (v2026)

1. **Kompletní katalog 32 druhů životního a úrazového pojištění v ČR (členěný do 6 skupin rizik)**:
   - Zachovává 100% zpětnou kompatibilitu s původními 13 kategoriemi z Excelu `Vzor-2024.xlsm` a rozšiřuje je o všechna moderní připojištění českých pojišťoven:
     - **Skupina 1 — Smrt a zajištění závazků:** Smrt konstantní (`smrt`), Smrt klesající k úvěru (`smrtKles`), Smrt úrazem (`smrtUraz`), Smrt při autonehodě (`smrtAutonehoda`), Pozůstalostní renta (`rentaPozustali`).
     - **Skupina 2 — Invalidita a dlouhodobá péče (LTC):** Invalidita III. stupně (`invalidita`), Invalidita II. stupně (`inv2`), Invalidita I. stupně (`inv1`), Invalidita klesající k úvěru (`invKles`), Invalidní renta (`invRenta`), Dlouhodobá péče / Ztráta soběstačnosti II.–IV. st. (`dlouhodobaPece`), Zproštění od placení (`zprosteni`).
     - **Skupina 3 — Závažná onemocnění:** Závažná onemocnění konstantní (`zavOn`), ZO klesající (`zavOnKles`), Rakovina / Onko+ pro muže a ženy (`zavOnMuzZena`), Cukrovka a kardio komplikace (`cukrovkaKompl`), Trvalé následky nemoci / Dětská soběstačnost (`trvaleNasledkyNemoc`).
     - **Skupina 4 — Úraz a trvalé následky:** Trvalé následky úrazu od 0,01 % (`tnUraz`), TN úrazu od 10 % (`tnUraz10`), Denní odškodné úrazu DOÚ (`uraz`), Vážný úraz nad 28 dní (`urazVelky`), Zlomeniny a popáleniny (`zlomeninyPopaleniny`), Poškození horních končetin (`horniKoncetiny`).
     - **Skupina 5 — Pracovní neschopnost, OČR a hospitalizace:** PN od 15. dne (`pn15`), PN od 29. dne (`pn28`), PN od 61. dne (`pn61`), Ošetřování dítěte / člena rodiny OČR (`osetrovani`), Hospitalizace nemoc i úraz (`hosp`), Hospitalizace úrazem (`hospUraz`).
     - **Skupina 6 — Chirurgie, rekonvalescence a odpovědnost:** Chirurgický zákrok (`chir`), Poúrazová péče a rehabilitace (`rekonvalescence`), Občanská odpovědnost v ŽP (`odpovednostObc`).

2. **Jednoznačné rozhodovací štítky smluv dle doporučení poradce**:
   - U každé **stávající smlouvy** poradce určí doporučený krok a zdůvodnění:
     - `PONECHAT BEZE ZMĚNY` (např. kvůli zdravotní historii klienta před r. 2021),
     - `UPRAVIT / REDUKOVAT`,
     - `VYPOVĚDĚT / NAHRADIT` (až po přijetí nové smlouvy),
     - `SLOUČIT DO NOVÉ SMLOUVY`.
   - U každé **navrhované smlouvy** je zřejmé, zda jde o `NOVOU SMLOUVU`, `ZACHOVANOU STÁVAJÍCÍ`, `PO ÚPRAVĚ` nebo `ALTERNATIVU`.

3. **Interaktivní kalkulačka potřebného krytí (Needs & Gap Analysis — legislativa 2026)**:
   - Přesný výpočet **čisté mzdy (2026)**, **nemocenské ČSSZ** přes redukční hranice DVZ (`1 633 / 2 449 / 4 897 Kč`) a **státního invalidního důchodu I., II. a III. stupně** (základní výměra `4 900 Kč`, redukční hranice OVZ `21 546 / 195 868 Kč`).
   - Automatický výpočet doporučených pojistných částek pro každou osobu (dospělý / OSVČ / dítě) a možnost **jedním kliknutím propsat doporučené krytí do Návrhu smluv**.

4. **Daňový a benefitní kalkulátor (2026)**:
   - Modelace společného daňového odpočtu až **48 000 Kč/rok** (včetně daňově uznatelného pojištění dlouhodobé péče LTC III. a IV. st.) a příspěvku zaměstnavatele až **50 000 Kč/rok** → vyčíslení **skutečného čistého měsíčního nákladu klienta**.

5. **Simulátor progrese trvalých následků úrazu (100 % až 1000 %) & 5 předvoleb scénářů**:
   - Interaktivní posuvník rozsahu trvalých následků úrazu (5 % až 100 %) porovnávající výplatu ze stávajících smluv a z návrhu poradce.
   - Rychlé modelové scénáře: *Komplikovaná zlomenina*, *Vážná autonehoda s TN 50 %*, *Závažné onemocnění*, *Invalidita III. stupně*, *Ošetřování dítěte (OČR)*.

6. **Index kvality zajištění (0–100 %) & Radarový profil 5 pilířů**:
   - Okamžité skóre kvality portfolia (Stávající vs. Návrh poradce) a paprskový graf 5 pilířů pojistné ochrany.

7. **Katalog 13 českých životních pojišťoven (2026)**:
   - Přehled vlajkových produktů (*Kooperativa FLEXI, Allianz ŽIVOT, Generali ČP Můj život 2, UNIQA Život & Radost, NN Orange Risk, ČSOB Náš život, MetLife OneGuard, Simplea 2.0, KB MojeJistota, ČPP NEON, Pillow Život, YOUPLUS 4U, Maxima/Direct*), jejich progrese TN, silných a slabých stránek.

8. **Klientská tisková sestava (`soubory/tisk.html`)**:
   - Jasná identifikace poradce (Jméno, Společnost, IČO, Telefon, E-mail, ID modelace, Logo) a **Stanovisko finančního poradce** na titulní straně.
   - **Rozcestník smluv** (barevné odlišení co ponechat, co vypovědět a co nově sjednat) a **Přehled hlavních pilířů po jednotlivých osobách**.
   - **Chytré filtrování sloupců** (tisk pouze aktivních/sjednaných rizik pro maximální čitelnost bez desítek prázdných sloupců, s možností přepnutí na všech 32 rizik).
   - **Bezpečný 4krokový harmonogram realizace změn** (ochrana před čekací dobou) a podpisový blok k Záznamu z jednání (§ 79 zákona č. 170/2018 Sb.).
