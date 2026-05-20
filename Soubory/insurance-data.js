/* ════════════════════════════════════════════════════════════════════
   insurance-data.js
   Statická data: pojistné kategorie, sazby ČSSZ, pojišťovny, právní rámec.
   ════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────────
   POJISTNÉ KATEGORIE
   Přesně podle struktury Vzor-2024.xlsm — sloupce v Tabulce1/Tabulce2.
   Pole `kind` určuje, jak se hodnota interpretuje:
     - 'sum'   = jednorázová pojistná částka (Kč)
     - 'daily' = denní dávka v případě události (Kč/den)
   Pole `purpose` shrnuje, čemu plnění slouží — pomáhá pro automatické
   posuzování duplicit a podpojištění.
   ───────────────────────────────────────────────────────────────── */
const INSURANCE_CATEGORIES = [
    { key: 'smrt',         label: 'Smrt',             short: 'Smrt',  mini: 'S',    kind: 'sum',   purpose: 'survivors',     icon: 'cross',       color: 'rose',
      help: 'Pojistná částka vyplácená oprávněné osobě v případě úmrtí pojištěného. Hlavní krytí úvěrů a zajištění rodiny.' },
    { key: 'smrtUraz',     label: 'Smrt úrazem',      short: 'Smrt Ú', mini: 'SÚ',  kind: 'sum',   purpose: 'survivors',     icon: 'cross',       color: 'rose',
      help: 'Doplňková jednorázová částka navíc, pokud smrt nastala následkem úrazu.' },
    { key: 'invalidita',   label: 'Invalidita',       short: 'Inv.',  mini: 'Inv',  kind: 'sum',   purpose: 'survivors',     icon: 'accessibility', color: 'amber',
      help: 'Jednorázové plnění při přiznání invalidity (II. nebo III. stupně dle ČSSZ). Často klíčové pro splacení hypotéky.' },
    { key: 'zavOn',        label: 'Závažné onemocnění', short: 'ZO',  mini: 'ZO',   kind: 'sum',   purpose: 'criticalIllness', icon: 'heart-pulse', color: 'violet',
      help: 'Jednorázové plnění při diagnostice některé z definovaných závažných diagnóz (infarkt, mrtvice, rakovina…). Seznam diagnóz je v OP, liší se mezi pojišťovnami.' },
    { key: 'tnUraz',       label: 'Trvalé následky úrazu', short: 'TN', mini: 'TN', kind: 'sum',   purpose: 'permanentInjury', icon: 'bandage',     color: 'orange',
      help: 'Pojistná částka násobená procentem trvalých následků (např. 30 % poškození = 30 % částky). Vyšší progresivita u premium variant.' },
    { key: 'tnUraz10',     label: 'TN úrazu od 10 %', short: 'TN10 %', mini: 'TN%', kind: 'sum',   purpose: 'permanentInjury', icon: 'bandage',     color: 'orange',
      help: 'Snížený práh plnění (od 10 %) – plní se i menší trvalé následky úrazu.' },
    { key: 'uraz',         label: 'Drobný úraz (denní)',  short: 'Úraz', mini: 'ÚD',kind: 'daily', purpose: 'dailyAccident', icon: 'sticker',     color: 'emerald',
      help: 'Denní dávka po dobu léčení úrazu dle oceňovací tabulky pojišťovny. Plnění bývá omezeno (např. 365 dní/úraz).' },
    { key: 'urazVelky',    label: 'Vážný úraz (denní)',   short: 'Úr.V', mini: 'ÚV',kind: 'daily', purpose: 'dailyAccident', icon: 'sticker',     color: 'emerald',
      help: 'Zvýšená denní dávka pro vážnější úrazy (typicky od 30. dne léčení, dle tabulky).' },
    { key: 'hosp',         label: 'Hospitalizace (denní)', short: 'Hosp.', mini: 'H', kind: 'daily', purpose: 'hospital',  icon: 'hospital',    color: 'sky',
      help: 'Denní dávka za každý den hospitalizace v nemocnici (nemoc i úraz).' },
    { key: 'hospUraz',     label: 'Hospitalizace úraz (denní)', short: 'Hosp.Ú', mini: 'HÚ', kind: 'daily', purpose: 'hospital', icon: 'hospital', color: 'sky',
      help: 'Vyšší denní dávka pouze pro hospitalizaci v důsledku úrazu.' },
    { key: 'pn28',         label: 'PN od 28. dne (denní)', short: 'PN 28', mini: 'PN28', kind: 'daily', purpose: 'incomeLoss', icon: 'wallet',  color: 'fuchsia',
      help: 'Denní dávka za pracovní neschopnost od 28. dne (případně zpětně od 1. dne dle klauzule). Sjednává se vždy pro konkrétní povolání.' },
    { key: 'pn61',         label: 'PN od 61. dne (denní)', short: 'PN 61', mini: 'PN61', kind: 'daily', purpose: 'incomeLoss', icon: 'wallet',  color: 'fuchsia',
      help: 'Vyšší denní dávka pro dlouhodobou PN od 61. dne (případně zpětně). Doplněk PN 28.' },
    { key: 'chir',         label: 'Chirurgický zákrok', short: 'Chir.', mini: 'Ch', kind: 'sum',   purpose: 'surgery',       icon: 'syringe',  color: 'teal',
      help: 'Jednorázová částka dle bodů přidělených zákroku v tabulce pojišťovny. Limit obvykle 30 000–100 000 Kč.' }
];

