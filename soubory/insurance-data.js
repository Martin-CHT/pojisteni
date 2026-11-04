/* ════════════════════════════════════════════════════════════════════
   insurance-data.js
   Statická data a výpočetní konstanty (2026):
   - Skupiny rizik a 32 pojistných kategorií českých pojišťoven
   - Přesné výpočty nemocenské ČSSZ, invalidních důchodů a čisté mzdy (2026)
   - Katalog 13 českých životních pojišťoven, produktů a podmínek
   - Rozšířený právní rámec (zákon č. 170/2018 Sb., OZ, daňové odpočty, DIP/LTC)
   - Ukázková data rodiny s doporučeními poradce
   ════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────────
   SKUPINY POJISTNÝCH RIZIK (pro přehledné členění v UI i tisku)
   ───────────────────────────────────────────────────────────────── */
const CATEGORY_GROUPS = [
    { key: 'death',      label: 'Smrt a zajištění závazků / rodiny',       short: 'Smrt & Úvěry',     color: 'rose',    icon: 'shield-alert' },
    { key: 'disability', label: 'Invalidita a dlouhodobá péče (LTC)',      short: 'Invalidita & LTC', color: 'amber',   icon: 'accessibility' },
    { key: 'illness',    label: 'Závažná onemocnění a diagnózy',           short: 'Závažné nemoci',   color: 'violet',  icon: 'heart-pulse' },
    { key: 'accident',   label: 'Úraz a trvalé následky úrazu',            short: 'Úraz & TN',        color: 'orange',  icon: 'bandage' },
    { key: 'income',     label: 'Pracovní neschopnost, OČR a nemocnice',   short: 'PN, OČR & Hosp.',  color: 'fuchsia', icon: 'wallet' },
    { key: 'addons',     label: 'Chirurgie, rekonvalescence, odpovědnost', short: 'Chirurgie & Doplňky', color: 'teal', icon: 'Stethoscope' }
];

const GROUP_BY_KEY = Object.fromEntries(CATEGORY_GROUPS.map(g => [g.key, g]));

/* ─────────────────────────────────────────────────────────────────
   POJISTNÉ KATEGORIE (32 druhů pojištění nabízených českými pojišťovnami)
   Zachovává 100% zpětnou kompatibilitu s původními 13 klíči z Vzor-2024.xlsm:
   (smrt, smrtUraz, invalidita, zavOn, tnUraz, tnUraz10, uraz, urazVelky,
    hosp, hospUraz, pn28, pn61, chir) + doplňuje všechna moderní rizika.
   Pole `kind`:
     - 'sum'     = jednorázová pojistná částka (Kč)
     - 'daily'   = denní dávka v případě události (Kč/den)
     - 'monthly' = měsíční renta / zproštění (Kč/měs)
   Pole `core`: true u základních kategorií, které tvoří kostru přehledů.
   ───────────────────────────────────────────────────────────────── */
const INSURANCE_CATEGORIES = [
    /* 1. SMRT A ZAJIŠTĚNÍ POZŮSTALÝCH / ÚVĚRŮ */
    { key: 'smrt',          group: 'death',      core: true,  kind: 'sum',     purpose: 'survivors',
      label: 'Smrt (konstantní PČ)',             short: 'Smrt',       mini: 'S',     icon: 'cross',        color: 'rose',
      help: 'Základní a doplňková pojistná částka pro případ smrti z jakékoliv příčiny (nemoc i úraz) s konstantní výší po celou dobu trvání.' },
    { key: 'smrtKles',      group: 'death',      core: true,  kind: 'sum',     purpose: 'survivors',
      label: 'Smrt (klesající PČ k úvěru)',      short: 'Smrt kles.', mini: 'SK',    icon: 'trending-down',color: 'rose',
      help: 'Lineárně nebo anuitně klesající pojistná částka pro případ smrti – přesně kopíruje nesplacenou jistinu hypotéky či úvěru za výrazně nižší cenu.' },
    { key: 'smrtUraz',      group: 'death',      core: true,  kind: 'sum',     purpose: 'survivors',
      label: 'Smrt úrazem',                      short: 'Smrt Ú',     mini: 'SÚ',    icon: 'zap',          color: 'rose',
      help: 'Doplňkové plnění pouze v případě, že úmrtí nastane následkem úrazu. Nenahrazuje obecné krytí smrti z nemoci.' },
    { key: 'smrtAutonehoda',group: 'death',      core: false, kind: 'sum',     purpose: 'survivors',
      label: 'Smrt při dopravní nehodě',         short: 'Smrt Auto',  mini: 'SA',    icon: 'car',          color: 'rose',
      help: 'Navýšené plnění (často dvojnásobek úrazové smrti), pokud k úmrtí dojde při dopravní nehodě.' },
    { key: 'rentaPozustali',group: 'death',      core: false, kind: 'monthly', purpose: 'survivors',
      label: 'Pozůstalostní renta (měsíční)',    short: 'Renta poz.', mini: 'RP',    icon: 'calendar-clock',color: 'rose',
      help: 'Pravidelná měsíční renta vyplácená oprávněným osobám (partnerovi, dětem) po sjednanou dobu po úmrtí pojištěného.' },

    /* 2. INVALIDITA A DLOUHODOBÁ PÉČE (SOBĚSTAČNOST) */
    { key: 'invalidita',    group: 'disability', core: true,  kind: 'sum',     purpose: 'disability',
      label: 'Invalidita III. st. (hlavní PČ)',  short: 'Inv. III',   mini: 'Inv3',  icon: 'accessibility',color: 'amber',
      help: 'Jednorázové plnění při přiznání invalidity III. stupně (pokles pracovní schopnosti o min. 70 % dle ČSSZ) z nemoci i úrazu.' },
    { key: 'inv2',          group: 'disability', core: true,  kind: 'sum',     purpose: 'disability',
      label: 'Invalidita II. stupně',            short: 'Inv. II',    mini: 'Inv2',  icon: 'accessibility',color: 'amber',
      help: 'Jednorázové plnění při přiznání invalidity II. stupně (pokles pracovní schopnosti o 50–69 %). Klíčové, protože velká část invalidit nekončí hned ve III. stupni.' },
    { key: 'inv1',          group: 'disability', core: true,  kind: 'sum',     purpose: 'disability',
      label: 'Invalidita I. stupně',             short: 'Inv. I',     mini: 'Inv1',  icon: 'accessibility',color: 'amber',
      help: 'Jednorázové plnění při přiznání invalidity I. stupně (pokles pracovní schopnosti o 35–49 %). Nejčastěji přiznávaný stupeň invalidity v ČR.' },
    { key: 'invKles',       group: 'disability', core: true,  kind: 'sum',     purpose: 'disability',
      label: 'Invalidita klesající (k úvěru)',   short: 'Inv. kles.', mini: 'InvK',  icon: 'trending-down',color: 'amber',
      help: 'Klesající pojistná částka pro případ invalidity (typicky III. a II. stupně, příp. v souhrnném úvěrovém balíčku se smrtí) k zajištění nesplacené hypotéky.' },
    { key: 'invRenta',      group: 'disability', core: false, kind: 'monthly', purpose: 'disability',
      label: 'Invalidní důchod / renta (měs.)',  short: 'Inv. renta', mini: 'InvR',  icon: 'repeat',       color: 'amber',
      help: 'Měsíční soukromá renta vyplácená pojišťovnou po dobu trvání invalidity (do sjednaného konce smlouvy / 65 let) k dorovnání státního důchodu.' },
    { key: 'dlouhodobaPece',group: 'disability', core: true,  kind: 'monthly', purpose: 'ltc',
      label: 'Dlouhodobá péče / Soběstačnost',   short: 'LTC péče',   mini: 'LTC',   icon: 'heart-handshake',color: 'amber',
      help: 'Měsíční doživotní renta při ztrátě soběstačnosti (příspěvek na péči II., III. nebo IV. stupně). U III. a IV. stupně daňově odečitatelné až do 48 000 Kč/rok!' },
    { key: 'zprosteni',     group: 'disability', core: false, kind: 'monthly', purpose: 'disability',
      label: 'Zproštění od placení (Kč/měs)',    short: 'Zproštění',  mini: 'Zpr',   icon: 'shield-check', color: 'amber',
      help: 'Při přiznání invalidity (nebo smrti pojistníka u dětské smlouvy) přebírá placení měsíčního pojistného pojišťovna. Zadejte výši krytého pojistného v Kč/měs.' },

    /* 3. ZÁVAŽNÁ ONEMOCNĚNÍ A SPECIFICKÉ DIAGNÓZY */
    { key: 'zavOn',         group: 'illness',    core: true,  kind: 'sum',     purpose: 'criticalIllness',
      label: 'Závažná onemocnění (ZO)',          short: 'Záv. onem.', mini: 'ZO',    icon: 'heart-pulse',  color: 'violet',
      help: 'Jednorázové plnění při diagnostice závažných nemocí (rakovina, infarkt, mrtvice, roztroušená skleróza aj.). Slouží k financování léčby a výpadku příjmu 1–2 roky.' },
    { key: 'zavOnKles',     group: 'illness',    core: false, kind: 'sum',     purpose: 'criticalIllness',
      label: 'Závažná onemocnění (klesající)',   short: 'ZO kles.',   mini: 'ZOK',   icon: 'trending-down',color: 'violet',
      help: 'Klesající pojistná částka pro závažná onemocnění, často sjednávaná jako součást úvěrového balíčku.' },
    { key: 'zavOnMuzZena',  group: 'illness',    core: false, kind: 'sum',     purpose: 'criticalIllness',
      label: 'Rakovina / ZO pro muže a ženy',    short: 'ZO Onko+',   mini: 'ZO+',   icon: 'ribbon',       color: 'violet',
      help: 'Speciální připojištění onkologických diagnóz (včetně počátečních stadií in-situ), karcinomu prsu/děložního čípku/prostaty či těhotenských komplikací.' },
    { key: 'cukrovkaKompl', group: 'illness',    core: false, kind: 'sum',     purpose: 'criticalIllness',
      label: 'Cukrovka a kardio komplikace',     short: 'Diabetes',   mini: 'Dia',   icon: 'activity',     color: 'violet',
      help: 'Připojištění pro případ diagnózy diabetes mellitus a jeho závažných komplikací nebo rozšířených kardiovaskulárních diagnóz.' },
    { key: 'trvaleNasledkyNemoc', group: 'illness', core: false, kind: 'sum',  purpose: 'criticalIllness',
      label: 'Trvalé následky nemoci / Dětská inv.', short: 'TN nemoci', mini: 'TNN', icon: 'baby',        color: 'violet',
      help: 'Krytí trvalých následků vážných nemocí (ztráta sluchu, zraku, obrna) nebo snížené soběstačnosti dítěte (ZTP/P, příspěvek na péči od I./II. st.).' },

    /* 4. ÚRAZ A TRVALÉ NÁSLEDKY ÚRAZU */
    { key: 'tnUraz',        group: 'accident',   core: true,  kind: 'sum',     purpose: 'permanentInjury',
      label: 'Trvalé následky úrazu (od 0,01 %)',short: 'TN úrazu',   mini: 'TN',    icon: 'bandage',      color: 'orange',
      help: 'Základní pojistná částka pro trvalé následky úrazu již od 0,01 % / 0,5 % / 1 % poškození. Při vážném úrazu se násobí progresí (až 400–1000 %).' },
    { key: 'tnUraz10',      group: 'accident',   core: true,  kind: 'sum',     purpose: 'permanentInjury',
      label: 'TN úrazu od 10 %',                 short: 'TN od 10 %', mini: 'TN10',  icon: 'bandage',      color: 'orange',
      help: 'Doplňková pojistná částka pro trvalé následky úrazu s prahem plnění od 10 % tělesného poškození (cenově levnější navýšení pro těžší úrazy).' },
    { key: 'uraz',          group: 'accident',   core: true,  kind: 'daily',   purpose: 'dailyAccident',
      label: 'Denní odškodné úrazu (DOÚ)',       short: 'DOÚ úraz',   mini: 'DOÚ',   icon: 'sticker',      color: 'emerald',
      help: 'Denní dávka za dobu nezbytného léčení úrazu dle oceňovacích tabulek pojišťovny (typicky od 1. nebo 8. dne léčení).' },
    { key: 'urazVelky',     group: 'accident',   core: true,  kind: 'daily',   purpose: 'dailyAccident',
      label: 'Vážný úraz (DOÚ od 29. dne)',      short: 'Úraz vážný', mini: 'Úr.V',  icon: 'flame',        color: 'emerald',
      help: 'Denní dávka pro střední a těžší úrazy s dobou léčení nad 28/29 dní (nebo vyjmenované úrazy).' },
    { key: 'zlomeninyPopaleniny', group: 'accident', core: false, kind: 'sum', purpose: 'permanentInjury',
      label: 'Zlomeniny a popáleniny (jednoráz.)', short: 'Zlomeniny', mini: 'Zlom', icon: 'bone',         color: 'orange',
      help: 'Jednorázová pojistná částka (nebo % z ní dle tabulky) vyplacená ihned po diagnóze zlomeniny, popáleniny či natržení vazů.' },
    { key: 'horniKoncetiny',group: 'accident',   core: false, kind: 'sum',     purpose: 'permanentInjury',
      label: 'Poškození horních končetin',       short: 'Horní konč.',mini: 'HK',    icon: 'hand',         color: 'orange',
      help: 'Speciální připojištění úrazu a onemocnění rukou a prstů (pro lékaře, IT specialisty, řemeslníky, hudebníky).' },

    /* 5. PRACOVNÍ NESCHOPNOST, OŠETŘOVÁNÍ A HOSPITALIZACE */
    { key: 'pn15',          group: 'income',     core: true,  kind: 'daily',   purpose: 'incomeLoss',
      label: 'PN od 15. dne (denní dávka)',      short: 'PN od 15.',  mini: 'PN15',  icon: 'wallet',       color: 'fuchsia',
      help: 'Denní dávka při pracovní neschopnosti od 15. dne (navazuje na konec náhrady mzdy od zaměstnavatele, nebo chrání OSVČ při kratších i delších nemocích).' },
    { key: 'pn28',          group: 'income',     core: true,  kind: 'daily',   purpose: 'incomeLoss',
      label: 'PN od 29. dne (denní dávka)',      short: 'PN od 29.',  mini: 'PN29',  icon: 'wallet',       color: 'fuchsia',
      help: 'Standardní denní dávka za pracovní neschopnost od 29. dne (lze sjednat s výplatou zpětně od 1. dne).' },
    { key: 'pn61',          group: 'income',     core: true,  kind: 'daily',   purpose: 'incomeLoss',
      label: 'PN od 61. dne (denní dávka)',      short: 'PN od 61.',  mini: 'PN61',  icon: 'wallet',       color: 'fuchsia',
      help: 'Navýšená denní dávka pro dlouhodobou pracovní neschopnost trvající déle než 60 dní (s možností zpětného plnění).' },
    { key: 'osetrovani',    group: 'income',     core: true,  kind: 'daily',   purpose: 'incomeLoss',
      label: 'Ošetřování dítěte / člena rodiny', short: 'OČR péče',   mini: 'OČR',   icon: 'heart',        color: 'fuchsia',
      help: 'Denní dávka při ošetřování nemocného nebo zraněného dítěte (či dospělého člena rodiny) – kompenzuje propad příjmu rodiče na OČR (typicky od 10. nebo 29. dne).' },
    { key: 'hosp',          group: 'income',     core: true,  kind: 'daily',   purpose: 'hospital',
      label: 'Hospitalizace — nemoc i úraz',     short: 'Hosp.',      mini: 'H',     icon: 'hospital',     color: 'sky',
      help: 'Denní dávka za každý den (půlnoc) pobytu v nemocnici z důvodu nemoci i úrazu (často s dvojnásobkem na JIP/ARO).' },
    { key: 'hospUraz',      group: 'income',     core: false, kind: 'daily',   purpose: 'hospital',
      label: 'Hospitalizace pouze úrazem',       short: 'Hosp. Ú',    mini: 'HÚ',    icon: 'ambulance',    color: 'sky',
      help: 'Doplňková denní dávka pouze pro případ hospitalizace následkem úrazu.' },

    /* 6. CHIRURGIE, REKONVALESCENCE, ODPOVĚDNOST A ASISTENCE */
    { key: 'chir',          group: 'addons',     core: true,  kind: 'sum',     purpose: 'surgery',
      label: 'Chirurgický zákrok (limit)',       short: 'Chirurgie',  mini: 'Ch',    icon: 'syringe',      color: 'teal',
      help: 'Jednorázová částka dle závažnosti operace v oceňovací tabulce pojišťovny.' },
    { key: 'rekonvalescence',group: 'addons',    core: false, kind: 'sum',     purpose: 'surgery',
      label: 'Poúrazová péče a rehabilitace',    short: 'Rehab.',     mini: 'Reh',   icon: 'sparkles',     color: 'teal',
      help: 'Proplacení nákladů na soukromou rehabilitaci, zdravotní pomůcky, kosmetické operace a rekonvalescenci po úrazu či vážné nemoci.' },
    { key: 'odpovednostObc',group: 'addons',     core: false, kind: 'sum',     purpose: 'addons',
      label: 'Občanská odpovědnost (v ŽP)',      short: 'Odpovědnost',mini: 'Odp',   icon: 'scale',        color: 'teal',
      help: 'Pojistný limit občanské odpovědnosti za škodu v běžném životě (sjednaný v rámci životní smlouvy, např. u Kooperativy, ČPP, Generali).' }
];