/* Mapa key → kategorie pro rychlý lookup */
const CATEGORY_BY_KEY = Object.fromEntries(INSURANCE_CATEGORIES.map(c => [c.key, c]));

/* ─────────────────────────────────────────────────────────────────
   NEMOCENSKÁ — sazby ČSSZ (zaměstnanec, % z denního vyměřovacího základu po redukci)
   Zjednodušeno do pásem podle Excelu – odpovídá efektivní sazbě k hrubé mzdě.
   Pro plnohodnotný výpočet podle redukčních hranic doporučujeme oficiální
   kalkulačku ČSSZ; tato čísla jsou shodná s tabulkou v Excelu Vzor-2024.
   ───────────────────────────────────────────────────────────────── */
const SICKLEAVE_BRACKETS = [
    { min:      0, max:  49000, rate: 0.64 },
    { min:  50000, max:  59000, rate: 0.60 },
    { min:  60000, max:  69000, rate: 0.56 },
    { min:  70000, max:  79000, rate: 0.52 },
    { min:  80000, max:  89000, rate: 0.48 },
    { min:  90000, max:  99000, rate: 0.45 },
    { min: 100000, max: 109000, rate: 0.43 },
    { min: 110000, max: 119000, rate: 0.41 },
    { min: 120000, max: Infinity, rate: 0.36 }
];
function sickLeaveRate(grossMonthly) {
    if (!grossMonthly || grossMonthly <= 0) return 0;
    const b = SICKLEAVE_BRACKETS.find(b => grossMonthly >= b.min && grossMonthly <= b.max);
    return b ? b.rate : 0.36;
}
/* Pro hrubou mzdu nad 120 000 platí v Excelu pevný měsíční strop ~48 000 (redukce). */
const SICKLEAVE_CAP = 48000;

/* ─────────────────────────────────────────────────────────────────
   POJIŠŤOVNY — základní karty pro našeptávání + standardní podmínky
   Pole `defaultConditions` se předvyplňuje při výběru pojišťovny.
   Hodnoty jsou orientační, vychází z aktuálních veřejných OP (2023–2024)
   – pro konkrétní smlouvu vždy ověřte v platných OP dané pojišťovny.
   ───────────────────────────────────────────────────────────────── */