/* Mapa key → kategorie pro rychlý lookup */
const CATEGORY_BY_KEY = Object.fromEntries(INSURANCE_CATEGORIES.map(c => [c.key, c]));

/* ─────────────────────────────────────────────────────────────────
   LEGISLATIVNÍ A VÝPOČETNÍ KONSTANTY ČR (2026)
   - Redukční hranice DVZ nemocenské 2026: 1 633 Kč (90 %), 2 449 Kč (60 %), 4 897 Kč (30 %)
   - Redukční hranice OVZ důchodů 2026: 21 546 Kč (99 %), 195 868 Kč (26 %), zákl. výměra 4 900 Kč
   - Daň z příjmů 2026: 15 % / 23 % nad 146 901 Kč/měs, sleva na poplatníka 2 570 Kč/měs
   - Společný limit daňového odpočtu (ŽP + LTC + DIP + DPS): 48 000 Kč/rok
   - Limit příspěvku zaměstnavatele osvobozeného od odvodů: 50 000 Kč/rok
   ───────────────────────────────────────────────────────────────── */
const STATUTORY_2026 = {
    avgWage: 48967,
    taxBracket23Monthly: 146901,
    taxCreditTaxpayerMonthly: 2570,
    empSocialRate: 0.071,    // 6,5 % důchodové + 0,6 % nemocenské
    empHealthRate: 0.045,    // 4,5 % zdravotní
    dvzThreshold1: 1633,
    dvzThreshold2: 2449,
    dvzThreshold3: 4897,
    pensionBasic: 4900,
    pensionRh1: 21546,
    pensionRh2: 195868,
    pensionRateRh1: 0.99,
    pensionRateRh2: 0.26,
    pensionYearCoeffInv3: 0.01495, // 1,495 % za rok pojištění pro III. st.
    pensionYearCoeffInv2: 0.007475,// polovina pro II. st.
    pensionYearCoeffInv1: 0.004983,// třetina pro I. st.
    taxDeductibleCapYearly: 48000,
    employerBenefitCapYearly: 50000
};

/* Původní pásmová tabulka z Excelu (pro zpětnou referenci) */
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
const SICKLEAVE_CAP = 58000;

/* Přesný výpočet čistého příjmu (2026) */
function computeNetIncome(grossMonthly, isEntrepreneur) {
    const g = Math.max(0, Number(grossMonthly) || 0);
    if (g === 0) return 0;
    if (isEntrepreneur) {
        /* Orientační čistý disponibilní příjem OSVČ po odvodech a dani (cca 78 % ze zisku / příjmu) */
        return Math.round(g * 0.78);
    }
    const soc = Math.round(g * STATUTORY_2026.empSocialRate);
    const zdp = Math.round(g * STATUTORY_2026.empHealthRate);
    const base15 = Math.min(g, STATUTORY_2026.taxBracket23Monthly);
    const base23 = Math.max(0, g - STATUTORY_2026.taxBracket23Monthly);
    const rawTax = Math.round(base15 * 0.15 + base23 * 0.23);
    const taxAfterCredit = Math.max(0, rawTax - STATUTORY_2026.taxCreditTaxpayerMonthly);
    return Math.max(0, g - soc - zdp - taxAfterCredit);
}

/* Přesný výpočet nemocenské dle redukčních hranic ČSSZ 2026 */
function computeExactSickLeave(grossMonthly, isEntrepreneur, totalDays) {
    const g = Math.max(0, Number(grossMonthly) || 0);
    const days = Math.max(0, Number(totalDays) || 30);
    if (g <= 0 || isEntrepreneur) {
        return {
            dvz: 0, redDvz: 0,
            daily1to14: 0, daily15to30: 0, daily31to60: 0, daily61plus: 0,
            monthlyAvg: 0, totalForDays: 0
        };
    }
    const dvz = (g * 12) / 365;
    const rh1 = STATUTORY_2026.dvzThreshold1;
    const rh2 = STATUTORY_2026.dvzThreshold2;
    const rh3 = STATUTORY_2026.dvzThreshold3;

    const part1 = Math.min(dvz, rh1) * 0.90;
    const part2 = Math.max(0, Math.min(dvz, rh2) - rh1) * 0.60;
    const part3 = Math.max(0, Math.min(dvz, rh3) - rh2) * 0.30;
    const redDvz = Math.ceil(part1 + part2 + part3);

    /* Dny 1–14: náhrada mzdy zaměstnavatelem za pracovní dny (cca 10 prac. dnů ze 14 kalendářních ≈ 60 % redDvz × 5/7) */
    const daily1to14   = Math.round(redDvz * 0.60 * (5 / 7));
    const daily15to30  = Math.ceil(redDvz * 0.60);
    const daily31to60  = Math.ceil(redDvz * 0.66);
    const daily61plus  = Math.ceil(redDvz * 0.72);

    const d1 = Math.min(days, 14);
    const d2 = Math.max(0, Math.min(days, 30) - 14);
    const d3 = Math.max(0, Math.min(days, 60) - 30);
    const d4 = Math.max(0, days - 60);

    const totalForDays = Math.round(d1 * daily1to14 + d2 * daily15to30 + d3 * daily31to60 + d4 * daily61plus);
    /* Standardizovaný 30denní měsíc dlouhodobé PN (kombinace 31.–60. dne) */
    const monthlyAvg = Math.round(daily31to60 * 30);

    return {
        dvz: Math.round(dvz),
        redDvz,
        daily1to14,
        daily15to30,
        daily31to60,
        daily61plus,
        monthlyAvg,
        totalForDays
    };
}

/* Odhad státního invalidního důchodu I., II. a III. stupně (2026) */
function computeStateDisabilityPension(grossMonthly, isEntrepreneur, birthYear) {
    const g = Math.max(0, Number(grossMonthly) || 0);
    if (g <= 0) return { inv1: 0, inv2: 0, inv3: 0, vypoctovyZaklad: 0 };
    /* U OSVČ počítáme vyměřovací základ cca 55 % z příjmu (pokud si neplatí jen minimum) */
    const ovz = isEntrepreneur ? Math.max(19587, Math.round(g * 0.55)) : g;
    const rh1 = STATUTORY_2026.pensionRh1;
    const rh2 = STATUTORY_2026.pensionRh2;
    const vz = Math.round(
        Math.min(ovz, rh1) * STATUTORY_2026.pensionRateRh1 +
        Math.max(0, Math.min(ovz, rh2) - rh1) * STATUTORY_2026.pensionRateRh2
    );
    /* Celková započtená doba pojištění vč. dopočtené doby od 18–20 let do 65 let ≈ typicky 42 let */
    const currentYear = new Date().getFullYear();
    const age = birthYear ? Math.max(18, Math.min(65, currentYear - Number(birthYear))) : 38;
    const insuredYears = age < 22 ? 40 : 43;

    const base = STATUTORY_2026.pensionBasic;
    const proc3 = Math.max(4900, Math.round(vz * insuredYears * STATUTORY_2026.pensionYearCoeffInv3));
    const proc2 = Math.max(2450, Math.round(vz * insuredYears * STATUTORY_2026.pensionYearCoeffInv2));
    const proc1 = Math.max(1634, Math.round(vz * insuredYears * STATUTORY_2026.pensionYearCoeffInv1));

    return {
        vypoctovyZaklad: vz,
        insuredYears,
        inv3: base + proc3,
        inv2: base + proc2,
        inv1: base + proc1
    };
}

/* Progresivní plnění u trvalých následků úrazu (výpočet koeficientu progrese dle % poškození a stupně progrese) */
function computeTnProgressionMultiplier(damagePct, maxProgressionPct) {
    const p = Math.max(0, Math.min(100, Number(damagePct) || 0));
    const maxProg = Number(maxProgressionPct) || 100;
    if (p <= 0) return 0;
    if (maxProg <= 100 || p <= 15) return p / 100;
    /* Standardní křivka progrese českých pojišťoven (od 15–25 % poškození roste násobek až do maxProg při 100 %): */
    const maxMult = maxProg / 100; // např. 8 pro 800 %, 10 pro 1000 %
    /* Nelineární náběh progrese od 15 % do 100 % */
    const normalized = (p - 15) / 85; // 0 až 1
    const factor = 1 + (maxMult - 1) * Math.pow(normalized, 1.65);
    return (p / 100) * factor;
}

/* ─────────────────────────────────────────────────────────────────
   POJIŠŤOVNY — Katalog 13 pojišťoven na českém trhu (2025/2026)
   ───────────────────────────────────────────────────────────────── */