const INSURERS = [
    {
        name: 'Kooperativa', short: 'KOOP',
        productLine: 'Život PERSPEKTIVA / NA PŘÁNÍ',
        defaultConditions: {
            pnWaitingDays: 29,
            pnRetroactive: false,
            hospWaitingDays: 0,
            criticalIllnessWaitingMonths: 3,
            suicideExclusionYears: 2,
            occupationCategories: '1–4 (manuální / TH)',
            paymentFrequency: 'monthly'
        },
        notes: 'Klasický český produkt Život PERSPEKTIVA / NA PŘÁNÍ. Plnění PN obvykle od 29. dne (lze sjednat od 15., 22. nebo zpětně od 1. dne za příplatek).'
    },
    {
        name: 'Allianz', short: 'ALZ',
        productLine: 'Život / RYTMUS',
        defaultConditions: {
            pnWaitingDays: 29,
            pnRetroactive: false,
            hospWaitingDays: 0,
            criticalIllnessWaitingMonths: 3,
            suicideExclusionYears: 2,
            occupationCategories: '1–4',
            paymentFrequency: 'monthly'
        },
        notes: 'Allianz RYTMUS s investiční složkou. Široká nabídka připojištění, vč. PN zpětně od 1. dne (extra příplatek).'
    },
    {
        name: 'Generali Česká pojišťovna', short: 'GČP',
        productLine: 'BĚŽNÝ ŽIVOT / MultiRisk',
        defaultConditions: {
            pnWaitingDays: 29,
            pnRetroactive: false,
            hospWaitingDays: 0,
            criticalIllnessWaitingMonths: 3,
            suicideExclusionYears: 2,
            occupationCategories: '1–5',
            paymentFrequency: 'monthly'
        },
        notes: 'Vznikla sloučením Generali a České pojišťovny (2019). Velký detail v ocenění úrazu, progresivita TN až 500 %.'
    },
    {
        name: 'ČSOB Pojišťovna', short: 'ČSOB',
        productLine: 'FORTE / Život',
        defaultConditions: {
            pnWaitingDays: 29,
            pnRetroactive: false,
            hospWaitingDays: 0,
            criticalIllnessWaitingMonths: 3,
            suicideExclusionYears: 2,
            occupationCategories: '1–4',
            paymentFrequency: 'monthly'
        },
        notes: 'Klasický bankopojišťovací produkt, často sjednán k hypotékám ČSOB / ČMSS. Připojištění úvěru obvykle přímo v balíčku.'
    },
    {
        name: 'NN Životní pojišťovna', short: 'NN',
        productLine: 'NN Život',
        defaultConditions: {
            pnWaitingDays: 29,
            pnRetroactive: false,
            hospWaitingDays: 0,
            criticalIllnessWaitingMonths: 3,
            suicideExclusionYears: 2,
            occupationCategories: '1–4',
            paymentFrequency: 'monthly'
        },
        notes: 'NN (dříve ING) — rizikové připojištění s velmi propracovanou tabulkou diagnóz závažných onemocnění.'
    },
    {
        name: 'Uniqa', short: 'UNI',
        productLine: 'Life Volba / Domov',
        defaultConditions: {
            pnWaitingDays: 29,
            pnRetroactive: false,
            hospWaitingDays: 0,
            criticalIllnessWaitingMonths: 3,
            suicideExclusionYears: 2,
            occupationCategories: '1–4',
            paymentFrequency: 'monthly'
        },
        notes: 'Uniqa (sloučení s Axou v ČR). Život Volba — modulární produkt, velmi flexibilní limity. PN zpětně od 1. dne za příplatek.'
    },
    {
        name: 'Komerční pojišťovna', short: 'KP',
        productLine: 'Vital Premium',
        defaultConditions: {
            pnWaitingDays: 29,
            pnRetroactive: false,
            hospWaitingDays: 0,
            criticalIllnessWaitingMonths: 3,
            suicideExclusionYears: 2,
            occupationCategories: '1–4',
            paymentFrequency: 'monthly'
        },
        notes: 'KB Pojišťovna (skupina Société Générale). Často nabízeno k úvěrům KB.'
    },
    {
        name: 'Simplea', short: 'SIM',
        productLine: 'Život Simplea',
        defaultConditions: {
            pnWaitingDays: 29,
            pnRetroactive: false,
            hospWaitingDays: 0,
            criticalIllnessWaitingMonths: 3,
            suicideExclusionYears: 2,
            occupationCategories: '1–4',
            paymentFrequency: 'monthly'
        },
        notes: 'Simplea (Partners) — moderní transparentní produkt. PN zpětně od 1. dne často jako standard ve vyšších variantách.'
    },
    {
        name: 'MetLife', short: 'MET',
        productLine: 'Garde',
        defaultConditions: {
            pnWaitingDays: 29,
            pnRetroactive: false,
            hospWaitingDays: 0,
            criticalIllnessWaitingMonths: 3,
            suicideExclusionYears: 2,
            occupationCategories: '1–4',
            paymentFrequency: 'monthly'
        },
        notes: 'MetLife (dnes pod NN). Klasický rizikový životko s propracovanými diagnózami.'
    }
];

const INSURER_NAMES = INSURERS.map(i => i.name);

/* ─────────────────────────────────────────────────────────────────
   PRÁVNÍ RÁMEC — informativní přehled k zobrazení v záložce „Právní rámec".
   Zdroje: zákon č. 277/2009 Sb. o pojišťovnictví, zákon č. 170/2018 Sb.
   o distribuci pojištění a zajištění, občanský zákoník (§§ 2756 a násl.),
   doporučení ČNB, ČAP (Česká asociace pojišťoven).
   ───────────────────────────────────────────────────────────────── */