const INSURERS = [
    {
        name: 'Kooperativa', short: 'KOOP',
        productLine: 'FLEXI životní pojištění / FLEXI Junior / NaPřání',
        defaultConditions: {
            contractType: 'risk',
            pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: false,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 2,
            tnProgression: 800, invPsychIncluded: true, backPainIncluded: true, garanceTabulek: true,
            suicideExclusionYears: 2, occupationCategories: '1–4', paymentFrequency: 'monthly'
        },
        strengths: 'Unikátní garance oceňovacích tabulek (likviduje dle nejvýhodnější verze), progrese TN až 800 %, běžné sporty v základu, špičkové ošetřování dítěte a LTC.',
        weaknesses: 'Vyšší základní sazba u starších ročníků, přísnější přirážky za vyšší BMI nebo hypertenzi.',
        notes: 'Vlajkový produkt FLEXI. Lze sjednat samostatně Inv I, II, III, dlouhodobou péči, občanskou odpovědnost i zproštění.'
    },
    {
        name: 'Allianz', short: 'ALZ',
        productLine: 'Allianz ŽIVOT / Allianz Plus',
        defaultConditions: {
            contractType: 'risk',
            pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: true,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 2,
            tnProgression: 800, invPsychIncluded: true, backPainIncluded: true, garanceTabulek: true,
            suicideExclusionYears: 2, occupationCategories: '1–4', paymentFrequency: 'monthly'
        },
        strengths: 'Vynikající krytí závažných onemocnění vč. počátečních stadií, progrese TN až 800 %, daňově uznatelná dlouhodobá péče (LTC), garance nejvyššího plnění.',
        weaknesses: 'Vyšší pojistné u maximálních limitů denního odškodného.',
        notes: 'Allianz ŽIVOT nabízí přehledné balíčky i plně modulární stavbu. Výborné krytí hypoték (klesající PČ).'
    },
    {
        name: 'Generali Česká pojišťovna', short: 'GČP',
        productLine: 'Můj život 2 / Můj život',
        defaultConditions: {
            contractType: 'risk',
            pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: false,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 2,
            tnProgression: 1000, invPsychIncluded: true, backPainIncluded: false, garanceTabulek: false,
            suicideExclusionYears: 2, occupationCategories: '1–4', paymentFrequency: 'monthly'
        },
        strengths: 'Progrese TN až 1000 %, slevy za zdravý životní styl a nekouření až 25–30 %, vysoké limity bez lékařské prohlídky, umí pojistit i některé chronické diagnózy.',
        weaknesses: 'Přísnější posuzování bolestí zad při PN (vyžaduje objektivní nález CT/MR).',
        notes: 'Největší pojistitel na trhu. Produkt Můj život 2 kombinuje osobní rizika s možností připojištění odpovědnosti a asistence.'
    },
    {
        name: 'Uniqa', short: 'UNI',
        productLine: 'Život & Radost',
        defaultConditions: {
            contractType: 'risk',
            pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: true,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 2,
            tnProgression: 1000, invPsychIncluded: true, backPainIncluded: true, garanceTabulek: false,
            suicideExclusionYears: 2, occupationCategories: '1–4', paymentFrequency: 'monthly'
        },
        strengths: 'Progrese TN až 1000 %, špičkové krytí úvěrů (klesající PČ), ztráta soběstačnosti (LTC) bez čekací doby (doživotní renta od III. st., u dětí jednorázově od II. st.).',
        weaknesses: 'U některých psychických diagnóz v PN výluky mimo F00–F09 a F20–F29.',
        notes: 'UNIQA Život & Radost patří k nejčastěji využívaným produktům pro zajištění hypoték a komplexní ochranu rodiny.'
    },
    {
        name: 'NN Životní pojišťovna', short: 'NN',
        productLine: 'NN Orange Risk / NN Život',
        defaultConditions: {
            contractType: 'risk',
            pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: true,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 2,
            tnProgression: 800, invPsychIncluded: true, backPainIncluded: true, garanceTabulek: false,
            suicideExclusionYears: 2, occupationCategories: '1–4', paymentFrequency: 'monthly'
        },
        strengths: 'Špičková dlouhodobá péče (LTC III. a IV. st. s daňovým odpočtem), volba lineárního nebo přirozeného pojistného (levný start pro mladé s hypotékou), 2. lékařský názor.',
        weaknesses: 'U přirozeného pojistného v pozdějším věku cena roste (vhodné primárně pro klesající PČ).',
        notes: 'Specialista na čistě rizikové pojištění, závažné nemoci a dlouhodobou péči.'
    },
    {
        name: 'ČSOB Pojišťovna', short: 'ČSOB',
        productLine: 'Náš život / Forte',
        defaultConditions: {
            contractType: 'risk',
            pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: false,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 3,
            tnProgression: 600, invPsychIncluded: true, backPainIncluded: false, garanceTabulek: false,
            suicideExclusionYears: 2, occupationCategories: '1–4', paymentFrequency: 'monthly'
        },
        strengths: 'Dobré krytí psychických onemocnění (deprese, vyhoření) už od I. stupně invalidity, vazba na slevu u hypotéky ČSOB/HB, kvalitní poúrazová asistence.',
        weaknesses: 'Častější plošné výluky na pohybový aparát při předchozích záznamech v kartě.',
        notes: 'Moderní produkt Náš život nahradil starší řadu Forte (která se často vyskytuje ve stávajících portfoliích klientů).'
    },
    {
        name: 'MetLife', short: 'MET',
        productLine: 'OneGuard / Garde 6.0 / OneLife',
        defaultConditions: {
            contractType: 'risk',
            pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: true,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 2,
            tnProgression: 1000, invPsychIncluded: true, backPainIncluded: true, garanceTabulek: false,
            suicideExclusionYears: 2, occupationCategories: '1–4', paymentFrequency: 'monthly'
        },
        strengths: 'Progrese TN až 1000 %, unikátní připojištění horních končetin, vícenásobné plnění u ZO (až 5× v různých skupinách), velmi rychlá likvidace úrazů, slevy za BMI a nekouření.',
        weaknesses: 'Přísný vstupní zdravotní underwriting při sjednání.',
        notes: 'Vlajkový produkt OneGuard nabízí jedny z nejhlubších pojistných podmínek pro úrazy a závažné diagnózy.'
    },
    {
        name: 'Simplea', short: 'SIM',
        productLine: 'Simplea Životní pojištění 2.0',
        defaultConditions: {
            contractType: 'risk',
            pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: true,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 2,
            tnProgression: 1000, invPsychIncluded: true, backPainIncluded: true, garanceTabulek: true,
            suicideExclusionYears: 2, occupationCategories: '1–3', paymentFrequency: 'monthly'
        },
        strengths: 'Minimum výluk, garance plnění 99 %, srozumitelné pojistné podmínky, progrese TN až 1000 %, posuzování invalidity dle reálného dopadu.',
        weaknesses: 'Méně drobných bolestných připojištění (zaměřeno primárně na vážná a střední rizika).',
        notes: 'Moderní produkt zaměřený na ochranu příjmu, invalidity a úvěrů s minimem administrativních kliček.'
    },
    {
        name: 'Komerční pojišťovna', short: 'KB',
        productLine: 'MojeJistota / Elán / Mutumutu / Vital',
        defaultConditions: {
            contractType: 'risk',
            pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: true,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 2,
            tnProgression: 800, invPsychIncluded: true, backPainIncluded: true, garanceTabulek: false,
            suicideExclusionYears: 2, occupationCategories: '1–4', paymentFrequency: 'monthly'
        },
        strengths: 'Silné propojení s hypotékami Komerční banky, v produktu MojeJistota PN zpětně od 1. dne, u Mutumutu cashback až 30 % za zdravý životní styl.',
        weaknesses: 'Starší bankopojistné smlouvy (Vital) mívají nižší limity na invaliditu.',
        notes: 'Vystupuje pod značkou KB Pojišťovna (právně Komerční pojišťovna, a.s.).'
    },
    {
        name: 'Česká podnikatelská pojišťovna', short: 'ČPP',
        productLine: 'NEON Risk / NEON Life',
        defaultConditions: {
            contractType: 'risk',
            pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: true,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 2,
            tnProgression: 800, invPsychIncluded: true, backPainIncluded: true, garanceTabulek: false,
            suicideExclusionYears: 2, occupationCategories: '1–4', paymentFrequency: 'monthly'
        },
        strengths: 'Vynikající dětské a rodinné pojištění, progrese TN až 800 %, široký výběr doplňkových rizik (ošetřování, odpovědnost, lázně, rekonvalescence).',
        weaknesses: 'Složitější struktura dílčích připojištění při ručním skládání.',
        notes: 'Produktová řada NEON patří mezi nejprodávanější rodinné pojistky na trhu.'
    },
    {
        name: 'Pillow pojišťovna', short: 'PIL',
        productLine: 'Pillow Život / Úraz a nemoc',
        defaultConditions: {
            contractType: 'risk',
            pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: true,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 2,
            tnProgression: 800, invPsychIncluded: true, backPainIncluded: true, garanceTabulek: false,
            suicideExclusionYears: 2, occupationCategories: '1–4', paymentFrequency: 'monthly'
        },
        strengths: 'Extrémně přehledné a krátké podmínky („polštáře"), férová cena, oddělené oceňování úrazu a nemoci, plně digitální správa.',
        weaknesses: 'Chybí některá specifická vedlejší připojištění tradičních pojišťoven.',
        notes: 'Moderní digitální pojišťovna s důrazem na srozumitelnost a absenci skrytých výluk.'
    },
    {
        name: 'YOUPLUS', short: 'YOU',
        productLine: '4U životní pojištění',
        defaultConditions: {
            contractType: 'risk',
            pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: true,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 2,
            tnProgression: 800, invPsychIncluded: true, backPainIncluded: true, garanceTabulek: false,
            suicideExclusionYears: 2, occupationCategories: '1–4', paymentFrequency: 'monthly'
        },
        strengths: 'Velmi konkurenceschopná cena u klesajících částek pro zajištění hypotéky (smrt + invalidita I.–III. st.), progrese TN 800 %.',
        weaknesses: 'Menší pobočková síť (distribuce primárně přes makléře a poradce).',
        notes: 'Oblíbená volba pro cenově efektivní krytí velkých rizik (smrt, invalidita, ZO).'
    },
    {
        name: 'Maxima / Direct', short: 'MAX',
        productLine: 'MaxEfekt / Direct Život',
        defaultConditions: {
            contractType: 'risk',
            pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: false,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 3,
            tnProgression: 500, invPsychIncluded: false, backPainIncluded: false, garanceTabulek: false,
            suicideExclusionYears: 2, occupationCategories: '1–4', paymentFrequency: 'monthly'
        },
        strengths: 'Jednoduché sjednání vybraných úrazových a rizikových složek.',
        weaknesses: 'Užší rozsah krytí u komplexních diagnóz oproti velkým životním pojišťovnám.',
        notes: 'Doplňkové produkty na českém pojistném trhu.'
    }
];

const INSURER_NAMES = INSURERS.map(i => i.name);

/* ─────────────────────────────────────────────────────────────────
   STATUSY SMLUV DLE DOPORUČENÍ PORADCE (pro jasnou identifikaci v UI i tisku)
   ───────────────────────────────────────────────────────────────── */
const CONTRACT_ACTIONS = {
    current: [
        { key: 'keep',        label: 'Ponechat beze změny',      short: 'PONECHAT',   badge: 'emerald', printCls: 'status-keep',
          desc: 'Smlouva je výhodná nebo kryje rizika sjednaná před změnou zdravotního stavu – nerušit.' },
        { key: 'modify',      label: 'Upravit / redukovat',      short: 'UPRAVIT',    badge: 'amber',   printCls: 'status-modify',
          desc: 'Smlouvu zachovat, ale upravit pojistné částky nebo odebrat drahá/duplicitní připojištění.' },
        { key: 'cancel',      label: 'Vypovědět / nahradit',     short: 'VYPOVĚDĚT',  badge: 'rose',    printCls: 'status-cancel',
          desc: 'Smlouva je překonaná, drahá nebo nedostatečná – ukončit AŽ PO přijetí nové smlouvy do pojištění.' },
        { key: 'consolidate', label: 'Sloučit do nové smlouvy',  short: 'SLOUČIT',    badge: 'violet',  printCls: 'status-consolidate',
          desc: 'Rizika z této smlouvy jsou plně převedena a sjednocena pod novou hlavní smlouvu.' }
    ],
    proposed: [
        { key: 'new',         label: 'Nová smlouva (sjednat)',   short: 'NOVÁ SMLOUVA', badge: 'sky',     printCls: 'status-new',
          desc: 'Nově navržená smlouva dle modelace finančního poradce.' },
        { key: 'kept',        label: 'Zachovaná stávající',      short: 'ZACHOVÁNO',    badge: 'emerald', printCls: 'status-keep',
          desc: 'Původní smlouva klienta, která přechází do nového portfolia beze změny.' },
        { key: 'modified',    label: 'Upravená stávající',       short: 'PO ÚPRAVĚ',    badge: 'amber',   printCls: 'status-modify',
          desc: 'Původní smlouva klienta po doporučené optimalizaci parametrů.' },
        { key: 'alternative', label: 'Alternativní varianta',    short: 'ALTERNATIVA',  badge: 'violet',  printCls: 'status-consolidate',
          desc: 'Volitelná / alternativní nabídka k porovnání.' }
    ]
};