const LEGAL_FRAMEWORK = [
    {
        title: 'Zákon č. 170/2018 Sb. — distribuce pojištění',
        body: `<p>Klíčový zákon pro práci investičního poradce / pojišťovacího zprostředkovatele. Stanovuje povinnosti:</p>
        <ul>
            <li><strong>Záznam z jednání</strong> — povinný dokument zachycující požadavky a potřeby klienta, doporučení a důvody (§ 79).</li>
            <li><strong>Posouzení vhodnosti</strong> — produkt musí odpovídat zjištěným potřebám a finanční situaci klienta.</li>
            <li><strong>Informační povinnost</strong> — IPID (klíčové informace), pojistné podmínky, výše provize na vyžádání.</li>
            <li><strong>Odbornost</strong> — odborná zkouška ČNB, průběžné vzdělávání 15 hodin ročně.</li>
            <li><strong>Storno provize</strong> — pojišťovna vrací provizi v případě zániku do 60 měsíců (§ 88).</li>
        </ul>`
    },
    {
        title: 'Zákon č. 277/2009 Sb. — o pojišťovnictví',
        body: `<p>Stanovuje pravidla pro pojišťovny: kapitálová přiměřenost (Solvency II), tvorba rezerv, dohled ČNB. Pro klienta zásadní:</p>
        <ul>
            <li><strong>Garanční fond ČKP</strong> — kryje povinné ručení do plné výše i v případě úpadku pojišťovny.</li>
            <li><strong>Životní pojištění není pojištěno garančním systémem</strong> jako u bank (FPV). V případě úpadku životní pojišťovny se postupuje dle § 105 — likvidace s prioritou pojistníků.</li>
            <li><strong>Povinné minimální rezervy</strong> — 100 % matematických rezerv musí být kryto aktivy.</li>
        </ul>`
    },
    {
        title: 'Občanský zákoník §§ 2756–2872 — pojistná smlouva',
        body: `<p>Hmotněprávní úprava pojistné smlouvy:</p>
        <ul>
            <li><strong>§ 2789 — odstoupení do 14 dní</strong> od uzavření smlouvy bez udání důvodu (životní pojištění → 30 dní).</li>
            <li><strong>§ 2807 — výpověď ke konci pojistného období</strong> (s 6týdenním předstihem).</li>
            <li><strong>§ 2808 — výpověď do 3 měsíců od pojistné události</strong> (pojistník i pojišťovna).</li>
            <li><strong>§ 2810 — důsledky porušení informační povinnosti</strong> — krácení plnění až o 50 % při zamlčení.</li>
            <li><strong>§ 2849 — pojištění pro případ úrazu</strong> — pojistitel nehradí škodu způsobenou pojištěným úmyslně.</li>
        </ul>`
    },
    {
        title: 'Čekací doby a karenční doby',
        body: `<p>Standardní praxe v ČR (rok 2024):</p>
        <ul>
            <li><strong>Smrt z nemoci</strong> — bez čekací doby (pouze sebevražda obvykle 2 roky).</li>
            <li><strong>Smrt úrazem</strong> — bez čekací doby.</li>
            <li><strong>Závažná onemocnění</strong> — čekací doba 3 měsíce (rakovina často 6 měsíců, neuro 12 měsíců).</li>
            <li><strong>Invalidita</strong> — bez čekací doby pro úraz, 3 měsíce pro nemoc, 24 měsíců pro psychické dg.</li>
            <li><strong>PN</strong> — 2 měsíce karenční doba od počátku smlouvy; následně plní od 29. dne (nebo zpětně dle klauzule).</li>
            <li><strong>Hospitalizace</strong> — obvykle 2 měsíce karenční doba, plnění od 1. dne.</li>
            <li><strong>Chirurgický zákrok</strong> — 2–3 měsíce karence pro plánované zákroky.</li>
        </ul>`
    },
    {
        title: 'Klauzule "PN zpětně od 1. dne"',
        body: `<p>Rozšířená klauzule, kterou nabízí všechny TOP pojišťovny (za příplatek 15–30 % k základní sazbě PN):</p>
        <ul>
            <li>Při PN trvající <strong>déle než 29 dní</strong> pojišťovna doplatí plnění <strong>i za prvních 28 dní</strong>.</li>
            <li>Některé produkty (Simplea, Uniqa Volba) nabízejí variantu „od 15. dne" nebo „od 22. dne" jako kompromis.</li>
            <li>Pro OSVČ je tato klauzule téměř nezbytná, protože nemají nárok na nemocenskou ČSSZ (pokud si ji dobrovolně neplatí).</li>
        </ul>`
    },
    {
        title: 'Daňové výhody (§ 6 odst. 9 písm. p), § 15 zákona o daních z příjmů)',
        body: `<p>Soukromé životní pojištění splňující daňové podmínky:</p>
        <ul>
            <li><strong>Klient</strong> — odečet od základu daně až <strong>48 000 Kč ročně</strong> (do roku 2023 bylo 24 000 Kč).</li>
            <li><strong>Zaměstnavatel</strong> — příspěvek až 50 000 Kč ročně osvobozen od daně i odvodů.</li>
            <li>Podmínka: výplata nejdříve v 60 letech a po 60 měsících od počátku.</li>
            <li>Daňová podpora se NEvztahuje na rizikové pojistky bez kapitálové složky.</li>
        </ul>`
    },
    {
        title: 'Doporučení ČNB pro distribuci',
        body: `<p>Aktuální best-practice dohledu ČNB (Úřední sdělení 2023):</p>
        <ul>
            <li><strong>Nedostatečné krytí úvěrů</strong> — pojistná částka pro případ smrti musí pokrýt minimálně zbývající jistinu úvěru.</li>
            <li><strong>Přepojištění</strong> — kontrola, zda klient nemá duplicitní pojistky (typicky při sloučených bance + zprostředkovateli).</li>
            <li><strong>Test vhodnosti</strong> — věk, příjem, závazky, počet závislých osob, rizika z povolání, hobby.</li>
            <li><strong>Zákaz nevýhodné výměny smlouvy</strong> (tzv. churning) — výměna životka jen pokud má pro klienta prokazatelný benefit.</li>
        </ul>`
    },
    {
        title: 'Postup při pojistné události',
        body: `<p>Klíčové lhůty z OP a OZ:</p>
        <ul>
            <li><strong>Oznámení</strong> — bez zbytečného odkladu (obvykle 5–15 dní dle OP).</li>
            <li><strong>Šetření</strong> — pojišťovna má 3 měsíce na ukončení šetření (§ 2798 OZ).</li>
            <li><strong>Výplata</strong> — do 15 dnů od ukončení šetření.</li>
            <li><strong>Promlčecí lhůta</strong> — 3 roky (smrt 10 let) od pojistné události (§ 626 OZ).</li>
            <li><strong>Stížnost</strong> — interně u pojišťovny → ČNB → finanční arbitr → soud.</li>
        </ul>`
    }
];