/* ─────────────────────────────────────────────────────────────────
   PRÁVNÍ RÁMEC A METODIKA (2026)
   ───────────────────────────────────────────────────────────────── */
const LEGAL_FRAMEWORK = [
    {
        title: 'Zákon č. 170/2018 Sb. — o distribuci pojištění a zajištění (IDD)',
        body: `<p>Klíčový předpis upravující činnost finančního poradce / pojišťovacího zprostředkovatele:</p>
        <ul>
            <li><strong>§ 77–78 Analýza potřeb a rada zákazníkovi</strong> — před sjednáním nebo podstatnou změnou pojištění musí poradce zjistit požadavky, cíle, finanční situaci a zdravotní/pracovní kontext klienta a posoudit vhodnost produktu.</li>
            <li><strong>§ 79 Záznam z jednání</strong> — povinný písemný dokument zachycující požadavky a potřeby klienta, doporučení poradce a konkrétní důvody, proč je navržené řešení vhodné (vč. vysvětlení dopadů při výpovědi či úpravě staré smlouvy).</li>
            <li><strong>§ 81 Omezení odkupného a počátečních nákladů</strong> — u rezervotvorného pojištění pojišťovna při předčasném ukončení v prvních 5 letech započte max. 1/60 pořizovacích nákladů za každý měsíc trvání.</li>
            <li><strong>§ 88 Storno provize</strong> — poměrná vratka provize při zániku životního pojištění v prvních 60 měsících.</li>
        </ul>`
    },
    {
        title: 'Metodika stanovení pojistných částek (Best Practice EFPA / ČNB)',
        body: `<p>Doporučená pravidla pro správné namodelování životního pojištění:</p>
        <ul>
            <li><strong>Smrt (základní + klesající PČ):</strong> 100 % nesplacených závazků (hypotéka, úvěry) pomocí klesající PČ + zajištění rodiny (2–3 roční čisté příjmy živitele + 100 tis. Kč na okamžité výdaje) mínus likvidní aktiva.</li>
            <li><strong>Invalidita I., II. a III. stupně:</strong> Více než 94 % invalidit v ČR vzniká z důvodu <strong>nemoci</strong> (pouze ~6 % úrazem). Pojistná částka má pokrýt závazky + kapitalizovaný propad mezi čistým příjmem a státním invalidním důchodem do věku 65 let.</li>
            <li><strong>Závažná onemocnění (ZO):</strong> 12 až 24 měsíčních čistých příjmů na překlenutí 1–2 let léčby, rekonvalescence a úhradu nadstandardní péče.</li>
            <li><strong>Trvalé následky úrazu (TN):</strong> Základní částka min. 1 000 000 Kč s progresí 800–1000 % (při 100% poškození výplata 8–10 mil. Kč na bezbariérové úpravy a péči).</li>
            <li><strong>Pracovní neschopnost (PN):</strong> Dorovnání rozdílu mezi čistým příjmem a nemocenskou od ČSSZ (u zaměstnance cca 35–40 % čistého příjmu, u OSVČ bez nemocenské 100 % nutných měsíčních výdajů).</li>
        </ul>`
    },
    {
        title: 'Daňové zvýhodnění od roku 2024/2026 — Společný limit 48 000 Kč a LTC',
        body: `<p>Konsolidační balíček sjednotil daňovou podporu tzv. produktů spoření na stáří a pojištění dlouhodobé péče (§ 15 a § 15a ZDP):</p>
        <ul>
            <li><strong>Společný limit odpočtu klienta: až 48 000 Kč ročně</strong> v součtu za:
                <br>1. Dlouhodobý investiční produkt (DIP),
                <br>2. Doplňkové penzijní spoření / PP (vklady nad 1 700 Kč/měs),
                <br>3. Soukromé životní pojištění (rezervotvorná část pro dožití 60+ let a 60+ měs.),
                <br>4. <strong>Pojištění dlouhodobé péče (LTC)</strong> pro III. a IV. stupeň závislosti (zde je daňově uznatelné i čistě rizikové pojistné za toto připojištění!).</li>
            <li><strong>Daňová úspora klienta:</strong> 15 % z odečtené částky (až <strong>7 200 Kč/rok</strong>), u příjmů nad 36násobek průměrné mzdy (1 762 812 Kč/rok, tj. 146 901 Kč/měs v r. 2026) 23 % (až <strong>11 040 Kč/rok</strong>).</li>
            <li><strong>Příspěvek zaměstnavatele: až 50 000 Kč ročně</strong> v souhrnu je osvobozen od daně z příjmů i odvodů sociálního a zdravotního pojištění (§ 6 odst. 9 písm. p) ZDP).</li>
        </ul>`
    },
    {
        title: 'Zásady bezpečného přechodu mezi smlouvami (Ochrana před čekací dobou)',
        body: `<p>Při úpravě nebo náhradě stávající pojistné smlouvy musí poradce i klient dodržet bezpečný postup:</p>
        <ul>
            <li><strong>1. Nikdy nevypovídat starou smlouvu předem:</strong> Nejprve se sjedná nová smlouva a vyčká se na dokončení zdravotního a finančního ocenění (underwritingu) pojišťovnou a vydání pojistky.</li>
            <li><strong>2. Zohlednění zdravotní historie:</strong> Pokud měl klient v minulosti vážnější zdravotní potíže (srdce, páteř, psychika, onkologie), nová pojišťovna by na ně mohla uplatnit výluku nebo přirážku. V takovém případě je nutné původní smlouvu <strong>ponechat</strong> (nebo z ní ponechat dotčená rizika).</li>
            <li><strong>3. Čekací doby u nové smlouvy:</strong> Standardně 2 měsíce pro nemoc (PN, hospitalizace, OČR) a 2–3 měsíce pro závažná onemocnění a invaliditu z nemoci. Některé pojišťovny přebírají čekací dobu z předchozí navazující smlouvy (do výše původních limitů).</li>
        </ul>`
    },
    {
        title: 'Občanský zákoník §§ 2756–2872 — Pojistná smlouva a likvidace',
        body: `<p>Klíčová ustanovení občanského zákoníku:</p>
        <ul>
            <li><strong>§ 2789 Odstoupení od smlouvy:</strong> U životního pojištění do 30 dnů od uzavření bez udání důvodu (u neživotního do 14 dnů).</li>
            <li><strong>§ 2805–2808 Výpověď pojištění:</strong> Do 2 měsíců od uzavření smlouvy (8denní výpovědní doba), ke konci pojistného období (výpověď doručit min. 6 týdnů předem), nebo do 3 měsíců od oznámení pojistné události.</li>
            <li><strong>§ 2798 Lhůta pro likvidaci:</strong> Pojišťovna je povinna ukončit šetření do 3 měsíců od oznámení a vyplatit plnění do 15 dnů od skončení šetření (při delším šetření má pojištěný právo na přiměřenou zálohu).</li>
            <li><strong>§ 2809 Nezamlčení zdravotního stavu:</strong> Pravdivé vyplnění zdravotního dotazníku je zásadní – úmyslné zamlčení diagnózy může vést ke krácení plnění nebo odmítnutí.</li>
        </ul>`
    },
    {
        title: 'Kritické rozdíly v pojistných podmínkách (Psychika, Záda, Klauzule PN)',
        body: `<p>Oblasti, kde se jednotlivé pojišťovny v praxi nejvíce liší:</p>
        <ul>
            <li><strong>Duševní poruchy (dg. F00–F99):</strong> Deprese, úzkosti a syndrom vyhoření tvoří přes 20 % nových invalidit I. a II. stupně. Kvalitní produkty (Kooperativa, Allianz, ČSOB, NN, MetLife, Simplea) kryjí invaliditu z psychických příčin (často s čekací dobou 12–24 měsíců).</li>
            <li><strong>Bolesti zad a páteře (Dorzalgie, M50–M54):</strong> V pracovní neschopnosti pojišťovny často vyžadují objektivní neurologický nález (CT/MR/EMG) nebo hospitalizaci/operaci.</li>
            <li><strong>PN zpětně od 1. dne:</strong> Při překročení karenční doby (např. 29. nebo 61. dne) pojišťovna zpětně proplatí i všechny dny od 1. dne nemoci/úrazu.</li>
        </ul>`
    }
];

/* ─────────────────────────────────────────────────────────────────
   UKÁZKOVÁ DATA (Rozšířený model rodiny Hozna z Vzor-2024.xlsm)
   Obsahuje jak původní data, tak rozšířená rizika a jasné štítky doporučení poradce.
   ───────────────────────────────────────────────────────────────── */
const SAMPLE_DATA = {
    clients: [
        { id: 'c1', name: 'Jan Hozna (pán)',   role: 'adult', incomeGross: 65000, isEntrepreneur: false, birthYear: 1985,
          expensesMonthly: 32000, reserveCash: 250000, occupationRisk: '1 (administrativa / TH)', notes: 'Hlavní živitel a dlužník hypotéky. V roce 2021 řešil kardiologické vyšetření (tachykardie) – zachovat staré ZO!' },
        { id: 'c2', name: 'Martina Hoznová',   role: 'adult', incomeGross: 35000, isEntrepreneur: false, birthYear: 1987,
          expensesMonthly: 18000, reserveCash: 100000, occupationRisk: '1 (administrativa)', notes: 'Spoludlužník v domácnosti, péče o 2 děti.' },
        { id: 'c3', name: 'Vilém (syn)',       role: 'child', incomeGross: 0,     isEntrepreneur: false, birthYear: 2018,
          expensesMonthly: 0,     reserveCash: 0,      occupationRisk: 'Dítě / žák', notes: 'Sportovní kroužky (fotbal).' },
        { id: 'c4', name: 'Tobiáš (syn)',      role: 'child', incomeGross: 0,     isEntrepreneur: false, birthYear: 2020,
          expensesMonthly: 0,     reserveCash: 0,      occupationRisk: 'Dítě',       notes: '' }
    ],
    currentContracts: [
        { id: 's1', clientId: 'c1', insurer: 'ČSOB Pojišťovna', contractNo: '1317491203', start: 2019, end: 2053, premium: 777,
          actionStatus: 'keep', actionReason: 'PONECHAT – sjednáno před r. 2021 (srdeční potíže), kryje ZO 500 000 Kč bez výluky na srdce.',
          items: { smrt: 10000, zavOn: 500000 },
          conditions: { contractType: 'risk', pnFromDay: 29, pnRetroactive: false, tnProgression: 400, invPsychIncluded: true, backPainIncluded: false, paymentFrequency: 'monthly' },
          note: 'Hlavní smlouva s připojištěním ZO před r. 2021' },
        { id: 's2', clientId: 'c1', insurer: 'ČSOB Pojišťovna', contractNo: '1307186251', start: 2015, end: 2058, premium: 409,
          actionStatus: 'cancel', actionReason: 'VYPOVĚDĚT po přijetí nové smlouvy Uniqa – kryje pouze úrazovou smrt a drobné denní dávky, chybí invalidita i smrt z nemoci.',
          items: { smrt: 10000, smrtUraz: 500000, uraz: 300, hosp: 500 },
          conditions: { contractType: 'risk', pnFromDay: 29, pnRetroactive: false, tnProgression: 400, paymentFrequency: 'monthly' },
          note: 'Starší úrazově orientovaná smlouva' },
        { id: 's3', clientId: 'c1', insurer: 'ČSOB Pojišťovna', contractNo: '3117104', start: 2014, end: 2045, premium: 100,
          actionStatus: 'keep', actionReason: 'PONECHAT – nízké pojistné 100 Kč/měs, kryje základní smrt 100 000 Kč bez čekacích dob.',
          items: { smrt: 100000 },
          conditions: { contractType: 'capital', pnFromDay: 29, pnRetroactive: false, tnProgression: 100, paymentFrequency: 'monthly' },
          note: 'Malá doplňková pojistka' },
        { id: 's4', clientId: 'c1', insurer: 'ČSOB Pojišťovna', contractNo: '1105984739', start: 2013, end: 2058, premium: 156,
          actionStatus: 'cancel', actionReason: 'VYPOVĚDĚT po přijetí nové smlouvy – duplicitní drobné úrazové krytí s nízkým limitem TN 200 000 Kč.',
          items: { smrtUraz: 200000, tnUraz: 200000, uraz: 100 },
          conditions: { contractType: 'accident', pnFromDay: 29, pnRetroactive: false, tnProgression: 400, paymentFrequency: 'monthly' },
          note: 'Starší úrazová pojistka' },
        { id: 's5', clientId: 'c3', insurer: 'ČSOB Pojišťovna', contractNo: '1317491203-D1', start: 2019, end: 2053, premium: 0,
          actionStatus: 'consolidate', actionReason: 'SLOUČIT / PŘEVÉST – dětské krytí převádíme do nové rodinné smlouvy s doplněním dětské invalidity a ošetřování.',
          items: { zavOn: 500000, tnUraz: 1000000, uraz: 500, hosp: 500 },
          conditions: { contractType: 'risk', tnProgression: 500, paymentFrequency: 'monthly' },
          note: 'Připojištění syna Viléma u smlouvy otce' },
        { id: 's6', clientId: 'c4', insurer: 'ČSOB Pojišťovna', contractNo: '1317491203-D2', start: 2020, end: 2053, premium: 777,
          actionStatus: 'keep', actionReason: 'PONECHAT – syn Tobiáš má zde kvalitní dětské krytí (ZO 500k, TN 1M, DOÚ 500 Kč, Hosp 500 Kč).',
          items: { zavOn: 500000, tnUraz: 1000000, uraz: 500, hosp: 500 },
          conditions: { contractType: 'risk', tnProgression: 500, paymentFrequency: 'monthly' },
          note: 'Připojištění syna Tobiáše' },
        { id: 's7', clientId: 'c2', insurer: 'ČSOB Pojišťovna', contractNo: '1307186262', start: 2015, end: 2060, premium: 407,
          actionStatus: 'cancel', actionReason: 'VYPOVĚDĚT po přijetí nové smlouvy – neřeší invaliditu ani zajištění rodiny při smrti z nemoci.',
          items: { smrt: 10000, smrtUraz: 500000, uraz: 300, hosp: 500 },
          conditions: { contractType: 'risk', tnProgression: 400, paymentFrequency: 'monthly' },
          note: 'Úrazová smlouva paní Martiny' },
        { id: 's8', clientId: 'c2', insurer: 'Kooperativa', contractNo: '1420482462', start: 2009, end: 2050, premium: 500,
          actionStatus: 'cancel', actionReason: 'VYPOVĚDĚT po přijetí nové smlouvy – zastaralá smlouva z r. 2009 s extrémně nízkou invaliditou (24 000 Kč) a ZO (50 000 Kč).',
          items: { smrt: 200000, invalidita: 24000, zavOn: 50000, tnUraz: 200000, uraz: 100, hosp: 200 },
          conditions: { contractType: 'invest', tnProgression: 400, paymentFrequency: 'monthly' },
          note: 'Starší smlouva Kooperativa z r. 2009' }
    ],
    proposedContracts: [
        { id: 'n1', clientId: 'c1', insurer: 'ČSOB Pojišťovna', contractNo: '1317491203', start: 2019, end: 2053, premium: 777,
          proposalStatus: 'kept', actionReason: 'ZACHOVANÁ SMLOUVA – držíme kvůli bezvýlukovému krytí ZO 500 000 Kč sjednanému před rokem 2021 (kardio anamnéza).',
          items: { smrt: 10000, zavOn: 500000 },
          conditions: { contractType: 'risk', pnFromDay: 29, pnRetroactive: false, tnProgression: 400, invPsychIncluded: true, paymentFrequency: 'monthly' },
          note: 'Zachováno – problémy se srdcem 2021' },
        { id: 'n2', clientId: 'c1', insurer: 'ČSOB Pojišťovna', contractNo: '3117104', start: 2014, end: 2045, premium: 100,
          proposalStatus: 'kept', actionReason: 'ZACHOVANÁ SMLOUVA – doplňková částka na smrt 100 000 Kč za 100 Kč/měs.',
          items: { smrt: 100000 },
          conditions: { contractType: 'capital', tnProgression: 100, paymentFrequency: 'monthly' },
          note: 'Zachováno beze změny' },
        { id: 'n3', clientId: 'c1', insurer: 'Uniqa', contractNo: 'NÁVRH-UNI-001', start: 2026, end: 2056, premium: 1890,
          proposalStatus: 'new', actionReason: 'NOVÁ HLAVNÍ SMLOUVA (Život & Radost) – plně zajišťuje hypotéku a rodinné úvěry (6 mil. Kč), invaliditu I.–III. st., TN s progresí 1000 % a dlouhodobou PN.',
          items: { smrt: 1000000, smrtKles: 5000000, smrtUraz: 2000000, invalidita: 3000000, inv2: 3000000, inv1: 1500000, tnUraz: 1000000, tnUraz10: 1000000, uraz: 200, urazVelky: 400, hosp: 500, pn61: 500, chir: 30000 },
          conditions: { contractType: 'risk', pnFromDay: 61, pnRetroactive: true, tnProgression: 1000, invPsychIncluded: true, backPainIncluded: true, paymentFrequency: 'monthly', employerContribution: 500 },
          note: 'Nová hlavní pojistka – krytí nového i stávajícího úvěru + ochrana příjmu' },
        { id: 'n4', clientId: 'c3', insurer: 'Uniqa', contractNo: 'NÁVRH-UNI-001 (dítě)', start: 2026, end: 2044, premium: 380,
          proposalStatus: 'new', actionReason: 'NOVÉ PŘIPOJIŠTĚNÍ SYNA VILÉMA – doplněna dětská invalidita / soběstačnost 1 000 000 Kč a ošetřování dítěte 400 Kč/den.',
          items: { invalidita: 1000000, trvaleNasledkyNemoc: 1000000, zavOn: 500000, tnUraz: 1000000, uraz: 500, hosp: 500, osetrovani: 400 },
          conditions: { contractType: 'risk', tnProgression: 1000, paymentFrequency: 'monthly' },
          note: 'Komplexní dětský program v rámci rodinné smlouvy Uniqa' },
        { id: 'n5', clientId: 'c2', insurer: 'Uniqa', contractNo: 'NÁVRH-UNI-002', start: 2026, end: 2057, premium: 1269,
          proposalStatus: 'new', actionReason: 'NOVÁ SMLOUVA PRO PANÍ MARTINU – zajištění smrti (3,2 mil. Kč), invalidity I.–III. st. (až 3 mil. Kč), závažných onemocnění (500 tis. Kč) a ošetřování dětí.',
          items: { smrt: 700000, smrtKles: 2500000, invalidita: 3000000, inv2: 3000000, inv1: 1000000, zavOn: 500000, tnUraz: 500000, tnUraz10: 1000000, uraz: 200, urazVelky: 300, hosp: 500, osetrovani: 300, chir: 30000 },
          conditions: { contractType: 'risk', pnFromDay: 29, pnRetroactive: true, tnProgression: 1000, invPsychIncluded: true, backPainIncluded: true, paymentFrequency: 'monthly' },
          note: 'Nová komplexní pojistka pro paní Martinu' },
        { id: 'n6', clientId: 'c4', insurer: 'ČSOB Pojišťovna', contractNo: '1317491203-D2', start: 2020, end: 2053, premium: 777,
          proposalStatus: 'kept', actionReason: 'ZACHOVÁNO – stávající dětské připojištění syna Tobiáše ponecháno v platnosti.',
          items: { zavOn: 500000, tnUraz: 1000000, uraz: 500, hosp: 500 },
          conditions: { contractType: 'risk', tnProgression: 500, paymentFrequency: 'monthly' },
          note: 'Zachované dětské připojištění Tobiáše' }
    ],
    loans: [
        { id: 'l1', name: 'ČMSS – stávající hypotéka 1', amount: 450000,  monthlyPayment: 3200,  interestRate: 4.2, remainingYears: 14, linkedClientId: 'c1' },
        { id: 'l2', name: 'ČMSS – stávající hypotéka 2', amount: 450000,  monthlyPayment: 3200,  interestRate: 4.2, remainingYears: 14, linkedClientId: 'c1' },
        { id: 'l3', name: 'Nová hypotéka na bydlení',     amount: 2500000, monthlyPayment: 13400, interestRate: 4.6, remainingYears: 25, linkedClientId: 'c1' },
        { id: 'l4', name: 'Půjčka v rodině (od rodičů)',  amount: 2500000, monthlyPayment: 6500,  interestRate: 0.0, remainingYears: 20, linkedClientId: 'c1' }
    ],
    scenario: {
        person: 'c1',
        preset: 'fracture',
        pnDays: 90,
        hospDays: 5,
        ocrDays: 0,
        injury: 'minor',
        retroactive: true,
        tnDamagePct: 35,
        includeCriticalIllness: false,
        includeDisability3: false
    },
    adviserBrief: 'Pokud platíme cca 3 126 Kč dnes za celou rodinu a vůbec nejsme kryti na úvěry a invaliditu, jsme ochotni platit max. o 2 000–2 500 Kč měsíčně navíc. Chceme být ale plně kryti na nový úvěr ve výši 5 000 000 Kč (hypotéka + půjčka od rodičů) a na stávající úvěry (900 000 Kč), mít kvalitní krytí invalidity I.–III. stupně, vážných úrazů, trvalých následků s progresí a dlouhodobé pracovní neschopnosti. Zásadní požadavek: nesahat na smlouvu ČSOB č. 1317491203, kde je pán pojištěn na závažná onemocnění před rokem 2021 (z důvodu prodělaných potíží se srdcem v r. 2021).',
    advisorRecommendation: 'Doporučujeme provést cílenou rekonstrukci rodinného portfolia: 1) Ponechat beze změny klíčovou smlouvu ČSOB č. 1317491203 (kde má pán Hozna kryta závažná onemocnění 500 000 Kč sjednaná před kardiologickým nálezem v r. 2021) včetně připojištění syna Tobiáše a drobnou smlouvu 3117104. 2) Sjednat novou smlouvu UNIQA Život & Radost pro pána, paní Martinu a syna Viléma, která vyřeší kritické podpojištění úvěrů (navýšení krytí smrti ze 120 tis. Kč na 6,11 mil. Kč u pána a 3,2 mil. Kč u paní) a doplní dosud chybějící invaliditu I.–III. stupně (3 mil. Kč). 3) Teprve po potvrzení přijetí nové smlouvy UNIQA do pojištění vypovědět 4 staré, čistě úrazové a nákladově neefektivní smlouvy.',
    advisorCompany: 'MyPlans',
    advisorIco: '',
    advisorPhone: '',
    advisorEmail: '',
    modelId: 'MOD-2026-01'
};

/* Vystavíme do window pro insurance-app.js i tisk.html */
window.INSURANCE_DATA = {
    CATEGORY_GROUPS,
    GROUP_BY_KEY,
    CATEGORIES: INSURANCE_CATEGORIES,
    CATEGORY_BY_KEY,
    STATUTORY_2026,
    SICKLEAVE_BRACKETS,
    SICKLEAVE_CAP,
    sickLeaveRate,
    computeNetIncome,
    computeExactSickLeave,
    computeStateDisabilityPension,
    computeTnProgressionMultiplier,
    INSURERS,
    INSURER_NAMES,
    CONTRACT_ACTIONS,
    LEGAL_FRAMEWORK,
    SAMPLE_DATA
};