/* ─────────────────────────────────────────────────────────────────
   PŘÍKLAD DAT (z Excel List0) — pro „Načíst ukázku"
   ───────────────────────────────────────────────────────────────── */
const SAMPLE_DATA = {
    clients: [
        { id: 'c1', name: 'Hozna (pán)',  incomeGross: 65000, isEntrepreneur: false, birthYear: 1985 },
        { id: 'c2', name: 'Martina',      incomeGross: 35000, isEntrepreneur: false, birthYear: 1987 },
        { id: 'c3', name: 'Vilém (syn)',  incomeGross: 0,     isEntrepreneur: false, birthYear: 2018 },
        { id: 'c4', name: 'Tobiáš (syn)', incomeGross: 0,     isEntrepreneur: false, birthYear: 2020 }
    ],
    currentContracts: [
        { id: 's1', clientId: 'c1', insurer: 'ČSOB Pojišťovna', contractNo: '1317491203', start: 2019, end: 2053, premium: 777,
          items: { smrt: 10000, zavOn: 500000 } },
        { id: 's2', clientId: 'c1', insurer: 'ČSOB Pojišťovna', contractNo: '1307186251', start: 2015, end: 2058, premium: 409,
          items: { smrt: 10000, smrtUraz: 500000, uraz: 300, hosp: 500 } },
        { id: 's3', clientId: 'c1', insurer: 'ČSOB Pojišťovna', contractNo: '3117104', start: null, end: null, premium: 100,
          items: { smrt: 100000 } },
        { id: 's4', clientId: 'c1', insurer: 'ČSOB Pojišťovna', contractNo: '1105984739', start: 2013, end: 2058, premium: 156,
          items: { smrtUraz: 200000, tnUraz: 200000, uraz: 100 } },
        { id: 's5', clientId: 'c3', insurer: 'ČSOB Pojišťovna', contractNo: '1317491203', start: 2019, end: 2053, premium: 0,
          items: { zavOn: 500000, tnUraz: 1000000, uraz: 500, hosp: 500 } },
        { id: 's6', clientId: 'c4', insurer: 'ČSOB Pojišťovna', contractNo: '1317491203', start: 2019, end: 2053, premium: 777,
          items: { zavOn: 500000, tnUraz: 1000000, uraz: 500, hosp: 500 } },
        { id: 's7', clientId: 'c2', insurer: 'ČSOB Pojišťovna', contractNo: '1307186262', start: 2015, end: 2060, premium: 407,
          items: { smrt: 10000, smrtUraz: 500000, uraz: 300, hosp: 500 } },
        { id: 's8', clientId: 'c2', insurer: 'Kooperativa', contractNo: '1420482462', start: 2009, end: 2050, premium: 500,
          items: { smrt: 200000, invalidita: 24000, zavOn: 50000, tnUraz: 200000, uraz: 100, hosp: 200 } }
    ],
    proposedContracts: [
        { id: 'n1', clientId: 'c1', insurer: 'ČSOB Pojišťovna', contractNo: '1317491203', start: 2019, end: 2053, premium: 777,
          items: { smrt: 10000, zavOn: 500000 }, note: 'Zachováno – problémy se srdcem 2021' },
        { id: 'n2', clientId: 'c1', insurer: 'ČSOB Pojišťovna', contractNo: '3117104', start: null, end: null, premium: 100,
          items: { smrt: 100000 }, note: 'Zachováno' },
        { id: 'n3', clientId: 'c1', insurer: 'Uniqa', contractNo: 'NEW-2023-001', start: 2023, end: null, premium: 0,
          items: { smrt: 6000000, smrtUraz: 3000000, invalidita: 3000000, tnUraz: 1000000, tnUraz10: 1000000, uraz: 200, urazVelky: 400, hosp: 500, pn61: 500, chir: 30000 },
          note: 'Nová hlavní pojistka – krytí nového úvěru' },
        { id: 'n4', clientId: 'c3', insurer: 'Uniqa', contractNo: 'NEW-2023-002', start: 2023, end: null, premium: 0,
          items: { invalidita: 1000000, zavOn: 500000, tnUraz: 1000000, uraz: 500, hosp: 500 } },
        { id: 'n5', clientId: 'c2', insurer: 'Uniqa', contractNo: 'NEW-2023-003', start: 2023, end: null, premium: 3159,
          items: { smrt: 3200000, invalidita: 3000000, zavOn: 500000, tnUraz: 500000, tnUraz10: 1000000, uraz: 200, urazVelky: 300, hosp: 500, chir: 30000 } }
    ],
    loans: [
        { id: 'l1', name: 'ČMSS – stávající hypotéka 1', amount: 450000, linkedClientId: 'c1' },
        { id: 'l2', name: 'ČMSS – stávající hypotéka 2', amount: 450000, linkedClientId: 'c1' },
        { id: 'l3', name: 'Nová hypotéka',                amount: 2500000, linkedClientId: 'c1' },
        { id: 'l4', name: 'Půjčka od rodičů',             amount: 2500000, linkedClientId: 'c1' }
    ],
    scenario: { person: 'c1', pnDays: 90, hospDays: 5, injury: 'minor', retroactive: false },
    adviserBrief: 'Pokud platíme cca 2 200 Kč dnes a nejsme kryti na úvěry, jsme ochotni platit max. o 2-3 000 měsíčně navíc. Chceme být ale krytí na nový úvěr ve výši cca 5 000 000 (hypotéka a úvěr od rodičů), zároveň na stávající úvěr, krytí vážných úrazů, pracovní neschopnosti, dlouhodobé ztráty příjmů. Pokud možno nesahat na smlouvy, kde je pán pojištěn na vážná rizika před rokem 2021 z důvodů problémů se srdcem.'
};

/* Vystavíme do window pro insurance-app.js */
window.INSURANCE_DATA = {
    CATEGORIES: INSURANCE_CATEGORIES,
    CATEGORY_BY_KEY,
    SICKLEAVE_BRACKETS,
    SICKLEAVE_CAP,
    sickLeaveRate,
    INSURERS,
    INSURER_NAMES,
    LEGAL_FRAMEWORK,
    SAMPLE_DATA
};
