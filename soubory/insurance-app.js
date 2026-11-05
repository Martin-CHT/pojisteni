/* ════════════════════════════════════════════════════════════════════
   insurance-app.js
   Hlavní aplikační logika „Insurance Terminal v2026"
   - 32 pojistných kategorií v 6 skupinách rizik
   - Rozhodovací štítky smluv (PONECHAT / UPRAVIT / VYPOVĚDĚT / SLOUČIT / NOVÁ)
   - Kalkulačka potřebného krytí (Needs & Gap Engine dle ČSSZ 2026)
   - Simulátor progrese trvalých následků úrazu (100 % až 1000 %)
   - Index kvality zajištění (Health Score 0–100 %) & Radarový profil 5 pilířů
   - Daňový a benefitní kalkulátor (limit 48 000 Kč / 50 000 Kč)
   ════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    const STORAGE_KEY = 'insurance_compare_data';
    const D = window.INSURANCE_DATA;

    /* ════════════ HELPERS ════════════ */
    function uid()        { return 'x' + Math.random().toString(36).slice(2, 10); }
    function clone(o)     { return JSON.parse(JSON.stringify(o)); }
    function num(v)       { v = parseFloat(v); return isNaN(v) ? 0 : v; }
    function fmt(n) {
        n = Math.round(num(n));
        return n.toLocaleString('cs-CZ', { maximumFractionDigits: 0 });
    }
    function fmtCZK(n) {
        return fmt(n) + ' Kč';
    }
    function fmtCZKShort(n) {
        n = num(n);
        if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + ' mil.';
        if (Math.abs(n) >= 1e3) return Math.round(n / 1e3) + ' tis.';
        return Math.round(n) + '';
    }
    function fmtCatValue(v, cat) {
        v = num(v);
        if (!v) return '—';
        if (cat.kind === 'daily') return v.toLocaleString('cs-CZ') + ' Kč/d';
        if (cat.kind === 'monthly') return v.toLocaleString('cs-CZ') + ' Kč/m';
        return fmtCZK(v);
    }
    function fmtCatShort(v, cat) {
        v = num(v);
        if (!v) return '·';
        if (cat.kind === 'daily') return v + '/d';
        if (cat.kind === 'monthly') return fmtCZKShort(v) + '/m';
        return fmtCZKShort(v);
    }
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g,
            c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function toast(msg, type) {
        const div = document.createElement('div');
        div.className = 'toast toast-' + (type || 'info');
        div.textContent = msg;
        const c = document.getElementById('toastContainer');
        if (c) c.appendChild(div);
        setTimeout(() => { div.style.opacity = '0'; div.style.transform = 'translateY(8px)'; div.style.transition = 'all .25s'; }, 3000);
        setTimeout(() => div.remove(), 3300);
    }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function getCookie(name) {
        try {
            const m = document.cookie.split('; ').find(r => r.startsWith(name + '='));
            return m ? decodeURIComponent(m.split('=')[1]) : '';
        } catch (e) { return ''; }
    }
    function setCookie(name, val, days) {
        try {
            const exp = new Date(Date.now() + (days || 365) * 86400000).toUTCString();
            document.cookie = name + '=' + encodeURIComponent(val || '') + '; expires=' + exp + '; path=/; SameSite=Lax';
        } catch (e) {}
    }

    function isChildPerson(c) {
        if (!c) return false;
        if (c.role === 'child') return true;
        if (c.role === 'adult') return false;
        const yr = num(c.birthYear);
        const curY = new Date().getFullYear();
        return yr > 0 && (curY - yr) < 18 && num(c.incomeGross) === 0;
    }

    /* ════════════ DATA STORE ════════════ */
    const DEFAULT_LOGO_URL = 'https://martin-cht.github.io/pojisteni/soubory/logo.png';
    const DEFAULT_COMPANY = 'MyPlans';
    let tableColMode = 'active'; // 'active' | 'core' | 'all'

    const emptyContract = (clientId, which) => ({
        id: uid(),
        clientId: clientId || '',
        insurer: '',
        contractNo: '',
        start: new Date().getFullYear(),
        end: null,
        premium: 0,
        actionStatus: which === 'current' ? 'keep' : undefined,
        proposalStatus: which === 'proposed' ? 'new' : undefined,
        actionReason: '',
        items: Object.fromEntries(D.CATEGORIES.map(c => [c.key, 0])),
        itemPremiums: Object.fromEntries(D.CATEGORIES.map(c => [c.key, 0])),
        conditions: {
            contractType: 'risk',
            pnWaitingDays: 29,
            pnFromDay: 29,
            pnRetroactive: false,
            hospWaitingDays: 0,
            criticalIllnessWaitingMonths: 2,
            tnProgression: 800,
            invPsychIncluded: true,
            backPainIncluded: true,
            garanceTabulek: false,
            occupationCategory: '1',
            paymentFrequency: 'monthly',
            employerContribution: 0,
            taxDeductibleAnnual: 0
        },
        note: ''
    });

    function defaultState() {
        return {
            clients: [],
            currentContracts: [],
            proposedContracts: [],
            loans: [],
            scenario: {
                person: '',
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
            adviserBrief: '',
            advisorRecommendation: '',
            advisorName: getCookie('insurance_advisor_name') || '',
            advisorCompany: getCookie('insurance_advisor_company') || DEFAULT_COMPANY,
            advisorIco: getCookie('insurance_advisor_ico') || '',
            advisorPhone: getCookie('insurance_advisor_phone') || '',
            advisorEmail: getCookie('insurance_advisor_email') || '',
            modelId: getCookie('insurance_model_id') || ('MOD-' + new Date().getFullYear() + '-01'),
            logoUrl: getCookie('insurance_logo_url') || DEFAULT_LOGO_URL
        };
    }

    let state = defaultState();

    function normalizeLoadedState(parsed) {
        const base = defaultState();
        state = Object.assign(base, parsed || {});
        state.scenario = Object.assign(base.scenario, (parsed && parsed.scenario) || {});
        if (!state.logoUrl || !state.logoUrl.trim()) {
            state.logoUrl = getCookie('insurance_logo_url') || DEFAULT_LOGO_URL;
        }
        if (!state.advisorName || !state.advisorName.trim()) {
            state.advisorName = getCookie('insurance_advisor_name') || '';
        }
        if (!state.advisorCompany || !state.advisorCompany.trim() || state.advisorCompany === 'Finanční & Pojistné Poradenství') {
            state.advisorCompany = getCookie('insurance_advisor_company') || DEFAULT_COMPANY;
        }
        (state.clients || []).forEach(c => {
            if (!c.role) c.role = isChildPerson(c) ? 'child' : 'adult';
            if (c.expensesMonthly == null) c.expensesMonthly = c.role === 'adult' ? Math.round(num(c.incomeGross) * 0.5) : 0;
            if (c.reserveCash == null) c.reserveCash = 0;
            if (c.occupationRisk == null) c.occupationRisk = c.role === 'child' ? 'Dítě' : '1';
        });
        /* Automatické doplnění všech kategorií, pojistného za položku a defaultních štítků pro existující smlouvy */
        const keptContractNos = new Set((state.proposedContracts || []).map(c => (c.contractNo || '').trim()).filter(Boolean));
        const ensureContractItemPrems = (c) => {
            c.items = c.items || {};
            c.itemPremiums = c.itemPremiums || {};
            D.CATEGORIES.forEach(cat => {
                if (c.items[cat.key] == null) c.items[cat.key] = 0;
                if (c.itemPremiums[cat.key] == null) c.itemPremiums[cat.key] = 0;
            });
            const sumIP = D.CATEGORIES.reduce((s, cat) => s + num(c.itemPremiums[cat.key]), 0);
            const hasActiveItems = D.CATEGORIES.some(cat => num(c.items[cat.key]) > 0);
            if (sumIP === 0 && num(c.premium) > 0 && hasActiveItems && D.estimateItemPremiums) {
                c.itemPremiums = D.estimateItemPremiums(c.items, contractMonthlyPremium(c));
            } else if (num(c.premium) === 0 && sumIP > 0) {
                c.premium = Math.round(sumIP);
            }
        };
        (state.currentContracts || []).forEach(c => {
            c.conditions = Object.assign({
                contractType: 'risk', pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: false,
                hospWaitingDays: 0, criticalIllnessWaitingMonths: 2, tnProgression: 400,
                invPsychIncluded: true, backPainIncluded: false, paymentFrequency: 'monthly',
                employerContribution: 0, taxDeductibleAnnual: 0
            }, c.conditions || {});
            ensureContractItemPrems(c);
            if (!c.actionStatus) {
                c.actionStatus = (c.contractNo && keptContractNos.has(c.contractNo.trim())) ? 'keep' : 'cancel';
            }
            if (c.actionReason == null) c.actionReason = c.note || '';
        });
        const curContractNos = new Set((state.currentContracts || []).map(c => (c.contractNo || '').trim()).filter(Boolean));
        (state.proposedContracts || []).forEach(c => {
            c.conditions = Object.assign({
                contractType: 'risk', pnWaitingDays: 29, pnFromDay: 29, pnRetroactive: true,
                hospWaitingDays: 0, criticalIllnessWaitingMonths: 2, tnProgression: 800,
                invPsychIncluded: true, backPainIncluded: true, paymentFrequency: 'monthly',
                employerContribution: 0, taxDeductibleAnnual: 0
            }, c.conditions || {});
            ensureContractItemPrems(c);
            if (!c.proposalStatus) {
                const isExisting = (c.contractNo && curContractNos.has(c.contractNo.trim())) || /zachov/i.test(c.note || '');
                c.proposalStatus = isExisting ? 'kept' : 'new';
            }
            if (c.actionReason == null) c.actionReason = c.note || '';
        });
    }

    function load() {
        try {
            const raw = lsGet(STORAGE_KEY);
            if (raw) {
                normalizeLoadedState(JSON.parse(raw));
            } else {
                normalizeLoadedState(clone(D.SAMPLE_DATA));
                save();
            }
        } catch (e) {
            console.warn('Load error:', e);
            normalizeLoadedState(clone(D.SAMPLE_DATA));
        }
    }

    function save() {
        try { lsSet(STORAGE_KEY, JSON.stringify(state)); } catch (e) { toast('Chyba ukládání: ' + e.message, 'error'); }
        updateStoragePreview();
    }

    function loadSampleData() {
        if (!confirm('Načíst vzorovou modelaci rodiny (Hozna / Martina / Vilém / Tobiáš) se všemi rozšířenými daty? Přepíše současný stav.')) return;
        normalizeLoadedState(clone(D.SAMPLE_DATA));
        save();
        renderAll();
        toast('Vzorová modelace načtena', 'success');
    }

    /* ════════════ TABS ════════════ */
    function switchTab(name) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('tab-active', b.dataset.tab === name));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('hidden', p.id !== 'pane-' + name));
        if (name === 'srovnani')  renderComparison();
        if (name === 'scenar')    { renderScenario(); renderTnProgressionSim(); }
        if (name === 'modelace')  { renderNeedsAnalysis(); renderTaxBenefitCalculator(); }
        if (name === 'pravo')     renderLegal();
        if (name === 'nastaveni') renderSettings();
        if (name === 'ai')        renderAiPanel();
        if (window.lucide) lucide.createIcons();
    }

    /* ════════════ PREMIUM, SUMS & HEALTH SCORE ENGINE ════════════ */
    function contractMonthlyPremium(c) {
        const p = num(c.premium);
        const f = c.conditions && c.conditions.paymentFrequency;
        if (f === 'yearly') return p / 12;
        if (f === 'quarterly') return p / 3;
        if (f === 'singlepay') return 0;
        return p;
    }
    function contractItemPremium(c, key) {
        return num(c && c.itemPremiums && c.itemPremiums[key]);
    }
    function sumContractItemPremiums(c) {
        return D.CATEGORIES.reduce((s, cat) => s + contractItemPremium(c, cat.key), 0);
    }
    function totalPremiumMonthly(list) {
        return (list || []).reduce((s, c) => s + contractMonthlyPremium(c), 0);
    }
    function totalEmployerBenefitMonthly(list) {
        return (list || []).reduce((s, c) => s + num(c.conditions && c.conditions.employerContribution), 0);
    }
    function sumItem(list, key) {
        return (list || []).reduce((s, c) => s + num(c.items && c.items[key]), 0);
    }
    function sumItemFor(list, clientId, key) {
        return (list || []).filter(c => c.clientId === clientId).reduce((s, c) => s + num(c.items && c.items[key]), 0);
    }
    function sumItemPremium(list, key) {
        return (list || []).reduce((s, c) => s + contractItemPremium(c, key), 0);
    }
    function sumItemPremiumFor(list, clientId, key) {
        return (list || []).filter(c => c.clientId === clientId).reduce((s, c) => s + contractItemPremium(c, key), 0);
    }
    function sumGroupPremium(list, groupKey, clientId) {
        const filtered = (clientId && clientId !== 'ALL') ? (list || []).filter(c => c.clientId === clientId) : (list || []);
        const grpCats = D.CATEGORIES.filter(cat => cat.group === groupKey);
        return filtered.reduce((s, c) => s + grpCats.reduce((gs, cat) => gs + contractItemPremium(c, cat.key), 0), 0);
    }
    function sumLoans() {
        return (state.loans || []).reduce((s, l) => s + num(l.amount), 0);
    }
    function sumLoansFor(clientId) {
        return (state.loans || []).filter(l => l.linkedClientId === clientId).reduce((s, l) => s + num(l.amount), 0);
    }
    function sumLoansMonthly() {
        return (state.loans || []).reduce((s, l) => s + num(l.monthlyPayment), 0);
    }

    /* Efektivní krytí klíčových oblastí (zohledňuje konstantní + klesající složky) */
    function effectiveDeathCover(list, clientId) {
        const f = clientId ? list.filter(c => c.clientId === clientId) : list;
        return sumItem(f, 'smrt') + sumItem(f, 'smrtKles');
    }
    function effectiveInv3Cover(list, clientId) {
        const f = clientId ? list.filter(c => c.clientId === clientId) : list;
        return sumItem(f, 'invalidita') + sumItem(f, 'invKles') + sumItem(f, 'invRenta') * 120;
    }
    function effectiveInv2Cover(list, clientId) {
        const f = clientId ? list.filter(c => c.clientId === clientId) : list;
        /* Pokud je samostatně zadána inv2 nebo inv2Kles (k úvěru) */
        const direct = sumItem(f, 'inv2') + sumItem(f, 'inv2Kles');
        if (direct > 0) return direct;
        const loanInv = sumItem(f, 'invKles');
        return loanInv > 0 ? loanInv : sumItem(f, 'invalidita') * 0.5;
    }
    function effectiveInv1Cover(list, clientId) {
        const f = clientId ? list.filter(c => c.clientId === clientId) : list;
        return sumItem(f, 'inv1');
    }
    function effectiveZoCover(list, clientId) {
        const f = clientId ? list.filter(c => c.clientId === clientId) : list;
        return sumItem(f, 'zavOn') + sumItem(f, 'zavOnKles') + sumItem(f, 'zavOnMuzZena');
    }
    function effectiveTnCover(list, clientId) {
        const f = clientId ? list.filter(c => c.clientId === clientId) : list;
        return sumItem(f, 'tnUraz') + sumItem(f, 'tnUraz10');
    }
    function effectivePnDaily(list, clientId) {
        const f = clientId ? list.filter(c => c.clientId === clientId) : list;
        return sumItem(f, 'pn15') + sumItem(f, 'pn28') + sumItem(f, 'pn61');
    }

    /* Výpočet doporučených cílových hodnot (Needs Model) pro osobu */
    function computeRecommendedNeeds(person, opts) {
        opts = opts || {};
        const deathYears = num(opts.deathYears) || 2;
        const invYearsKey = opts.invYears || '10';
        const zoMonths = num(opts.zoMonths) || 12;
        const pnTargetPct = num(opts.pnTargetPct) || 0.90;

        const isChild = isChildPerson(person);
        const gross = num(person.incomeGross);
        const net = D.computeNetIncome(gross, person.isEntrepreneur);
        const loans = sumLoansFor(person.id);
        const reserve = num(person.reserveCash);
        const sick = D.computeExactSickLeave(gross, person.isEntrepreneur, 60);
        const pens = D.computeStateDisabilityPension(gross, person.isEntrepreneur, person.birthYear);

        if (isChild) {
            return {
                isChild: true,
                netIncome: 0,
                loans: 0,
                sickMonthly: 0,
                pens,
                targets: {
                    smrtTotal: 0,
                    smrtConst: 0,
                    smrtKles: 0,
                    inv3: 2000000,
                    inv2: 2000000,
                    inv1: 1000000,
                    trvaleNasledkyNemoc: 1000000,
                    zavOn: 500000,
                    tnUraz: 1000000,
                    tnUraz10: 1000000,
                    uraz: 300,
                    hosp: 500,
                    osetrovani: 400,
                    pnDaily: 0
                }
            };
        }

        /* Dospělý */
        const familyBuffer = Math.max(200000, Math.round(net * 12 * deathYears - reserve));
        const smrtKlesTarget = Math.round(loans);
        const smrtConstTarget = Math.round(familyBuffer / 100000) * 100000;
        const smrtTotalTarget = smrtKlesTarget + smrtConstTarget;

        /* Propad v invaliditě */
        const gapInv3Monthly = Math.max(0, net - pens.inv3);
        const gapInv2Monthly = Math.max(0, net - pens.inv2);
        const gapInv1Monthly = Math.max(0, (net * 0.8) - pens.inv1);

        let invMultMonths = 120; // 10 let
        if (invYearsKey === '5') invMultMonths = 60;
        else if (invYearsKey === '15') invMultMonths = 180;
        else if (invYearsKey === 'to65') {
            const age = person.birthYear ? Math.max(20, new Date().getFullYear() - num(person.birthYear)) : 38;
            const yrsTo65 = Math.max(5, 65 - age);
            /* Diskontovaný rentiérský faktor při 4,5 % p.a. reálně cca 3 % nad inflací */
            const r = 0.03;
            const pvFactor = (1 - Math.pow(1 + r, -yrsTo65)) / r;
            invMultMonths = Math.round(pvFactor * 12);
        }

        const inv3Target = Math.max(1000000, Math.round((loans * 0.8 + gapInv3Monthly * invMultMonths - reserve * 0.5) / 100000) * 100000);
        const inv2Target = Math.max(1000000, Math.round((loans * 0.6 + gapInv2Monthly * invMultMonths * 0.85) / 100000) * 100000);
        const inv1Target = Math.max(500000,  Math.round((gapInv1Monthly * Math.min(84, invMultMonths * 0.6)) / 100000) * 100000);

        const zavOnTarget = Math.max(500000, Math.round((net * zoMonths + loans * 0.15) / 100000) * 100000);
        const tnUrazTarget = 1000000;
        const tnUraz10Target = 1000000;

        /* Denní propad v PN */
        const targetMonthlyInPn = net * pnTargetPct;
        const monthlyGapPn = Math.max(0, targetMonthlyInPn - sick.monthlyAvg);
        const pnDailyTarget = Math.max(0, Math.round((monthlyGapPn / 30) / 50) * 50);

        return {
            isChild: false,
            netIncome: net,
            loans,
            sickMonthly: sick.monthlyAvg,
            sick,
            pens,
            gapInv3Monthly,
            gapInv2Monthly,
            gapInv1Monthly,
            monthlyGapPn,
            targets: {
                smrtTotal: smrtTotalTarget,
                smrtConst: smrtConstTarget,
                smrtKles: smrtKlesTarget,
                inv3: inv3Target,
                inv2: inv2Target,
                inv1: inv1Target,
                trvaleNasledkyNemoc: 0,
                zavOn: zavOnTarget,
                tnUraz: tnUrazTarget,
                tnUraz10: tnUraz10Target,
                uraz: 200,
                hosp: 500,
                osetrovani: 300,
                pnDaily: pnDailyTarget
            }
        };
    }

    /* Výpočet 5 pilířů ochrany (0–100 %) pro radarový graf a Health Score */
    function computePortfolioPillars(list, filterPersonId) {
        const persons = filterPersonId && filterPersonId !== 'ALL'
            ? state.clients.filter(c => c.id === filterPersonId)
            : state.clients;

        if (!persons.length) {
            return { scores: [0, 0, 0, 0, 0], overall: 0 };
        }

        let sumP1 = 0, sumP2 = 0, sumP3 = 0, sumP4 = 0, sumP5 = 0;
        let adultCount = 0;

        persons.forEach(p => {
            const needs = computeRecommendedNeeds(p);
            const t = needs.targets;
            const pContracts = (list || []).filter(c => c.clientId === p.id);

            /* Pilíř 1: Smrt a úvěry */
            let s1 = 100;
            if (!needs.isChild) {
                adultCount++;
                const haveDeath = effectiveDeathCover(list, p.id);
                s1 = t.smrtTotal > 0 ? Math.min(100, Math.round((haveDeath / t.smrtTotal) * 100)) : 100;
            }
            /* Pilíř 2: Invalidita I.–III. st. a soběstačnost */
            const haveInv3 = effectiveInv3Cover(list, p.id) + sumItemFor(list, p.id, 'trvaleNasledkyNemoc');
            const haveInv2 = effectiveInv2Cover(list, p.id);
            const haveInv1 = effectiveInv1Cover(list, p.id);
            const s2_3 = t.inv3 > 0 ? Math.min(100, (haveInv3 / t.inv3) * 100) : 100;
            const s2_2 = t.inv2 > 0 ? Math.min(100, (haveInv2 / t.inv2) * 100) : 100;
            const s2_1 = t.inv1 > 0 ? Math.min(100, (haveInv1 / t.inv1) * 100) : 100;
            const s2 = Math.round(s2_3 * 0.5 + s2_2 * 0.3 + s2_1 * 0.2);

            /* Pilíř 3: Závažná onemocnění & Trvalé následky úrazu */
            const haveZo = effectiveZoCover(list, p.id);
            const haveTn = effectiveTnCover(list, p.id);
            const s3_zo = t.zavOn > 0 ? Math.min(100, (haveZo / t.zavOn) * 100) : 100;
            const s3_tn = t.tnUraz > 0 ? Math.min(100, (haveTn / t.tnUraz) * 100) : 100;
            const s3 = Math.round(s3_zo * 0.55 + s3_tn * 0.45);

            /* Pilíř 4: Krátkodobý příjem (PN, Hospitalizace, OČR) */
            const havePn = effectivePnDaily(list, p.id);
            const haveHosp = sumItemFor(list, p.id, 'hosp') + sumItemFor(list, p.id, 'hospUraz');
            const haveOcr = sumItemFor(list, p.id, 'osetrovani');
            const s4_pn = t.pnDaily > 0 ? Math.min(100, (havePn / t.pnDaily) * 100) : 85;
            const s4_hosp = t.hosp > 0 ? Math.min(100, (haveHosp / t.hosp) * 100) : 100;
            const s4_ocr = haveOcr > 0 ? 100 : 50;
            const s4 = needs.isChild
                ? Math.round(s4_hosp * 0.6 + s4_ocr * 0.4)
                : Math.round(s4_pn * 0.6 + s4_hosp * 0.25 + s4_ocr * 0.15);

            /* Pilíř 5: Kvalita podmínek (progrese TN >= 800 %, psychika kryta, čistě rizikové) */
            let s5 = 40;
            if (pContracts.length > 0) {
                const maxProg = Math.max(...pContracts.map(c => num(c.conditions && c.conditions.tnProgression) || 100));
                const hasPsych = pContracts.some(c => c.conditions && c.conditions.invPsychIncluded);
                const hasRetro = pContracts.some(c => c.conditions && c.conditions.pnRetroactive);
                const isRisk = pContracts.some(c => !c.conditions || c.conditions.contractType === 'risk');
                s5 = (maxProg >= 800 ? 35 : maxProg >= 500 ? 22 : 10)
                   + (hasPsych ? 25 : 5)
                   + (hasRetro ? 20 : 10)
                   + (isRisk ? 20 : 5);
            } else {
                s5 = 0;
            }

            if (!needs.isChild) sumP1 += s1;
            sumP2 += s2;
            sumP3 += s3;
            sumP4 += s4;
            sumP5 += s5;
        });

        const n = persons.length;
        const p1 = adultCount > 0 ? Math.round(sumP1 / adultCount) : Math.round(sumP2 / n);
        const p2 = Math.round(sumP2 / n);
        const p3 = Math.round(sumP3 / n);
        const p4 = Math.round(sumP4 / n);
        const p5 = Math.round(sumP5 / n);
        const overall = Math.round(p1 * 0.28 + p2 * 0.27 + p3 * 0.20 + p4 * 0.15 + p5 * 0.10);

        return {
            labels: ['Smrt & Úvěry', 'Invalidita I.–III.', 'Závažné nemoci & TN', 'PN, OČR & Nemocnice', 'Kvalita podmínek'],
            scores: [p1, p2, p3, p4, p5],
            overall
        };
    }

    /* ════════════ KPI RENDER ════════════ */
    function renderKPIs() {
        const curM = totalPremiumMonthly(state.currentContracts);
        const newM = totalPremiumMonthly(state.proposedContracts);
        const empBen = totalEmployerBenefitMonthly(state.proposedContracts);
        const netClientM = Math.max(0, newM - empBen);

        document.getElementById('kpiCurrentMonthly').textContent = fmtCZK(curM) + ' / měs';
        document.getElementById('kpiCurrentYearly').textContent  = fmtCZK(curM * 12) + ' / rok';
        document.getElementById('kpiProposedMonthly').textContent = fmtCZK(newM) + ' / měs';
        document.getElementById('kpiProposedYearly').textContent  =
            empBen > 0 ? `${fmtCZK(newM * 12)}/r (klient: ${fmtCZK(netClientM)}/m)` : `${fmtCZK(newM * 12)} / rok`;

        const diff = newM - curM;
        const diffEl = document.getElementById('kpiDiffMonthly');
        diffEl.textContent = (diff >= 0 ? '+' : '') + fmtCZK(diff);
        diffEl.className = 'stat-value ' + (diff > 0 ? 'text-amber-300' : diff < 0 ? 'text-emerald-300' : 'text-slate-300');
        const pct = curM > 0 ? (diff / curM * 100) : (newM > 0 ? 100 : 0);
        document.getElementById('kpiDiffPct').textContent = (pct >= 0 ? '+' : '') + pct.toFixed(0) + ' % (' + (diff * 12 >= 0 ? '+' : '') + fmtCZK(diff * 12) + '/r)';

        /* Krytí závazků (Smrt + Smrt klesající vs. Úvěry) */
        const loanTotal = sumLoans();
        const curDeath = effectiveDeathCover(state.currentContracts);
        const newDeath = effectiveDeathCover(state.proposedContracts);
        const under = Math.max(0, loanTotal - newDeath);
        const underEl = document.getElementById('kpiUnderinsured');
        if (loanTotal === 0) {
            underEl.textContent = fmtCZKShort(newDeath);
            underEl.className = 'stat-value text-sky-300';
            document.getElementById('kpiUnderinsuredLabel').textContent = 'Bez úvěrů · Celková smrt v návrhu';
        } else if (under === 0) {
            underEl.textContent = '100 % KRYTO';
            underEl.className = 'stat-value text-emerald-300';
            document.getElementById('kpiUnderinsuredLabel').textContent = `Dnes ${fmtCZKShort(curDeath)} → Návrh ${fmtCZKShort(newDeath)} (úvěry ${fmtCZKShort(loanTotal)})`;
        } else {
            underEl.textContent = 'Chybí ' + fmtCZKShort(under);
            underEl.className = 'stat-value text-rose-300';
            document.getElementById('kpiUnderinsuredLabel').textContent = `Návrh ${fmtCZKShort(newDeath)} vs. úvěry ${fmtCZKShort(loanTotal)}`;
        }

        /* Index kvality zajištění (Health Score) */
        const curPillars = computePortfolioPillars(state.currentContracts, 'ALL');
        const newPillars = computePortfolioPillars(state.proposedContracts, 'ALL');
        document.getElementById('kpiHealthScore').textContent = `${curPillars.overall} % → ${newPillars.overall} %`;
        const covCurr = D.CATEGORIES.filter(c => sumItem(state.currentContracts, c.key) > 0).length;
        const covNew  = D.CATEGORIES.filter(c => sumItem(state.proposedContracts, c.key) > 0).length;
        document.getElementById('kpiCategoriesCoveredLabel').textContent = `Rizika: ${covCurr} → ${covNew} z ${D.CATEGORIES.length}`;

        /* Akční plán smluv */
        const keptCount = state.currentContracts.filter(c => c.actionStatus === 'keep' || c.actionStatus === 'modify').length;
        const cancelCount = state.currentContracts.filter(c => c.actionStatus === 'cancel' || c.actionStatus === 'consolidate').length;
        const newCount = state.proposedContracts.filter(c => c.proposalStatus === 'new').length;
        document.getElementById('kpiClientCount').textContent = `${state.clients.length} osob · ${state.proposedContracts.length} sml.`;
        document.getElementById('kpiContractCount').textContent = `${keptCount} ponechat · ${cancelCount} zrušit · ${newCount} nové`;

        /* Top nav stats */
        document.getElementById('navClients').textContent = state.clients.length;
        document.getElementById('navCurrentCount').textContent = state.currentContracts.length;
        document.getElementById('navProposedCount').textContent = state.proposedContracts.length;
        document.getElementById('navDiff').textContent = (diff >= 0 ? '+' : '') + fmtCZK(diff);
        const navScore = document.getElementById('navScore');
        if (navScore) navScore.textContent = `${curPillars.overall} → ${newPillars.overall} %`;
    }

    /* ════════════ CLIENTS ════════════ */
    function renderClients() {
        const container = document.getElementById('clientsList');
        if (!state.clients.length) {
            container.innerHTML = `<div class="text-xs text-slate-500 italic text-center py-8 border border-dashed border-slate-800 rounded">
                Žádné pojištěné osoby — přidejte dospělého nebo dítě tlačítkem nahoře.
            </div>`;
            return;
        }
        const curYear = new Date().getFullYear();
        container.innerHTML = state.clients.map(c => {
            const isChild = isChildPerson(c);
            const age = c.birthYear ? (curYear - num(c.birthYear)) : null;
            const net = D.computeNetIncome(c.incomeGross, c.isEntrepreneur);
            const sick = D.computeExactSickLeave(c.incomeGross, c.isEntrepreneur, 30);
            const pens = D.computeStateDisabilityPension(c.incomeGross, c.isEntrepreneur, c.birthYear);
            const gapPn = Math.max(0, net - sick.monthlyAvg);
            const gapInv3 = Math.max(0, net - pens.inv3);

            return `
            <div class="client-card ${isChild ? 'child-card' : ''}">
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5 items-end">
                    <label class="block lg:col-span-2">
                        <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Jméno a příjmení / role</span>
                        <div class="flex gap-1.5">
                            <select class="pro-input" style="width:95px" onchange="app.updateClient('${c.id}', 'role', this.value)">
                                <option value="adult" ${!isChild ? 'selected' : ''}>👤 Dospělý</option>
                                <option value="child" ${isChild ? 'selected' : ''}>🧸 Dítě</option>
                            </select>
                            <input type="text" class="pro-input" value="${escapeHtml(c.name)}"
                                onchange="app.updateClient('${c.id}', 'name', this.value)">
                        </div>
                    </label>
                    <label class="block">
                        <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Rok nar. ${age != null ? `<span class="text-sky-400">(${age} let)</span>` : ''}</span>
                        <input type="number" class="pro-input" value="${c.birthYear || ''}" min="1920" max="2030" placeholder="např. 1985"
                            onchange="app.updateClient('${c.id}', 'birthYear', this.value)">
                    </label>
                    <label class="block">
                        <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Hrubý příjem / měs (Kč)</span>
                        <input type="number" class="pro-input" value="${c.incomeGross || 0}" min="0" step="1000" ${isChild ? 'disabled' : ''}
                            onchange="app.updateClient('${c.id}', 'incomeGross', this.value)">
                    </label>
                    <label class="block">
                        <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Měs. výdaje / podíl (Kč)</span>
                        <input type="number" class="pro-input" value="${c.expensesMonthly || 0}" min="0" step="1000" ${isChild ? 'disabled' : ''}
                            onchange="app.updateClient('${c.id}', 'expensesMonthly', this.value)">
                    </label>
                    <label class="block">
                        <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Finanční rezerva (Kč)</span>
                        <input type="number" class="pro-input" value="${c.reserveCash || 0}" min="0" step="10000"
                            onchange="app.updateClient('${c.id}', 'reserveCash', this.value)">
                    </label>
                    <div class="flex items-center justify-between gap-2 pt-3">
                        <label class="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                            <input type="checkbox" class="pro-input" ${c.isEntrepreneur ? 'checked' : ''} ${isChild ? 'disabled' : ''}
                                onchange="app.updateClient('${c.id}', 'isEntrepreneur', this.checked)">
                            <span>OSVČ</span>
                        </label>
                        <button onclick="app.removeClient('${c.id}')" class="btn-danger" title="Smazat osobu">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </div>

                <div class="mt-2 grid grid-cols-1 lg:grid-cols-3 gap-2">
                    <div class="lg:col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400 bg-slate-950/50 px-3 py-1.5 rounded border border-slate-800/80">
                        ${!isChild ? `
                            <span>Čistý příjem: <strong class="text-emerald-300 font-mono">${fmtCZK(net)}</strong></span>
                            <span>Nemocenská ČSSZ: <strong class="text-sky-300 font-mono">${fmtCZK(sick.monthlyAvg)}/měs</strong> <span class="text-rose-400">(propad -${fmtCZK(gapPn)}/m)</span></span>
                            <span>Státní ID (I./II./III.): <strong class="text-amber-300 font-mono">${fmtCZKShort(pens.inv1)} / ${fmtCZKShort(pens.inv2)} / ${fmtCZKShort(pens.inv3)} Kč</strong></span>
                            <span>Propad v Inv III: <strong class="text-rose-300 font-mono">-${fmtCZK(gapInv3)}/měs</strong></span>
                        ` : `
                            <span class="text-violet-300 font-semibold">🧸 Dětský pojistný profil:</span>
                            <span>Priorita: <strong>Dětská invalidita / soběstačnost, Závažné nemoci, Trvalé následky úrazu s progresí, Ošetřování dítěte (OČR)</strong></span>
                        `}
                    </div>
                    <div>
                        <input type="text" class="pro-input text-[11px]" placeholder="Zdravotní poznámka / povolání / sport (např. kardio 2021, RS 1)…"
                            value="${escapeHtml(c.notes || '')}" onchange="app.updateClient('${c.id}', 'notes', this.value)">
                    </div>
                </div>
            </div>`;
        }).join('');
        if (window.lucide) lucide.createIcons();
    }

    function addClient(role) {
        const isChild = role === 'child';
        const c = {
            id: uid(),
            name: (isChild ? 'Dítě ' : 'Osoba ') + (state.clients.length + 1),
            role: isChild ? 'child' : 'adult',
            incomeGross: isChild ? 0 : 45000,
            expensesMonthly: isChild ? 0 : 25000,
            reserveCash: 0,
            isEntrepreneur: false,
            birthYear: isChild ? 2018 : 1988,
            notes: ''
        };
        state.clients.push(c);
        save();
        renderAll();
        toast('Osoba přidána', 'success');
    }

    function updateClient(id, field, value) {
        const c = state.clients.find(c => c.id === id);
        if (!c) return;
        if (['incomeGross', 'birthYear', 'expensesMonthly', 'reserveCash'].includes(field)) value = num(value);
        c[field] = value;
        if (field === 'role' && value === 'child') {
            c.incomeGross = 0;
            c.expensesMonthly = 0;
            c.isEntrepreneur = false;
        }
        save();
        renderClients();
        renderKPIs();
        refreshScenarioPersons();
        refreshCompareFilter();
        refreshClientSelectors();
    }

    function removeClient(id) {
        if (!confirm('Smazat tuto osobu a všechny její smlouvy?')) return;
        state.clients = state.clients.filter(c => c.id !== id);
        state.currentContracts  = state.currentContracts.filter(s => s.clientId !== id);
        state.proposedContracts = state.proposedContracts.filter(s => s.clientId !== id);
        state.loans = state.loans.filter(l => l.linkedClientId !== id);
        save();
        renderAll();
    }

    /* ════════════ CONTRACTS TABLE & ACTIONS ════════════ */
    function clientName(id) {
        const c = state.clients.find(c => c.id === id);
        return c ? c.name : '(nepřiřazeno)';
    }

    function getVisibleCategories() {
        if (tableColMode === 'all') return D.CATEGORIES;
        if (tableColMode === 'core') return D.CATEGORIES.filter(c => c.core);
        /* 'active' mode: všechna rizika, která mají > 0 ve stávajícím NEBO v návrhu, + základní kostra */
        const baseKeys = new Set(['smrt', 'smrtKles', 'invalidita', 'inv2', 'inv1', 'zavOn', 'tnUraz', 'uraz', 'hosp', 'pn28']);
        return D.CATEGORIES.filter(c =>
            baseKeys.has(c.key) ||
            sumItem(state.currentContracts, c.key) > 0 ||
            sumItem(state.proposedContracts, c.key) > 0
        );
    }

    function setTableColMode(mode) {
        tableColMode = mode || 'active';
        const s1 = document.getElementById('colModeCurrent');
        const s2 = document.getElementById('colModeProposed');
        if (s1) s1.value = tableColMode;
        if (s2) s2.value = tableColMode;
        renderContractsGroup('current');
        renderContractsGroup('proposed');
    }

    function actionBadgeHtml(c, which) {
        const list = D.CONTRACT_ACTIONS[which] || [];
        const key = which === 'current' ? (c.actionStatus || 'keep') : (c.proposalStatus || 'new');
        const found = list.find(a => a.key === key) || list[0];
        return `<span class="badge badge-${found.badge}" title="${escapeHtml(found.desc)}">${escapeHtml(found.short)}</span>`;
    }

    function renderContractsGroup(which) {
        const container = document.getElementById(which === 'current' ? 'currentContractsContainer' : 'proposedContractsContainer');
        if (!container) return;
        const list = which === 'current' ? state.currentContracts : state.proposedContracts;
        const accent = which === 'current' ? 'emerald' : 'sky';
        const visCats = getVisibleCategories();

        if (!state.clients.length) {
            container.innerHTML = `<div class="text-xs text-slate-500 italic text-center py-8 border border-dashed border-slate-800 rounded">
                Nejprve přidejte alespoň jednu osobu v záložce <strong>1. Klient & Zadání</strong>.
            </div>`;
            return;
        }

        const groups = {};
        state.clients.forEach(c => groups[c.id] = []);
        groups['_none'] = [];
        list.forEach(c => { (groups[c.clientId] || groups['_none']).push(c); });

        const blocks = state.clients.map(person => {
            const items = groups[person.id] || [];
            const sums = visCats.map(cat => sumItemFor(list, person.id, cat.key));
            const sumPrems = visCats.map(cat => sumItemPremiumFor(list, person.id, cat.key));
            const personPremium = items.reduce((s, c) => s + contractMonthlyPremium(c), 0);
            const sumAllItemPrems = D.CATEGORIES.reduce((s, cat) => s + sumItemPremiumFor(list, person.id, cat.key), 0);

            const groupBreakdownHtml = items.length ? `
                <div class="px-3 py-2 bg-slate-950/70 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[10.5px]">
                    <span class="text-slate-400 font-semibold uppercase tracking-wide">Rozpad pojistného dle skupin rizik (${escapeHtml(person.name)}):</span>
                    <div class="flex flex-wrap items-center gap-2">
                        ${D.CATEGORY_GROUPS.map(grp => {
                            const gp = Math.round(sumGroupPremium(list, grp.key, person.id));
                            if (gp <= 0) return '';
                            const pct = personPremium > 0 ? Math.round((gp / personPremium) * 100) : 0;
                            return `<span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-slate-300">
                                <span class="text-${grp.color}-300 font-semibold">${escapeHtml(grp.short)}:</span> ${gp} Kč/m <span class="text-slate-500">(${pct}%)</span>
                            </span>`;
                        }).filter(Boolean).join('') || '<span class="text-slate-500 italic">Pojistné za položky zatím nerozpočteno</span>'}
                    </div>
                </div>` : '';

            return `
                <div class="contract-block">
                    <div class="contract-block-header">
                        <div class="flex items-center gap-2">
                            <span class="badge badge-${accent}">${escapeHtml(person.name)}</span>
                            <span class="text-[10px] text-slate-400 font-mono">${items.length} sml.</span>
                            ${person.notes ? `<span class="text-[10px] text-amber-400/90 italic hidden md:inline">· ${escapeHtml(person.notes)}</span>` : ''}
                        </div>
                        <div class="text-[11px] text-slate-300 font-mono">
                            Σ měs: <strong class="text-${accent}-300">${fmtCZK(personPremium)}</strong>
                            <span class="text-slate-500 ml-1">(${fmtCZK(personPremium * 12)}/rok)</span>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th style="min-width:190px">Pojišťovna & Smlouva</th>
                                    <th style="min-width:120px">Doporučení poradce</th>
                                    ${visCats.map(c => `<th title="${escapeHtml(c.label)} — horní řádek: pojistná částka, spodní řádek: pojistné za položku (Kč/měs)" class="num">${escapeHtml(c.mini)}</th>`).join('')}
                                    <th class="num">Platba/měs</th>
                                    <th>Akce</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${items.map(c => renderContractRow(c, which, visCats)).join('')}
                                ${!items.length ? `<tr><td colspan="${visCats.length + 4}" class="text-center text-[11px] text-slate-500 italic py-3">Žádné smlouvy pro tuto osobu.</td></tr>` : ''}
                            </tbody>
                            ${items.length ? `<tfoot>
                                <tr>
                                    <td colspan="2">Σ ${escapeHtml(person.name)} <span class="text-[10px] text-slate-400 font-normal">(pojistná částka)</span></td>
                                    ${sums.map((v, i) => `<td class="${v ? '' : 'dash'}">${fmtCatShort(v, visCats[i])}</td>`).join('')}
                                    <td>${fmtCZK(personPremium)}</td>
                                    <td></td>
                                </tr>
                                <tr style="background:#0b1324;border-top:1px dashed #334155">
                                    <td colspan="2" class="text-[10px] text-amber-300/90 font-normal">↳ Σ pojistné za položku (Kč/měs)</td>
                                    ${sumPrems.map(vp => `<td class="${vp ? 'text-amber-300/90 text-[10px] font-medium' : 'dash'}">${vp ? Math.round(vp) + ' Kč' : '·'}</td>`).join('')}
                                    <td class="text-amber-300 text-[10.5px]">${fmtCZK(sumAllItemPrems || personPremium)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>` : ''}
                        </table>
                    </div>
                    ${groupBreakdownHtml}
                </div>`;
        });

        container.innerHTML = blocks.join('');
        if (window.lucide) lucide.createIcons();
    }

    function renderContractRow(c, which, visCats) {
        const actionsList = D.CONTRACT_ACTIONS[which] || [];
        const curStatus = which === 'current' ? (c.actionStatus || 'keep') : (c.proposalStatus || 'new');
        const prog = c.conditions && c.conditions.tnProgression ? `TN ${c.conditions.tnProgression}%` : '';
        const retro = c.conditions && c.conditions.pnRetroactive ? 'PN zpětně' : '';
        const metaTags = [prog, retro].filter(Boolean).join(' · ');

        return `<tr>
            <td>
                <div class="flex flex-col leading-tight">
                    <div class="flex items-center gap-1.5">
                        <span class="text-[11px] font-semibold text-slate-100">${escapeHtml(c.insurer || '—')}</span>
                        ${metaTags ? `<span class="text-[9px] px-1 rounded bg-slate-800 text-sky-300 font-mono">${escapeHtml(metaTags)}</span>` : ''}
                    </div>
                    <span class="text-[9.5px] text-slate-400 font-mono">${escapeHtml(c.contractNo || '—')}${c.start || c.end ? ` · ${c.start || '?'}–${c.end || '?'}` : ''}</span>
                    ${(c.actionReason || c.note) ? `<span class="text-[9.5px] text-amber-300/90 italic mt-0.5">${escapeHtml(c.actionReason || c.note)}</span>` : ''}
                </div>
            </td>
            <td>
                <div class="flex flex-col gap-1">
                    <div>${actionBadgeHtml(c, which)}</div>
                    <select class="bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-300 px-1 py-0.5 outline-none"
                        onchange="app.updateContractAction('${which}', '${c.id}', this.value)">
                        ${actionsList.map(a => `<option value="${a.key}" ${curStatus === a.key ? 'selected' : ''}>${escapeHtml(a.label)}</option>`).join('')}
                    </select>
                </div>
            </td>
            ${visCats.map(cat => {
                const v = num(c.items && c.items[cat.key]);
                const vp = contractItemPremium(c, cat.key);
                if (!v && !vp) return `<td class="dash">·</td>`;
                return `<td class="num" title="${escapeHtml(cat.label)}: pojistná částka ${fmtCatValue(v, cat)} | pojistné za položku ${fmtCZK(vp)}/měs">
                    <div class="leading-tight">
                        <div>${v ? fmtCatShort(v, cat) : '—'}</div>
                        ${vp > 0 ? `<div class="text-[9px] text-amber-300/85 font-normal mt-0.5">${Math.round(vp)} Kč</div>` : ''}
                    </div>
                </td>`;
            }).join('')}
            <td class="num font-semibold">${fmtCZK(contractMonthlyPremium(c))}</td>
            <td>
                <div class="flex gap-0.5">
                    <button onclick="app.editContract('${which}','${c.id}')" class="btn-secondary" title="Upravit všechna rizika a podmínky">
                        <i data-lucide="edit-2" class="w-3 h-3"></i>
                    </button>
                    <button onclick="app.duplicateContract('${which}','${c.id}')" class="btn-secondary" title="Duplikovat smlouvu">
                        <i data-lucide="copy" class="w-3 h-3"></i>
                    </button>
                    <button onclick="app.removeContract('${which}','${c.id}')" class="btn-danger" title="Smazat smlouvu">
                        <i data-lucide="trash-2" class="w-3 h-3"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }

    function updateContractAction(which, id, status) {
        const list = which === 'current' ? state.currentContracts : state.proposedContracts;
        const c = list.find(x => x.id === id);
        if (!c) return;
        if (which === 'current') c.actionStatus = status;
        else c.proposalStatus = status;
        save();
        renderContractsGroup(which);
        renderKPIs();
    }

    function addContract(which) {
        if (!state.clients.length) { toast('Nejprve přidejte osobu', 'error'); switchTab('klient'); return; }
        const c = emptyContract(state.clients[0].id, which);
        (which === 'current' ? state.currentContracts : state.proposedContracts).push(c);
        save();
        editContract(which, c.id);
        renderContractsGroup(which);
        renderKPIs();
    }

    function removeContract(which, id) {
        if (!confirm('Smazat tuto smlouvu?')) return;
        if (which === 'current') state.currentContracts = state.currentContracts.filter(c => c.id !== id);
        else                     state.proposedContracts = state.proposedContracts.filter(c => c.id !== id);
        save();
        renderContractsGroup(which);
        renderKPIs();
    }

    function duplicateContract(which, id) {
        const list = which === 'current' ? state.currentContracts : state.proposedContracts;
        const c = list.find(c => c.id === id);
        if (!c) return;
        const copy = clone(c);
        copy.id = uid();
        copy.contractNo = (copy.contractNo || '') + ' (kopie)';
        list.push(copy);
        save();
        renderContractsGroup(which);
        renderKPIs();
    }

    function copyFromCurrent() {
        if (!confirm('Zkopírovat VŠECHNY stávající smlouvy do návrhu? Stávající návrh bude přepsán.')) return;
        state.proposedContracts = state.currentContracts.map(c => {
            const copy = clone(c);
            copy.id = uid();
            copy.proposalStatus = 'kept';
            return copy;
        });
        save();
        renderContractsGroup('proposed');
        renderKPIs();
        toast('Všechny stávající smlouvy zkopírovány do návrhu', 'success');
    }

    function copyKeptFromCurrent() {
        const kept = state.currentContracts.filter(c => c.actionStatus === 'keep' || c.actionStatus === 'modify');
        if (!kept.length) {
            toast('Ve stávajícím portfoliu není žádná smlouva označena jako Ponechat nebo Upravit.', 'info');
            return;
        }
        const existingNos = new Set(state.proposedContracts.map(c => (c.contractNo || '').trim()).filter(Boolean));
        let added = 0;
        kept.forEach(c => {
            if (c.contractNo && existingNos.has(c.contractNo.trim())) return;
            const copy = clone(c);
            copy.id = uid();
            copy.proposalStatus = c.actionStatus === 'modify' ? 'modified' : 'kept';
            state.proposedContracts.push(copy);
            added++;
        });
        save();
        renderContractsGroup('proposed');
        renderKPIs();
        toast(`Do návrhu přeneseno ${added} ponechaných smluv`, 'success');
    }

    /* ════════════ EDIT CONTRACT MODAL (32 KATEGORIÍ V 6 SKUPINÁCH) ════════════ */
    let editingCtx = null;

    function editContract(which, id) {
        const list = which === 'current' ? state.currentContracts : state.proposedContracts;
        const c = list.find(c => c.id === id);
        if (!c) return;
        editingCtx = { which, id };
        document.getElementById('contractModalTitle').textContent =
            (which === 'current' ? 'Stávající smlouva — ' : 'Smlouva v návrhu — ') + (c.insurer || 'Nová položka');

        const body = document.getElementById('contractModalBody');
        const collator = new Intl.Collator('cs', { sensitivity: 'base' });
        const sortedInsurers = [...D.INSURERS].sort((a, b) => collator.compare(a.name, b.name));
        const insurerOptions = sortedInsurers.map(ins =>
            `<option value="${escapeHtml(ins.name)}" ${c.insurer === ins.name ? 'selected' : ''}>${escapeHtml(ins.name)} (${escapeHtml(ins.productLine)})</option>`).join('');
        const clientOptions = state.clients.map(cl =>
            `<option value="${cl.id}" ${c.clientId === cl.id ? 'selected' : ''}>${escapeHtml(cl.name)}</option>`).join('');
        const actionsList = D.CONTRACT_ACTIONS[which] || [];
        const curStatus = which === 'current' ? (c.actionStatus || 'keep') : (c.proposalStatus || 'new');
        const cond = c.conditions || {};
        const isOtherInsurer = !!(c.insurer && !D.INSURER_NAMES.includes(c.insurer));

        const groupedInputsHtml = D.CATEGORY_GROUPS.map(grp => {
            const cats = D.CATEGORIES.filter(cat => cat.group === grp.key);
            const grpPremSum = cats.reduce((acc, cat) => acc + num(c.itemPremiums && c.itemPremiums[cat.key]), 0);
            return `
                <div class="form-block">
                    <div class="form-block-header">
                        <span class="badge badge-${grp.color}">${escapeHtml(grp.label)}</span>
                        <div class="flex items-center gap-2 flex-wrap">
                            ${grp.key === 'disability' ? `
                                <button type="button" onclick="app.copyInv3ToAll()" class="text-[10px] text-sky-400 hover:underline font-mono">
                                    ↳ Zkopírovat částku Inv. III do Inv. II a Inv. I
                                </button>` : ''}
                            ${grp.key === 'income' ? `
                                <div class="flex items-center gap-1 text-[10px] bg-slate-900/90 border border-slate-700/80 rounded px-1.5 py-0.5">
                                    <span class="text-slate-400 uppercase font-mono">Režim PN:</span>
                                    <button type="button" id="mod_pnUnit_daily" onclick="app.setPnModalUnit('daily')" class="px-1.5 py-0.5 rounded font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">Kč/den</button>
                                    <button type="button" id="mod_pnUnit_monthly" onclick="app.setPnModalUnit('monthly')" class="px-1.5 py-0.5 rounded font-mono text-slate-400 hover:text-slate-200">Kč/měs (MZ6Z0)</button>
                                </div>` : ''}
                            <span class="text-[11px] font-mono text-amber-300 font-semibold" id="mod_grp_prem_${grp.key}">
                                Σ ${fmt(grpPremSum)} Kč/měs
                            </span>
                        </div>
                    </div>
                    <div class="form-cov-head">
                        <span>Druh pojištění (riziko)</span>
                        <span>Pojistná částka / dávka</span>
                        <span>Pojistné (Kč/měs)</span>
                    </div>
                    <div class="form-block-body">
                        ${cats.map(cat => {
                            const unit = cat.kind === 'daily' ? 'Kč/den' : cat.kind === 'monthly' ? 'Kč/měs' : 'Kč';
                            const step = cat.kind === 'daily' ? 50 : cat.kind === 'monthly' ? 500 : 50000;
                            const val = num(c.items && c.items[cat.key]);
                            const premVal = num(c.itemPremiums && c.itemPremiums[cat.key]);
                            return `
                                <div class="form-row-cov" title="${escapeHtml(cat.help)}">
                                    <label class="form-label" for="mod_item_${cat.key}">
                                        <div class="flex items-center gap-1.5 flex-wrap">
                                            <span>${escapeHtml(cat.label)}</span>
                                            <span class="tariff-tag hidden" id="mod_badge_${cat.key}"></span>
                                        </div>
                                        <span class="form-unit" id="mod_unit_${cat.key}">${unit}</span>
                                    </label>
                                    <div>
                                        <input type="number" class="pro-input num-input ${val > 0 ? 'has-val' : ''}" min="0" step="${step}"
                                            id="mod_item_${cat.key}" value="${val}"
                                            placeholder="Pojistná částka (${unit})"
                                            oninput="this.classList.toggle('has-val', Number(this.value) > 0)">
                                    </div>
                                    <div>
                                        <input type="number" class="pro-input prem-input ${premVal > 0 ? 'has-val' : ''}" min="0" step="1"
                                            id="mod_prem_${cat.key}" value="${premVal}"
                                            placeholder="Kč/měs"
                                            oninput="this.classList.toggle('has-val', Number(this.value) > 0); app.recalcModalItemPremiums(true)">
                                    </div>
                                </div>`;
                        }).join('')}
                    </div>
                    <div class="form-block-footer">
                        <span>Mezisoučet pojistného bloku (${escapeHtml(grp.label)}):</span>
                        <span class="font-mono font-bold text-amber-300" id="mod_grp_prem_foot_${grp.key}">${fmt(grpPremSum)} Kč/měs</span>
                    </div>
                </div>`;
        }).join('');

        const totalItemPremSum = sumContractItemPremiums(c);

        body.innerHTML = `
            <div class="mb-4 p-3 rounded-lg border border-emerald-500/35 bg-emerald-950/20 flex items-center justify-between gap-3 flex-wrap">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                        <i data-lucide="file-up" class="w-4 h-4"></i>
                    </div>
                    <div>
                        <div class="text-xs font-semibold text-slate-100">Automatické vyplnění formuláře z dokumentu platné smlouvy</div>
                        <div class="text-[11px] text-slate-400" id="mod_inlineUploadStatus">
                            Nahrajte PDF pojistku, výroční dopis, přehled krytí nebo fotku smlouvy — pole níže (včetně pojistné částky i pojistného za položku) se automaticky předvyplní.
                        </div>
                    </div>
                </div>
                <label class="btn-secondary cursor-pointer shrink-0" style="border-color:rgba(16,185,129,0.55);color:#6ee7b7;background:rgba(16,185,129,0.15)">
                    <i data-lucide="upload" class="w-3.5 h-3.5"></i>Vybrat soubor smlouvy (.pdf / foto / .txt)
                    <input type="file" class="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.json" onchange="app.handleInlineModalFileUpload(event)">
                </label>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <!-- BLOK 1: ZÁKLADNÍ IDENTIFIKACE SMLOUVY -->
                <div class="form-block">
                    <div class="form-block-header">
                        <span class="badge badge-sky">1. Identifikace smlouvy a pojistného</span>
                        <span class="text-[10px] text-slate-400 font-mono">Základní parametry</span>
                    </div>
                    <div class="form-block-body">
                        <div class="form-row">
                            <label class="form-label" for="mod_client"><span>Pojištěná osoba</span></label>
                            <div class="form-field">
                                <select class="pro-input" id="mod_client">${clientOptions}</select>
                            </div>
                        </div>
                        <div class="form-row">
                            <label class="form-label" for="mod_insurer"><span>Pojišťovna a produktová řada</span></label>
                            <div class="form-field">
                                <select class="pro-input" id="mod_insurer">
                                    <option value="">-- vyberte pojišťovnu (A–Z) --</option>
                                    ${insurerOptions}
                                    <option value="OTHER" ${isOtherInsurer ? 'selected' : ''}>Jiná pojišťovna…</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-row ${isOtherInsurer ? '' : 'hidden'}" id="mod_otherInsurerWrap">
                            <label class="form-label" for="mod_otherInsurer"><span>Jiná pojišťovna — vlastní název</span></label>
                            <div class="form-field">
                                <input type="text" class="pro-input" id="mod_otherInsurer" placeholder="Zadejte název pojišťovny"
                                    value="${escapeHtml(isOtherInsurer ? c.insurer : '')}">
                            </div>
                        </div>
                        <div class="form-row">
                            <label class="form-label" for="mod_contractNo"><span>Číslo smlouvy / označení</span></label>
                            <div class="form-field">
                                <input type="text" class="pro-input font-mono" id="mod_contractNo" value="${escapeHtml(c.contractNo || '')}" placeholder="např. 1317491203">
                            </div>
                        </div>
                        <div class="form-row">
                            <label class="form-label" for="mod_contractType"><span>Typ produktu</span></label>
                            <div class="form-field">
                                <select class="pro-input" id="mod_contractType">
                                    <option value="risk"     ${cond.contractType === 'risk' || !cond.contractType ? 'selected' : ''}>Rizikové ŽP (RŽP)</option>
                                    <option value="invest"   ${cond.contractType === 'invest' ? 'selected' : ''}>Investiční ŽP (IŽP)</option>
                                    <option value="capital"  ${cond.contractType === 'capital' ? 'selected' : ''}>Kapitálové ŽP (KŽP)</option>
                                    <option value="accident" ${cond.contractType === 'accident' ? 'selected' : ''}>Samostatné úrazové</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-row">
                            <label class="form-label" for="mod_start">
                                <span>Počátek a konec pojištění</span>
                                <span class="form-unit">Rok Od–Do</span>
                            </label>
                            <div class="form-field">
                                <input type="number" class="pro-input num-input" id="mod_start" min="1980" max="2060" placeholder="Od" value="${c.start || ''}">
                                <span class="text-slate-500 font-mono">–</span>
                                <input type="number" class="pro-input num-input" id="mod_end" min="2020" max="2100" placeholder="Do" value="${c.end || ''}">
                            </div>
                        </div>
                        <div class="form-row">
                            <label class="form-label" for="mod_premium">
                                <span>Celkové běžné pojistné</span>
                                <span class="form-unit">Kč</span>
                            </label>
                            <div class="form-field">
                                <input type="number" class="pro-input num-input ${num(c.premium) > 0 ? 'has-val' : ''}" id="mod_premium" min="0" step="1" value="${c.premium || 0}"
                                    oninput="this.classList.toggle('has-val', Number(this.value) > 0); app.recalcModalItemPremiums(false)">
                                <select class="pro-input" id="mod_freq" style="width:115px;flex-shrink:0">
                                    <option value="monthly"   ${cond.paymentFrequency === 'monthly' || !cond.paymentFrequency ? 'selected' : ''}>Měsíčně</option>
                                    <option value="quarterly" ${cond.paymentFrequency === 'quarterly' ? 'selected' : ''}>Čtvrtletně</option>
                                    <option value="yearly"    ${cond.paymentFrequency === 'yearly' ? 'selected' : ''}>Ročně</option>
                                    <option value="singlepay" ${cond.paymentFrequency === 'singlepay' ? 'selected' : ''}>Jednoráz.</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- BLOK 2: DOPORUČENÍ PORADCE A PARAMETRY SMLOUVY -->
                <div class="form-block">
                    <div class="form-block-header">
                        <span class="badge badge-amber">2. Doporučení poradce a parametry smlouvy</span>
                        <button type="button" onclick="app.applyInsurerDefaults()" class="text-[10px] text-amber-300 hover:underline font-mono flex items-center gap-1">
                            <i data-lucide="zap" class="w-3 h-3"></i>Předvyplnit dle pojišťovny
                        </button>
                    </div>
                    <div class="form-block-body">
                        <div class="form-row">
                            <label class="form-label" for="mod_actionStatus"><span class="text-sky-300 font-semibold">Doporučení poradce ke smlouvě</span></label>
                            <div class="form-field">
                                <select class="pro-input" id="mod_actionStatus">
                                    ${actionsList.map(a => `<option value="${a.key}" ${curStatus === a.key ? 'selected' : ''}>${escapeHtml(a.label)}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="form-row">
                            <label class="form-label" for="mod_actionReason"><span class="text-amber-300">Zdůvodnění doporučení (pro tisk)</span></label>
                            <div class="form-field">
                                <input type="text" class="pro-input" id="mod_actionReason"
                                    placeholder="např. Ponechat kvůli zdravotní historii…"
                                    value="${escapeHtml(c.actionReason || c.note || '')}">
                            </div>
                        </div>
                        <div class="form-row">
                            <label class="form-label" for="mod_tnProg"><span>Progrese u trvalých následků (TN)</span></label>
                            <div class="form-field">
                                <select class="pro-input" id="mod_tnProg">
                                    <option value="100"  ${num(cond.tnProgression) === 100 ? 'selected' : ''}>100 % (bez progrese / lineární)</option>
                                    <option value="400"  ${num(cond.tnProgression) === 400 ? 'selected' : ''}>400 % (4násobek u vážných TN)</option>
                                    <option value="500"  ${num(cond.tnProgression) === 500 ? 'selected' : ''}>500 % (5násobek)</option>
                                    <option value="600"  ${num(cond.tnProgression) === 600 ? 'selected' : ''}>600 % (6násobek)</option>
                                    <option value="800"  ${num(cond.tnProgression) === 800 || !cond.tnProgression ? 'selected' : ''}>800 % (8násobek — KOOP/ALZ/NN)</option>
                                    <option value="1000" ${num(cond.tnProgression) === 1000 ? 'selected' : ''}>1000 % (10násobek — UNI/GČP/SIM/MET)</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-row">
                            <label class="form-label" for="mod_pnFromDay"><span>PN — karenční doba (plnění od dne)</span></label>
                            <div class="form-field">
                                <select class="pro-input" id="mod_pnFromDay">
                                    <option value="1"  ${num(cond.pnFromDay) === 1 ? 'selected' : ''}>Od 1. dne</option>
                                    <option value="15" ${num(cond.pnFromDay) === 15 ? 'selected' : ''}>Od 15. dne</option>
                                    <option value="22" ${num(cond.pnFromDay) === 22 ? 'selected' : ''}>Od 22. dne</option>
                                    <option value="29" ${num(cond.pnFromDay) === 29 || !cond.pnFromDay ? 'selected' : ''}>Od 29. dne</option>
                                    <option value="61" ${num(cond.pnFromDay) === 61 ? 'selected' : ''}>Od 61. dne</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-row">
                            <label class="form-label" for="mod_empContrib">
                                <span>Příspěvek zaměstnavatele</span>
                                <span class="form-unit">Kč/měs</span>
                            </label>
                            <div class="form-field">
                                <input type="number" class="pro-input num-input" id="mod_empContrib" min="0" step="100" value="${num(cond.employerContribution)}">
                            </div>
                        </div>
                        <div class="form-row">
                            <label class="form-label" for="mod_taxDeduct">
                                <span>Daňově uznatelné (LTC / spoř.)</span>
                                <span class="form-unit">Kč/rok</span>
                            </label>
                            <div class="form-field">
                                <input type="number" class="pro-input num-input" id="mod_taxDeduct" min="0" step="1000" value="${num(cond.taxDeductibleAnnual)}">
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- KONTROLNÍ PÁS ROZPOČÍTÁNÍ POJISTNÉHO ZA POLOŽKY -->
            <div class="mb-3 p-3 rounded-lg border border-amber-500/35 bg-amber-950/20 flex items-center justify-between gap-3 flex-wrap">
                <div class="flex items-center gap-3 flex-wrap">
                    <div class="flex items-center gap-2">
                        <i data-lucide="calculator" class="w-4 h-4 text-amber-400"></i>
                        <span class="text-xs font-bold uppercase text-slate-200">Sjednaná pojistná rizika — Pojistná částka & Pojistné za položku</span>
                    </div>
                    <span class="text-[11px] font-mono px-2.5 py-1 rounded bg-slate-900/80 border border-slate-700 text-slate-300" id="mod_itemPremSummary">
                        Součet položek pojistného: <strong class="text-amber-300">${fmt(totalItemPremSum)} Kč/měs</strong>
                        (Celkové pojistné smlouvy: <strong class="text-sky-300">${fmt(num(c.premium))} Kč</strong>)
                    </span>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                    <button type="button" onclick="app.syncTotalPremiumFromItems()" class="btn-secondary text-[11px] py-1 px-2.5" title="Nastaví celkové pojistné smlouvy přesně podle součtu jednotlivých položek">
                        <i data-lucide="sigma" class="w-3.5 h-3.5 text-amber-400"></i>Sečíst položky do celkového pojistného
                    </button>
                    <button type="button" onclick="app.distributeTotalPremiumToItems()" class="btn-secondary text-[11px] py-1 px-2.5" title="Rozpočítá celkové pojistné smlouvy mezi sjednané položky dle pojistně-matematických sazeb">
                        <i data-lucide="sparkles" class="w-3.5 h-3.5 text-sky-400"></i>Odhadnout pojistné položek z celkového
                    </button>
                </div>
            </div>

            <!-- ASISTENT HYPOTEČNÍHO KRYTÍ „PRVNÍ Z RIZIK“ -->
            <div class="mb-3.5 p-3 rounded-lg border border-amber-500/35 bg-gradient-to-r from-amber-950/25 via-slate-900/40 to-sky-950/25 flex items-center justify-between gap-3 flex-wrap">
                <div class="flex items-center gap-2.5">
                    <span class="badge badge-amber font-mono font-bold">⚡ Úvěrový balíček „První z rizik“</span>
                    <span class="text-xs text-slate-300">
                        Klesající krytí k hypotéce (Generali tarif <strong>PR201 / PR02B</strong>, Kooperativa <strong>HYS + HYI</strong>, ČSOB) — jedna klesající částka chrání souběžně smrt i invaliditu.
                    </span>
                </div>
                <div class="flex items-center gap-2">
                    <input type="number" id="mod_quickMortgageAmount" class="pro-input num-input text-xs w-36" placeholder="Částka hypotéky v Kč" step="50000">
                    <button type="button" onclick="app.applyMortgageComboInModal()" class="btn-secondary text-xs py-1 px-2.5" style="border-color:rgba(245,158,11,0.5);color:#fcd34d">
                        <i data-lucide="link" class="w-3.5 h-3.5 text-amber-400"></i>Nastavit do Smrti i Inv. kles.
                    </button>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                ${groupedInputsHtml}
            </div>

            <!-- BLOK PODMÍNEK A VÝLUK -->
            <div class="form-block mb-4">
                <div class="form-block-header">
                    <span class="badge badge-violet">Detailní kvalitativní podmínky smlouvy a výluky</span>
                    <span class="text-[10px] text-slate-400 font-mono">Ovlivňuje Skóre zdraví pojištění</span>
                </div>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-x-6 form-block-body">
                    <div class="form-row">
                        <label class="form-label" for="mod_pnRetroactive"><span>Pracovní neschopnost <strong>zpětně od 1. dne</strong></span></label>
                        <div class="form-field justify-end">
                            <label class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                <input type="checkbox" class="pro-input" id="mod_pnRetroactive" ${cond.pnRetroactive ? 'checked' : ''}>
                                <span>Ano, plní zpětně od 1. dne</span>
                            </label>
                        </div>
                    </div>
                    <div class="form-row">
                        <label class="form-label" for="mod_invPsych"><span>Kryje <strong>psychické diagnózy (F)</strong> v invaliditě</span></label>
                        <div class="form-field justify-end">
                            <label class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                <input type="checkbox" class="pro-input" id="mod_invPsych" ${cond.invPsychIncluded !== false ? 'checked' : ''}>
                                <span>Ano, včetně psychických dg.</span>
                            </label>
                        </div>
                    </div>
                    <div class="form-row">
                        <label class="form-label" for="mod_backPain"><span>Rozšířené krytí <strong>páteře a bolestí zad</strong></span></label>
                        <div class="form-field justify-end">
                            <label class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                <input type="checkbox" class="pro-input" id="mod_backPain" ${cond.backPainIncluded ? 'checked' : ''}>
                                <span>Ano, bez plošné výluky na záda</span>
                            </label>
                        </div>
                    </div>
                    <div class="form-row">
                        <label class="form-label" for="mod_occCat"><span>Riziková skupina povolání</span></label>
                        <div class="form-field">
                            <input type="text" class="pro-input" id="mod_occCat" placeholder="např. RS 1" value="${escapeHtml(cond.occupationCategory || '1')}">
                        </div>
                    </div>
                </div>
            </div>

            <div class="flex justify-end items-center gap-2 mt-4">
                <button type="button" onclick="app.closeContractModal()" class="btn-secondary">Zrušit</button>
                <button type="button" onclick="app.saveContractModal()" class="btn-primary">
                    <i data-lucide="save" class="w-3.5 h-3.5"></i>Uložit smlouvu
                </button>
            </div>
        `;
        currentPnModalUnit = 'daily';
        document.getElementById('contractModal').classList.remove('hidden');
        document.getElementById('contractModal').classList.add('flex');
        document.getElementById('mod_insurer').addEventListener('change', function () {
            const wrap = document.getElementById('mod_otherInsurerWrap');
            if (wrap) wrap.classList.toggle('hidden', this.value !== 'OTHER');
            updateModalInsurerBadges();
        });
        updateModalInsurerBadges();
        if (window.lucide) lucide.createIcons();
    }

    /* Dynamická aktualizace tarifních kódů / nápovědy k pojišťovně v modalu */
    function updateModalInsurerBadges() {
        const sel = document.getElementById('mod_insurer');
        if (!sel) return;
        const insName = (sel.value || '').trim();
        const guideKey = Object.keys(D.INSURER_TARIFF_GUIDES || {}).find(k => k === insName || insName.startsWith(k) || k.startsWith(insName));
        const guide = guideKey ? D.INSURER_TARIFF_GUIDES[guideKey] : null;

        D.CATEGORIES.forEach(cat => {
            const badge = document.getElementById('mod_badge_' + cat.key);
            if (!badge) return;
            if (guide && guide[cat.key]) {
                badge.textContent = guide[cat.key].code;
                badge.title = guide[cat.key].hint || guide[cat.key].code;
                badge.classList.remove('hidden');
            } else {
                badge.textContent = '';
                badge.classList.add('hidden');
            }
        });
    }

    /* Rychlý hypoteční asistent: nastaví zadanou klesající částku do Smrti klesající i Invalidity klesající */
    function applyMortgageComboInModal() {
        const inp = document.getElementById('mod_quickMortgageAmount');
        if (!inp) return;
        const val = num(inp.value);
        if (val <= 0) {
            toast('Zadejte částku hypotéky/úvěru v Kč (např. 500 000 Kč).', 'info');
            return;
        }
        const smrtKlesEl = document.getElementById('mod_item_smrtKles');
        const invKlesEl = document.getElementById('mod_item_invKles');
        if (smrtKlesEl) {
            smrtKlesEl.value = val;
            smrtKlesEl.classList.add('has-val');
        }
        if (invKlesEl) {
            invKlesEl.value = val;
            invKlesEl.classList.add('has-val');
        }
        toast(`Nastaveno ${fmt(val)} Kč do Smrti klesající i Invalidity klesající (hypotéka)`, 'success');
    }

    /* Přepínač režimu zadávání pracovní neschopnosti: Kč/den ↔ Kč/měs */
    let currentPnModalUnit = 'daily';
    function setPnModalUnit(unit) {
        if (unit === currentPnModalUnit) return;
        currentPnModalUnit = unit;
        const btnD = document.getElementById('mod_pnUnit_daily');
        const btnM = document.getElementById('mod_pnUnit_monthly');
        if (btnD && btnM) {
            if (unit === 'monthly') {
                btnM.className = 'px-1.5 py-0.5 rounded font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
                btnD.className = 'px-1.5 py-0.5 rounded font-mono text-slate-400 hover:text-slate-200';
            } else {
                btnD.className = 'px-1.5 py-0.5 rounded font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
                btnM.className = 'px-1.5 py-0.5 rounded font-mono text-slate-400 hover:text-slate-200';
            }
        }
        ['pn15', 'pn28', 'pn61'].forEach(k => {
            const inp = document.getElementById('mod_item_' + k);
            const uEl = document.getElementById('mod_unit_' + k);
            if (inp) {
                const curVal = num(inp.value);
                if (unit === 'monthly') {
                    if (curVal > 0) inp.value = Math.round(curVal * 30);
                    inp.placeholder = 'Kč/měs (např. 10 000)';
                    inp.step = '500';
                    if (uEl) uEl.textContent = 'Kč/měs';
                } else {
                    if (curVal > 0) inp.value = Math.round(curVal / 30);
                    inp.placeholder = 'Kč/den (např. 300)';
                    inp.step = '50';
                    if (uEl) uEl.textContent = 'Kč/den';
                }
            }
        });
    }

    function recalcModalItemPremiums(autoSyncTotal = false) {
        let totalSum = 0;
        D.CATEGORY_GROUPS.forEach(grp => {
            const cats = D.CATEGORIES.filter(cat => cat.group === grp.key);
            let grpSum = 0;
            cats.forEach(cat => {
                const el = document.getElementById('mod_prem_' + cat.key);
                if (el) grpSum += num(el.value);
            });
            totalSum += grpSum;
            const headEl = document.getElementById('mod_grp_prem_' + grp.key);
            const footEl = document.getElementById('mod_grp_prem_foot_' + grp.key);
            if (headEl) headEl.textContent = `Σ ${fmt(grpSum)} Kč/měs`;
            if (footEl) footEl.textContent = `${fmt(grpSum)} Kč/měs`;
        });
        const totalInput = document.getElementById('mod_premium');
        if (autoSyncTotal && totalInput && totalSum > 0) {
            totalInput.value = totalSum;
            totalInput.classList.toggle('has-val', totalSum > 0);
        }
        const curTotal = totalInput ? num(totalInput.value) : 0;
        const sumEl = document.getElementById('mod_itemPremSummary');
        if (sumEl) {
            const diff = curTotal - totalSum;
            const diffBadge = diff === 0
                ? `<span class="text-emerald-400">✓ Souhlasí se součtem</span>`
                : `<span class="text-amber-300">Rozdíl: ${diff > 0 ? '+' : ''}${fmt(diff)} Kč</span>`;
            sumEl.innerHTML = `Součet položek pojistného: <strong class="text-amber-300">${fmt(totalSum)} Kč/měs</strong> · Celkové pojistné: <strong class="text-sky-300">${fmt(curTotal)} Kč</strong> (${diffBadge})`;
        }
        return totalSum;
    }

    function syncTotalPremiumFromItems() {
        const sum = recalcModalItemPremiums(true);
        const totalInput = document.getElementById('mod_premium');
        if (totalInput) {
            totalInput.value = sum;
            totalInput.classList.toggle('has-val', sum > 0);
        }
        recalcModalItemPremiums(false);
        toast(`Celkové pojistné nastaveno na součet položek: ${fmt(sum)} Kč/měs`, 'success');
    }

    function distributeTotalPremiumToItems() {
        const totalInput = document.getElementById('mod_premium');
        const total = totalInput ? num(totalInput.value) : 0;
        const items = {};
        D.CATEGORIES.forEach(cat => {
            const el = document.getElementById('mod_item_' + cat.key);
            items[cat.key] = el ? num(el.value) : 0;
        });
        const est = D.estimateItemPremiums ? D.estimateItemPremiums(items, total) : {};
        let estSum = 0;
        D.CATEGORIES.forEach(cat => {
            const el = document.getElementById('mod_prem_' + cat.key);
            const v = num(est[cat.key]);
            estSum += v;
            if (el) {
                el.value = v;
                el.classList.toggle('has-val', v > 0);
            }
        });
        if (total === 0 && estSum > 0 && totalInput) {
            totalInput.value = estSum;
            totalInput.classList.toggle('has-val', true);
        }
        recalcModalItemPremiums(false);
        toast(`Pojistné rozpočítáno mezi sjednané položky (Σ ${fmt(estSum)} Kč/měs)`, 'info');
    }

    function copyInv3ToAll() {
        const el3 = document.getElementById('mod_item_invalidita');
        const el2 = document.getElementById('mod_item_inv2');
        const el1 = document.getElementById('mod_item_inv1');
        if (!el3) return;
        const v = num(el3.value);
        if (el2) { el2.value = v; el2.classList.toggle('has-val', v > 0); }
        if (el1) { const v1 = Math.round(v * 0.5); el1.value = v1; el1.classList.toggle('has-val', v1 > 0); }
        toast('Invalidita II nastavena na 100 % a Inv. I na 50 % částky Inv. III', 'info');
    }

    function closeContractModal() {
        document.getElementById('contractModal').classList.add('hidden');
        document.getElementById('contractModal').classList.remove('flex');
        editingCtx = null;
    }

    function applyInsurerDefaults() {
        const insurerName = document.getElementById('mod_insurer').value;
        const ins = D.INSURERS.find(i => i.name === insurerName);
        if (!ins) { toast('Nejprve vyberte pojišťovnu ze seznamu', 'info'); return; }
        const d = ins.defaultConditions || {};
        if (d.pnFromDay) document.getElementById('mod_pnFromDay').value = String(d.pnFromDay);
        if (d.tnProgression) document.getElementById('mod_tnProg').value = String(d.tnProgression);
        if (d.contractType) document.getElementById('mod_contractType').value = d.contractType;
        document.getElementById('mod_pnRetroactive').checked = !!d.pnRetroactive;
        document.getElementById('mod_invPsych').checked = d.invPsychIncluded !== false;
        document.getElementById('mod_backPain').checked = !!d.backPainIncluded;
        document.getElementById('mod_occCat').value = d.occupationCategories || '1';
        toast(`Podmínky předvyplněny dle ${ins.name} (${ins.productLine})`, 'success');
    }

    function saveContractModal() {
        if (!editingCtx) return;
        const { which, id } = editingCtx;
        const list = which === 'current' ? state.currentContracts : state.proposedContracts;
        const c = list.find(c => c.id === id);
        if (!c) { closeContractModal(); return; }

        c.clientId = document.getElementById('mod_client').value;
        let ins = document.getElementById('mod_insurer').value;
        if (ins === 'OTHER') ins = document.getElementById('mod_otherInsurer').value.trim() || '';
        c.insurer = ins;
        c.contractNo = document.getElementById('mod_contractNo').value.trim();
        c.start = num(document.getElementById('mod_start').value) || null;
        c.end   = num(document.getElementById('mod_end').value) || null;
        c.premium = num(document.getElementById('mod_premium').value);

        const st = document.getElementById('mod_actionStatus').value;
        if (which === 'current') c.actionStatus = st;
        else c.proposalStatus = st;

        const reason = document.getElementById('mod_actionReason').value.trim();
        c.actionReason = reason;
        c.note = reason;

        c.conditions = c.conditions || {};
        c.conditions.contractType = document.getElementById('mod_contractType').value;
        c.conditions.paymentFrequency = document.getElementById('mod_freq').value;
        c.conditions.tnProgression = num(document.getElementById('mod_tnProg').value) || 800;
        c.conditions.pnFromDay = num(document.getElementById('mod_pnFromDay').value) || 29;
        c.conditions.pnWaitingDays = c.conditions.pnFromDay;
        c.conditions.pnRetroactive = document.getElementById('mod_pnRetroactive').checked;
        c.conditions.invPsychIncluded = document.getElementById('mod_invPsych').checked;
        c.conditions.backPainIncluded = document.getElementById('mod_backPain').checked;
        c.conditions.occupationCategory = document.getElementById('mod_occCat').value.trim();
        c.conditions.employerContribution = num(document.getElementById('mod_empContrib').value);
        c.conditions.taxDeductibleAnnual = num(document.getElementById('mod_taxDeduct').value);

        c.items = c.items || {};
        c.itemPremiums = c.itemPremiums || {};
        let sumIP = 0;
        D.CATEGORIES.forEach(cat => {
            const el = document.getElementById('mod_item_' + cat.key);
            if (el) c.items[cat.key] = num(el.value);
            const pel = document.getElementById('mod_prem_' + cat.key);
            if (pel) {
                const pv = num(pel.value);
                c.itemPremiums[cat.key] = pv;
                sumIP += pv;
            }
        });
        /* Pokud bylo zadáváno v měsíčním režimu PN (Kč/měs), převedeme zpět na denní dávku Kč/den */
        if (currentPnModalUnit === 'monthly') {
            ['pn15', 'pn28', 'pn61'].forEach(k => {
                if (c.items[k] > 0) c.items[k] = Math.round(c.items[k] / 30);
            });
        }
        if (c.premium === 0 && sumIP > 0) {
            c.premium = sumIP;
        } else if (sumIP === 0 && c.premium > 0 && D.estimateItemPremiums) {
            c.itemPremiums = D.estimateItemPremiums(c.items, c.premium);
        }

        save();
        closeContractModal();
        renderContractsGroup(which);
        renderKPIs();
        toast('Smlouva uložena (včetně rozpadu pojistného po položkách)', 'success');
    }

    /* ════════════ TAB 4: NEEDS ANALYSIS & TAX BENEFIT CALCULATOR ════════════ */
    function refreshNeedsPersonSelect() {
        const sel = document.getElementById('needsPersonSelect');
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        if (cur && state.clients.find(c => c.id === cur)) sel.value = cur;
        else if (state.clients[0]) sel.value = state.clients[0].id;
    }

    function getNeedsOpts() {
        return {
            deathYears: document.getElementById('needsDeathYears') ? document.getElementById('needsDeathYears').value : 2,
            invYears:   document.getElementById('needsInvYears') ? document.getElementById('needsInvYears').value : '10',
            zoMonths:   document.getElementById('needsZoMonths') ? document.getElementById('needsZoMonths').value : 12,
            pnTargetPct:document.getElementById('needsPnTargetPct') ? document.getElementById('needsPnTargetPct').value : 0.90
        };
    }

    function renderNeedsAnalysis() {
        const out = document.getElementById('needsAnalysisOutput');
        if (!out) return;
        if (!state.clients.length) {
            out.innerHTML = '<div class="text-xs text-slate-500 italic">Nejprve přidejte pojištěnou osobu.</div>';
            return;
        }
        refreshNeedsPersonSelect();
        const pid = document.getElementById('needsPersonSelect').value;
        const person = state.clients.find(c => c.id === pid) || state.clients[0];
        const needs = computeRecommendedNeeds(person, getNeedsOpts());
        const t = needs.targets;

        const rowsData = [
            {
                label: 'Smrt celkem (konstantní + klesající k úvěru)',
                sub: needs.isChild ? 'U dětí se smrt nesjednává' : `Úvěry ${fmtCZK(needs.loans)} + rodinná rezerva ${fmtCZK(t.smrtConst)}`,
                target: t.smrtTotal,
                cur: effectiveDeathCover(state.currentContracts, person.id),
                nw:  effectiveDeathCover(state.proposedContracts, person.id),
                unit: 'sum'
            },
            {
                label: 'Invalidita III. stupně (vč. klesající / dětské soběstačnosti)',
                sub: needs.isChild ? 'Kritické riziko u dětí (vrozené a získané vady / ZTP)' : `Státní ID III. st.: ${fmtCZK(needs.pens.inv3)}/m → chybí ${fmtCZK(needs.gapInv3Monthly)}/m`,
                target: t.inv3,
                cur: effectiveInv3Cover(state.currentContracts, person.id) + sumItemFor(state.currentContracts, person.id, 'trvaleNasledkyNemoc'),
                nw:  effectiveInv3Cover(state.proposedContracts, person.id) + sumItemFor(state.proposedContracts, person.id, 'trvaleNasledkyNemoc'),
                unit: 'sum'
            },
            {
                label: 'Invalidita II. stupně',
                sub: needs.isChild ? 'Středně těžká závislost / invalidita' : `Státní ID II. st.: ${fmtCZK(needs.pens.inv2)}/m → chybí ${fmtCZK(needs.gapInv2Monthly)}/m`,
                target: t.inv2,
                cur: effectiveInv2Cover(state.currentContracts, person.id),
                nw:  effectiveInv2Cover(state.proposedContracts, person.id),
                unit: 'sum'
            },
            {
                label: 'Invalidita I. stupně',
                sub: needs.isChild ? 'Částečná invalidita v dospělosti' : `Státní ID I. st.: ${fmtCZK(needs.pens.inv1)}/m → nejčastější stupeň invalidity`,
                target: t.inv1,
                cur: effectiveInv1Cover(state.currentContracts, person.id),
                nw:  effectiveInv1Cover(state.proposedContracts, person.id),
                unit: 'sum'
            },
            {
                label: 'Závažná onemocnění (ZO)',
                sub: needs.isChild ? 'Náklady na léčbu a celodenní péči rodiče' : 'Finanční polštář na 1–2 roky léčby a rekonvalescence',
                target: t.zavOn,
                cur: effectiveZoCover(state.currentContracts, person.id),
                nw:  effectiveZoCover(state.proposedContracts, person.id),
                unit: 'sum'
            },
            {
                label: 'Trvalé následky úrazu (základ + od 10 % před progresí)',
                sub: 'S progresí 800–1000 % vytvoří při 100% poškození až 8–10 mil. Kč',
                target: t.tnUraz + t.tnUraz10,
                cur: effectiveTnCover(state.currentContracts, person.id),
                nw:  effectiveTnCover(state.proposedContracts, person.id),
                unit: 'sum'
            },
            {
                label: 'Pracovní neschopnost (součet denních dávek PN)',
                sub: needs.isChild ? 'U dětí nahrazeno Ošetřováním dítěte (OČR)' : `Nemocenská ČSSZ: ${fmtCZK(needs.sickMonthly)}/m → dorovnání propadu příjmu`,
                target: t.pnDaily,
                cur: effectivePnDaily(state.currentContracts, person.id),
                nw:  effectivePnDaily(state.proposedContracts, person.id),
                unit: 'daily'
            },
            {
                label: 'Hospitalizace (nemoc + úraz)',
                sub: 'Pokrytí nadstandardního pokoje a vedlejších nákladů v nemocnici',
                target: t.hosp,
                cur: sumItemFor(state.currentContracts, person.id, 'hosp') + sumItemFor(state.currentContracts, person.id, 'hospUraz'),
                nw:  sumItemFor(state.proposedContracts, person.id, 'hosp') + sumItemFor(state.proposedContracts, person.id, 'hospUraz'),
                unit: 'daily'
            },
            {
                label: 'Ošetřování dítěte / člena rodiny (OČR)',
                sub: 'Kompenzace propadu příjmu rodiče při péči o nemocné dítě doma',
                target: t.osetrovani,
                cur: sumItemFor(state.currentContracts, person.id, 'osetrovani'),
                nw:  sumItemFor(state.proposedContracts, person.id, 'osetrovani'),
                unit: 'daily'
            }
        ];

        const fmtVal = (v, u) => u === 'daily' ? (v ? v + ' Kč/d' : '0 Kč/d') : fmtCZK(v);

        out.innerHTML = `
            <div class="overflow-x-auto">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Pilíř pojistné ochrany (${escapeHtml(person.name)})</th>
                            <th class="num">Doporučený cíl</th>
                            <th class="num">Stávající stav</th>
                            <th class="num">Návrh poradce</th>
                            <th class="num">Naplnění cíle v Návrhu</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsData.map(r => {
                            if (r.target === 0 && r.cur === 0 && r.nw === 0) return '';
                            const pctCur = r.target > 0 ? Math.min(100, Math.round((r.cur / r.target) * 100)) : 100;
                            const pctNew = r.target > 0 ? Math.min(100, Math.round((r.nw  / r.target) * 100)) : 100;
                            const badgeCls = pctNew >= 90 ? 'emerald' : pctNew >= 50 ? 'amber' : 'rose';
                            const statusText = pctNew >= 90 ? '✔ Plně kryto' : pctNew >= 50 ? '◐ Částečně' : '✖ Podpojištěno';
                            return `
                                <tr>
                                    <td>
                                        <div class="font-semibold text-slate-200">${escapeHtml(r.label)}</div>
                                        <div class="text-[10px] text-slate-500">${escapeHtml(r.sub)}</div>
                                    </td>
                                    <td class="num font-bold text-amber-300">${fmtVal(r.target, r.unit)}</td>
                                    <td class="num text-slate-400">${fmtVal(r.cur, r.unit)} <span class="text-[10px] text-slate-500">(${pctCur} %)</span></td>
                                    <td class="num font-bold text-sky-300">${fmtVal(r.nw, r.unit)}</td>
                                    <td class="num">
                                        <div class="flex items-center justify-end gap-2">
                                            <span class="badge badge-${badgeCls}">${pctNew} % · ${statusText}</span>
                                        </div>
                                    </td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function applyNeedsToProposal() {
        const pid = document.getElementById('needsPersonSelect') ? document.getElementById('needsPersonSelect').value : (state.clients[0] && state.clients[0].id);
        const person = state.clients.find(c => c.id === pid);
        if (!person) return;
        const needs = computeRecommendedNeeds(person, getNeedsOpts());
        const t = needs.targets;

        /* Zjistíme, kolik už kryjí zachované ('kept') smlouvy v návrhu pro tuto osobu */
        const keptInProp = state.proposedContracts.filter(c => c.clientId === person.id && c.proposalStatus === 'kept');
        const keptSmrt = effectiveDeathCover(keptInProp, person.id);
        const keptZo   = effectiveZoCover(keptInProp, person.id);

        /* Najdeme nebo vytvoříme novou ('new') smlouvu v návrhu pro tuto osobu */
        let targetContract = state.proposedContracts.find(c => c.clientId === person.id && c.proposalStatus === 'new');
        if (!targetContract) {
            targetContract = emptyContract(person.id, 'proposed');
            targetContract.insurer = 'Uniqa';
            targetContract.contractNo = 'NÁVRH-' + new Date().getFullYear();
            targetContract.proposalStatus = 'new';
            targetContract.conditions.tnProgression = 1000;
            targetContract.conditions.pnRetroactive = true;
            state.proposedContracts.push(targetContract);
        }

        if (needs.isChild) {
            targetContract.items.invalidita = t.inv3;
            targetContract.items.trvaleNasledkyNemoc = t.trvaleNasledkyNemoc;
            targetContract.items.zavOn = Math.max(0, t.zavOn - keptZo);
            targetContract.items.tnUraz = t.tnUraz;
            targetContract.items.uraz = t.uraz;
            targetContract.items.hosp = t.hosp;
            targetContract.items.osetrovani = t.osetrovani;
            targetContract.actionReason = `Automaticky namodelováno dle kalkulačky potřeb pro dítě (${person.name}).`;
        } else {
            targetContract.items.smrt = Math.max(100000, t.smrtConst - keptSmrt);
            targetContract.items.smrtKles = t.smrtKles;
            targetContract.items.invalidita = t.inv3;
            targetContract.items.inv2 = t.inv2;
            targetContract.items.inv1 = t.inv1;
            targetContract.items.zavOn = Math.max(0, t.zavOn - keptZo);
            targetContract.items.tnUraz = t.tnUraz;
            targetContract.items.tnUraz10 = t.tnUraz10;
            targetContract.items.pn28 = t.pnDaily;
            targetContract.items.hosp = t.hosp;
            targetContract.items.uraz = t.uraz;
            targetContract.actionReason = `Namodelováno dle kalkulačky potřeb: krytí úvěrů (${fmtCZK(needs.loans)}), invalidity I.–III. st. a propadu příjmu.`;
        }
        targetContract.note = targetContract.actionReason;

        save();
        renderAll();
        renderNeedsAnalysis();
        toast(`Doporučené částky propsány do návrhu pro: ${person.name}`, 'success');
    }

    function renderTaxBenefitCalculator() {
        const el = document.getElementById('taxBenefitCalculator');
        if (!el) return;
        const totalPropM = totalPremiumMonthly(state.proposedContracts);
        const empFromContractsM = totalEmployerBenefitMonthly(state.proposedContracts);
        const taxDedFromContractsY = state.proposedContracts.reduce((s, c) => s + num(c.conditions && c.conditions.taxDeductibleAnnual), 0);
        /* + připojištění dlouhodobé péče (LTC) je daňově uznatelné */
        const hasLtc = sumItem(state.proposedContracts, 'dlouhodobaPece') > 0;
        const defaultDedY = taxDedFromContractsY > 0 ? taxDedFromContractsY : (hasLtc ? 12000 : 0);

        el.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Měsíční pojistné návrhu (Kč/měs)</span>
                    <input type="number" id="taxSimPremiumM" class="pro-input" value="${Math.round(totalPropM)}" oninput="app.updateTaxSim()">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Příspěvek zaměstnavatele (Kč/měs)</span>
                    <input type="number" id="taxSimEmployerM" class="pro-input" value="${Math.round(empFromContractsM || 500)}" min="0" max="4166" step="100" oninput="app.updateTaxSim()">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Roční daňově uznatelné pojistné (LTC/ŽP)</span>
                    <input type="number" id="taxSimDeductibleY" class="pro-input" value="${Math.round(defaultDedY || 12000)}" min="0" max="48000" step="1000" oninput="app.updateTaxSim()">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Sazba daně z příjmu klienta</span>
                    <select id="taxSimRate" class="pro-input" onchange="app.updateTaxSim()">
                        <option value="0.15" selected>15 % (základní sazba do 146 901 Kč/měs)</option>
                        <option value="0.23">23 % (progresivní sazba nad 146 901 Kč/měs)</option>
                    </select>
                </label>
            </div>
            <div id="taxSimResult" class="mt-3"></div>
        `;
        updateTaxSim();
    }

    function updateTaxSim() {
        const resEl = document.getElementById('taxSimResult');
        if (!resEl) return;
        const premM = num(document.getElementById('taxSimPremiumM').value);
        const empM  = Math.min(4166, num(document.getElementById('taxSimEmployerM').value));
        const dedY  = Math.min(48000, num(document.getElementById('taxSimDeductibleY').value));
        const rate  = num(document.getElementById('taxSimRate').value) || 0.15;

        const taxSavingY = Math.round(dedY * rate);
        const taxSavingM = Math.round(taxSavingY / 12);
        const netClientCostM = Math.max(0, Math.round(premM - empM - taxSavingM));
        const totalSubsidyM = Math.min(premM, empM + taxSavingM);

        resEl.innerHTML = `
            <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div class="kpi-card">
                    <div class="text-[10px] uppercase text-slate-500 font-bold">Hrubé pojistné návrhu</div>
                    <div class="text-lg font-bold font-mono text-slate-200">${fmtCZK(premM)} / měs</div>
                    <div class="text-[10px] text-slate-500">${fmtCZK(premM * 12)} / rok</div>
                </div>
                <div class="kpi-card">
                    <div class="text-[10px] uppercase text-slate-500 font-bold">Příspěvek zaměstnavatele</div>
                    <div class="text-lg font-bold font-mono text-sky-300">-${fmtCZK(empM)} / měs</div>
                    <div class="text-[10px] text-slate-500">${fmtCZK(empM * 12)} / rok (osvobozeno do 50 000 Kč)</div>
                </div>
                <div class="kpi-card">
                    <div class="text-[10px] uppercase text-slate-500 font-bold">Daňová vratka (odpočet ${fmtCZK(dedY)}/r)</div>
                    <div class="text-lg font-bold font-mono text-amber-300">-${fmtCZK(taxSavingM)} / měs</div>
                    <div class="text-[10px] text-slate-500">Úspora na dani ${fmtCZK(taxSavingY)} / rok</div>
                </div>
                <div class="kpi-card border-emerald-500/40">
                    <div class="text-[10px] uppercase text-emerald-400 font-bold">Skutečný čistý náklad klienta</div>
                    <div class="text-xl font-bold font-mono text-emerald-300">${fmtCZK(netClientCostM)} / měs</div>
                    <div class="text-[10px] text-emerald-400/80">Dotace zaměstnavatele a státu: ${fmtCZK(totalSubsidyM)}/měs</div>
                </div>
            </div>
        `;
    }

    /* ════════════ LOANS ════════════ */
    function renderLoans() {
        const container = document.getElementById('loansList');
        if (!container) return;
        if (!state.loans.length) {
            container.innerHTML = `<div class="text-xs text-slate-500 italic text-center py-6 border border-dashed border-slate-800 rounded">
                Žádné úvěry. Přidejte hypotéku, půjčku od rodiny nebo spotřebitelský úvěr…
            </div>`;
            updateLoansTotals();
            return;
        }
        container.innerHTML = state.loans.map(l => `
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 items-end p-3 bg-slate-950/40 border border-slate-800 rounded">
                <label class="block lg:col-span-2">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Název úvěru / závazku</span>
                    <input type="text" class="pro-input" value="${escapeHtml(l.name)}"
                        onchange="app.updateLoan('${l.id}', 'name', this.value)">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Nesplacená jistina (Kč)</span>
                    <input type="number" class="pro-input" min="0" step="50000" value="${l.amount || 0}"
                        onchange="app.updateLoan('${l.id}', 'amount', this.value)">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Měsíční splátka (Kč)</span>
                    <input type="number" class="pro-input" min="0" step="500" value="${l.monthlyPayment || 0}"
                        onchange="app.updateLoan('${l.id}', 'monthlyPayment', this.value)">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Hlavní dlužník</span>
                    <select class="pro-input" onchange="app.updateLoan('${l.id}', 'linkedClientId', this.value)">
                        <option value="">-- vyberte --</option>
                        ${state.clients.map(c => `<option value="${c.id}" ${l.linkedClientId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                    </select>
                </label>
                <div class="flex items-end justify-between gap-2">
                    <label class="block grow">
                        <span class="block text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Zbývá (let)</span>
                        <input type="number" class="pro-input" min="1" max="40" value="${l.remainingYears || 20}"
                            onchange="app.updateLoan('${l.id}', 'remainingYears', this.value)">
                    </label>
                    <button onclick="app.removeLoan('${l.id}')" class="btn-danger" title="Smazat úvěr">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            </div>
        `).join('');
        updateLoansTotals();
        if (window.lucide) lucide.createIcons();
    }

    function updateLoansTotals() {
        const total = sumLoans();
        const monthly = sumLoansMonthly();
        const newDeath = effectiveDeathCover(state.proposedContracts);
        document.getElementById('loansTotal').textContent = fmtCZK(total);
        const mEl = document.getElementById('loansMonthlyTotal');
        if (mEl) mEl.textContent = `Měsíční splátky celkem: ${fmtCZK(monthly)} / měs`;
        document.getElementById('loansRecommended').textContent = fmtCZK(Math.round(total * 1.15));

        const stEl = document.getElementById('loansCoverageStatus');
        const subEl = document.getElementById('loansCoverageSub');
        if (stEl && subEl) {
            if (total === 0) {
                stEl.textContent = 'Bez úvěrů';
                stEl.className = 'text-2xl font-bold font-mono text-slate-400';
            } else if (newDeath >= total) {
                stEl.textContent = `✔ Kryto (${fmtCZKShort(newDeath)})`;
                stEl.className = 'text-2xl font-bold font-mono text-emerald-300';
                subEl.textContent = `Přesah nad jistinu: +${fmtCZK(newDeath - total)}`;
            } else {
                stEl.textContent = `✖ Chybí ${fmtCZKShort(total - newDeath)}`;
                stEl.className = 'text-2xl font-bold font-mono text-rose-300';
                subEl.textContent = `Součet Smrt + Smrt klesající v návrhu: ${fmtCZK(newDeath)}`;
            }
        }
    }

    function addLoan() {
        state.loans.push({
            id: uid(), name: 'Nový úvěr', amount: 1000000, monthlyPayment: 5500,
            remainingYears: 20, linkedClientId: state.clients[0] ? state.clients[0].id : ''
        });
        save(); renderLoans(); renderKPIs();
    }
    function updateLoan(id, field, value) {
        const l = state.loans.find(l => l.id === id);
        if (!l) return;
        if (['amount', 'monthlyPayment', 'remainingYears', 'interestRate'].includes(field)) value = num(value);
        l[field] = value;
        save(); updateLoansTotals(); renderKPIs();
    }
    function removeLoan(id) {
        state.loans = state.loans.filter(l => l.id !== id);
        save(); renderLoans(); renderKPIs();
    }

    /* ════════════ TAB 6: SCENARIOS & TN PROGRESSION SIMULATOR ════════════ */
    function refreshScenarioPersons() {
        const sel = document.getElementById('scenarioPerson');
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        if (cur && state.clients.find(c => c.id === cur)) sel.value = cur;
        else if (state.clients[0]) sel.value = state.clients[0].id;
    }

    function applyScenarioPreset(preset) {
        const setV = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        const setC = (id, v) => { const e = document.getElementById(id); if (e) e.checked = !!v; };
        if (preset === 'fracture') {
            setV('scenarioPnDays', 90); setV('scenarioHospDays', 5); setV('scenarioOcrDays', 0);
            setV('scenarioInjury', 'both'); setV('scenarioTnPct', 0);
            setC('scenarioRetroactive', true); setC('scenarioCriticalIllness', false); setC('scenarioDisability3', false);
        } else if (preset === 'carCrash') {
            setV('scenarioPnDays', 120); setV('scenarioHospDays', 21); setV('scenarioOcrDays', 0);
            setV('scenarioInjury', 'both'); setV('scenarioTnPct', 50);
            setC('scenarioRetroactive', true); setC('scenarioCriticalIllness', false); setC('scenarioDisability3', false);
            setV('tnSimSlider', 50);
        } else if (preset === 'cancer') {
            setV('scenarioPnDays', 180); setV('scenarioHospDays', 14); setV('scenarioOcrDays', 0);
            setV('scenarioInjury', 'none'); setV('scenarioTnPct', 0);
            setC('scenarioRetroactive', true); setC('scenarioCriticalIllness', true); setC('scenarioDisability3', false);
        } else if (preset === 'disability3') {
            setV('scenarioPnDays', 180); setV('scenarioHospDays', 10); setV('scenarioOcrDays', 0);
            setV('scenarioInjury', 'none'); setV('scenarioTnPct', 0);
            setC('scenarioRetroactive', true); setC('scenarioCriticalIllness', false); setC('scenarioDisability3', true);
        } else if (preset === 'childCare') {
            setV('scenarioPnDays', 0); setV('scenarioHospDays', 7); setV('scenarioOcrDays', 30);
            setV('scenarioInjury', 'minor'); setV('scenarioTnPct', 0);
            setC('scenarioRetroactive', false); setC('scenarioCriticalIllness', false); setC('scenarioDisability3', false);
        }
        renderScenario();
        renderTnProgressionSim();
    }

    function readScenarioInputs() {
        return {
            person: document.getElementById('scenarioPerson') ? document.getElementById('scenarioPerson').value : '',
            pnDays: num(document.getElementById('scenarioPnDays')?.value),
            hospDays: num(document.getElementById('scenarioHospDays')?.value),
            ocrDays: num(document.getElementById('scenarioOcrDays')?.value),
            injury: document.getElementById('scenarioInjury') ? document.getElementById('scenarioInjury').value : 'minor',
            tnDamagePct: num(document.getElementById('scenarioTnPct')?.value),
            retroactive: !!document.getElementById('scenarioRetroactive')?.checked,
            includeCriticalIllness: !!document.getElementById('scenarioCriticalIllness')?.checked,
            includeDisability3: !!document.getElementById('scenarioDisability3')?.checked
        };
    }

    function computeScenarioForList(list, person, sc) {
        const personId = person.id;
        const items = (list || []).filter(c => c.clientId === personId);
        const sums = {};
        D.CATEGORIES.forEach(cat => { sums[cat.key] = items.reduce((s, c) => s + num(c.items && c.items[cat.key]), 0); });

        const maxProg = items.length ? Math.max(...items.map(c => num(c.conditions && c.conditions.tnProgression) || 400)) : 400;
        const hasContractRetro = items.some(c => c.conditions && c.conditions.pnRetroactive);
        const useRetro = sc.retroactive || hasContractRetro;

        const pnDays = num(sc.pnDays);
        const hospDays = num(sc.hospDays);
        const ocrDays = num(sc.ocrDays);
        const tnPct = num(sc.tnDamagePct);

        let urazPay = 0, urazVelkyPay = 0, zlomPay = 0;
        if (sc.injury === 'minor' || sc.injury === 'both') urazPay = sums.uraz * pnDays;
        if (sc.injury === 'major' || sc.injury === 'both') urazVelkyPay = sums.urazVelky * Math.max(0, pnDays - 28);
        if (sc.injury === 'both' || sc.injury === 'major') zlomPay = sums.zlomeninyPopaleniny;

        const hospPay = sums.hosp * hospDays;
        const hospUrazPay = (sc.injury !== 'none' ? sums.hospUraz * hospDays : 0);

        const pn15Pay = useRetro ? (pnDays >= 15 ? sums.pn15 * pnDays : 0) : sums.pn15 * Math.max(0, pnDays - 14);
        const pn28Pay = useRetro ? (pnDays >= 29 ? sums.pn28 * pnDays : 0) : sums.pn28 * Math.max(0, pnDays - 28);
        const pn61Pay = useRetro ? (pnDays >= 61 ? sums.pn61 * pnDays : 0) : sums.pn61 * Math.max(0, pnDays - 60);
        const ocrPay  = sums.osetrovani * Math.max(0, ocrDays - 9);
        const chirPay = (hospDays > 0 || sc.injury !== 'none') ? sums.chir : 0;

        /* Trvalé následky úrazu s progresí */
        let tnPay = 0;
        if (tnPct > 0) {
            const mult = D.computeTnProgressionMultiplier(tnPct, maxProg);
            tnPay += Math.round(sums.tnUraz * mult);
            if (tnPct >= 10) tnPay += Math.round(sums.tnUraz10 * mult);
        }

        const zoPay = sc.includeCriticalIllness ? (sums.zavOn + sums.zavOnKles + sums.zavOnMuzZena) : 0;
        const invPay = sc.includeDisability3 ? (sums.invalidita + sums.invKles) : 0;

        const lines = [
            { label: 'Denní odškodné úrazu (DOÚ)', rate: `${sums.uraz} Kč/d × ${pnDays} dní`, amount: urazPay, include: sc.injury !== 'none' && sc.injury !== 'major' && sums.uraz > 0 },
            { label: 'Vážný úraz (nad 28 dní)', rate: `${sums.urazVelky} Kč/d × ${Math.max(0, pnDays - 28)} dní`, amount: urazVelkyPay, include: (sc.injury === 'major' || sc.injury === 'both') && sums.urazVelky > 0 },
            { label: 'Zlomeniny a popáleniny', rate: 'jednorázové plnění', amount: zlomPay, include: zlomPay > 0 },
            { label: `Trvalé následky úrazu (${tnPct} %, progrese ${maxProg} %)`, rate: `základ ${fmtCZKShort(sums.tnUraz + sums.tnUraz10)} × koef. progrese`, amount: tnPay, include: tnPay > 0 },
            { label: 'Hospitalizace (nemoc / úraz)', rate: `${sums.hosp} Kč/d × ${hospDays} dní`, amount: hospPay, include: sums.hosp > 0 && hospDays > 0 },
            { label: 'Hospitalizace úrazem', rate: `${sums.hospUraz} Kč/d × ${hospDays} dní`, amount: hospUrazPay, include: hospUrazPay > 0 },
            { label: useRetro && pnDays >= 15 ? 'PN od 15. dne (zpětně od 1. dne)' : 'PN od 15. dne', rate: `${sums.pn15} Kč/d`, amount: pn15Pay, include: sums.pn15 > 0 && pnDays > 0 },
            { label: useRetro && pnDays >= 29 ? 'PN od 29. dne (zpětně od 1. dne)' : 'PN od 29. dne', rate: useRetro ? `${sums.pn28} Kč/d × ${pnDays} dní` : `${sums.pn28} Kč/d × ${Math.max(0, pnDays - 28)} dní`, amount: pn28Pay, include: sums.pn28 > 0 && pnDays > 0 },
            { label: useRetro && pnDays >= 61 ? 'PN od 61. dne (zpětně od 1. dne)' : 'PN od 61. dne', rate: useRetro ? `${sums.pn61} Kč/d × ${pnDays} dní` : `${sums.pn61} Kč/d × ${Math.max(0, pnDays - 60)} dní`, amount: pn61Pay, include: sums.pn61 > 0 && pnDays > 0 },
            { label: 'Ošetřování dítěte / člena rodiny (OČR)', rate: `${sums.osetrovani} Kč/d × ${Math.max(0, ocrDays - 9)} dní`, amount: ocrPay, include: sums.osetrovani > 0 && ocrDays > 0 },
            { label: 'Chirurgický zákrok', rate: `limit ${fmtCZKShort(sums.chir)}`, amount: chirPay, include: chirPay > 0 },
            { label: 'Závažné onemocnění (ZO)', rate: 'jednorázová výplata', amount: zoPay, include: zoPay > 0 },
            { label: 'Invalidita III. stupně', rate: 'jednorázová výplata', amount: invPay, include: invPay > 0 }
        ];
        const total = lines.filter(l => l.include).reduce((s, l) => s + l.amount, 0);
        return { lines, total };
    }

    function renderScenario() {
        const resEl = document.getElementById('scenarioResult');
        if (!resEl) return;
        if (!state.clients.length) {
            resEl.innerHTML = '<div class="text-xs text-slate-500 italic">Nejprve přidejte osoby a smlouvy.</div>';
            return;
        }
        refreshScenarioPersons();
        const sc = readScenarioInputs();
        state.scenario = sc;
        save();
        const person = state.clients.find(c => c.id === sc.person) || state.clients[0];
        if (!person) return;

        const curR = computeScenarioForList(state.currentContracts, person, sc);
        const newR = computeScenarioForList(state.proposedContracts, person, sc);

        const linesHtml = curR.lines.map((cl, i) => {
            const nl = newR.lines[i];
            if (!cl.include && !nl.include) return '';
            return `<div class="sc-line">
                <div class="font-medium text-slate-200">${escapeHtml(cl.label)}</div>
                <div class="sc-amount">${cl.include ? fmtCZK(cl.amount) : '<span class="text-slate-600">—</span>'}</div>
                <div class="sc-rate">${cl.include ? escapeHtml(cl.rate) : ''}</div>
                <div class="sc-amount font-semibold text-sky-300">${nl.include ? fmtCZK(nl.amount) : '<span class="text-slate-600">—</span>'}</div>
                <div class="sc-rate">${nl.include ? escapeHtml(nl.rate) : ''}</div>
            </div>`;
        }).join('');

        const diff = newR.total - curR.total;
        const diffClass = diff > 0 ? 'text-emerald-300 font-bold' : diff < 0 ? 'text-rose-300 font-bold' : 'text-slate-300';

        resEl.innerHTML = `
            <div class="border border-slate-800 rounded overflow-hidden">
                <div class="sc-line sc-line-header">
                    <div>Složka pojistného plnění (${escapeHtml(person.name)})</div>
                    <div class="sc-amount">Stávající Σ</div>
                    <div class="sc-rate">Stávající výpočet</div>
                    <div class="sc-amount">Návrh poradce Σ</div>
                    <div class="sc-rate">Návrh výpočet</div>
                </div>
                ${linesHtml || `<div class="text-xs text-slate-500 italic p-4">Pro zvolený scénář nevzniká v portfoliu plnění.</div>`}
                <div class="sc-line sc-line-total">
                    <div>Celková výplata z pojištění v tomto scénáři</div>
                    <div class="sc-amount">${fmtCZK(curR.total)}</div>
                    <div></div>
                    <div class="sc-amount text-sky-300">${fmtCZK(newR.total)}</div>
                    <div class="${diffClass} sc-rate">Rozdíl: ${(diff >= 0 ? '+' : '')}${fmtCZK(diff)}</div>
                </div>
            </div>
        `;

        renderIncomeCoverage(person, sc);
    }

    function renderTnProgressionSim() {
        const out = document.getElementById('tnProgressionSimOutput');
        const slider = document.getElementById('tnSimSlider');
        const lbl = document.getElementById('tnSimSliderLabel');
        if (!out || !slider) return;
        const pct = num(slider.value) || 35;
        if (lbl) lbl.textContent = pct + ' %';

        const personId = document.getElementById('scenarioPerson')?.value || (state.clients[0] && state.clients[0].id);
        const person = state.clients.find(c => c.id === personId) || state.clients[0];
        if (!person) return;

        const curItems = state.currentContracts.filter(c => c.clientId === person.id);
        const newItems = state.proposedContracts.filter(c => c.clientId === person.id);

        const curBase = sumItemFor(state.currentContracts, person.id, 'tnUraz') + (pct >= 10 ? sumItemFor(state.currentContracts, person.id, 'tnUraz10') : 0);
        const newBase = sumItemFor(state.proposedContracts, person.id, 'tnUraz') + (pct >= 10 ? sumItemFor(state.proposedContracts, person.id, 'tnUraz10') : 0);

        const curProg = curItems.length ? Math.max(...curItems.map(c => num(c.conditions && c.conditions.tnProgression) || 400)) : 400;
        const newProg = newItems.length ? Math.max(...newItems.map(c => num(c.conditions && c.conditions.tnProgression) || 800)) : 800;

        const checkpoints = [10, 25, 50, 75, 100];
        const curMultNow = D.computeTnProgressionMultiplier(pct, curProg);
        const newMultNow = D.computeTnProgressionMultiplier(pct, newProg);
        const curPayNow = Math.round(curBase * curMultNow);
        const newPayNow = Math.round(newBase * newMultNow);

        out.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div class="kpi-card">
                    <div class="text-[10px] uppercase text-slate-500 font-bold">Stávající výplata při ${pct}% poškození</div>
                    <div class="text-xl font-bold font-mono text-slate-300">${fmtCZK(curPayNow)}</div>
                    <div class="text-[10px] text-slate-500">Základ ${fmtCZK(curBase)} · Progrese max. ${curProg} %</div>
                </div>
                <div class="kpi-card border-sky-500/40">
                    <div class="text-[10px] uppercase text-sky-400 font-bold">Navrhovaná výplata při ${pct}% poškození</div>
                    <div class="text-xl font-bold font-mono text-sky-300">${fmtCZK(newPayNow)}</div>
                    <div class="text-[10px] text-slate-400">Základ ${fmtCZK(newBase)} · Progrese max. ${newProg} % (efektivně ${(newMultNow * 100).toFixed(0)} %)</div>
                </div>
                <div class="kpi-card border-emerald-500/40">
                    <div class="text-[10px] uppercase text-emerald-400 font-bold">Navýšení plnění díky Návrhu</div>
                    <div class="text-xl font-bold font-mono text-emerald-300">${newPayNow - curPayNow >= 0 ? '+' : ''}${fmtCZK(newPayNow - curPayNow)}</div>
                    <div class="text-[10px] text-slate-400">Pro osobu: ${escapeHtml(person.name)}</div>
                </div>
            </div>
            <div class="overflow-x-auto">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Rozsah trvalých následků úrazu</th>
                            ${checkpoints.map(cp => `<th class="num ${cp === pct ? 'text-orange-300' : ''}">Poškození ${cp} %</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong>Stávající portfolio</strong> (progrese ${curProg} %)</td>
                            ${checkpoints.map(cp => {
                                const b = sumItemFor(state.currentContracts, person.id, 'tnUraz') + (cp >= 10 ? sumItemFor(state.currentContracts, person.id, 'tnUraz10') : 0);
                                return `<td class="num text-slate-400">${fmtCZK(Math.round(b * D.computeTnProgressionMultiplier(cp, curProg)))}</td>`;
                            }).join('')}
                        </tr>
                        <tr>
                            <td><strong class="text-sky-300">Návrh poradce</strong> (progrese ${newProg} %)</td>
                            ${checkpoints.map(cp => {
                                const b = sumItemFor(state.proposedContracts, person.id, 'tnUraz') + (cp >= 10 ? sumItemFor(state.proposedContracts, person.id, 'tnUraz10') : 0);
                                return `<td class="num font-bold text-sky-300">${fmtCZK(Math.round(b * D.computeTnProgressionMultiplier(cp, newProg)))}</td>`;
                            }).join('')}
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    function computeMonthlyIncomeCoverage(list, person) {
        const personId = person.id;
        const sumPn15 = sumItemFor(list, personId, 'pn15');
        const sumPn28 = sumItemFor(list, personId, 'pn28');
        const sumPn61 = sumItemFor(list, personId, 'pn61');
        const dailyPn = sumPn15 + sumPn28 + sumPn61;
        const monthlyFromInsurance = dailyPn * 30;

        const sick = D.computeExactSickLeave(person.incomeGross, person.isEntrepreneur, 60);
        const stateBenefit = sick.monthlyAvg;
        return { stateBenefit, insurance: monthlyFromInsurance, total: stateBenefit + monthlyFromInsurance };
    }

    function renderIncomeCoverage(person, sc) {
        const cur = computeMonthlyIncomeCoverage(state.currentContracts, person);
        const nw  = computeMonthlyIncomeCoverage(state.proposedContracts, person);
        const gross = num(person.incomeGross);
        const net = D.computeNetIncome(gross, person.isEntrepreneur);
        const curPct = net > 0 ? Math.min(150, cur.total / net * 100) : 0;
        const newPct = net > 0 ? Math.min(150, nw.total / net * 100) : 0;
        const meter = (pct) => `<div class="meter mt-1.5"><div class="fill ${pct >= 85 ? 'fill-good' : pct >= 60 ? 'fill-warn' : 'fill-danger'}" style="width:${Math.min(100, pct)}%"></div></div>`;

        document.getElementById('incomeCoverage').innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="kpi-card">
                    <div class="text-[10px] uppercase text-slate-400 font-bold mb-2">Stávající portfolio — Měsíční bilance v PN (${escapeHtml(person.name)})</div>
                    <div class="space-y-1 text-xs text-slate-300">
                        <div class="flex justify-between"><span>Čistý měsíční příjem:</span><span class="font-mono font-semibold">${fmtCZK(net)}</span></div>
                        <div class="flex justify-between"><span>Nemocenská ČSSZ (2026):</span><span class="font-mono">${fmtCZK(cur.stateBenefit)}</span></div>
                        <div class="flex justify-between"><span>Z pojistek (denní dávky PN × 30 dní):</span><span class="font-mono">${fmtCZK(cur.insurance)}</span></div>
                        <div class="flex justify-between border-t border-slate-800 pt-1 mt-1 font-bold"><span>Celkový příjem v PN / měs:</span><span class="font-mono text-emerald-300">${fmtCZK(cur.total)}</span></div>
                        <div class="text-[10px] text-slate-400">Pokrytí čistého příjmu: <strong>${curPct.toFixed(0)} %</strong> (chybí ${fmtCZK(Math.max(0, net - cur.total))}/měs)</div>
                        ${meter(curPct)}
                    </div>
                </div>
                <div class="kpi-card border-sky-500/30">
                    <div class="text-[10px] uppercase text-sky-400 font-bold mb-2">Návrh poradce — Měsíční bilance v PN (${escapeHtml(person.name)})</div>
                    <div class="space-y-1 text-xs text-slate-300">
                        <div class="flex justify-between"><span>Čistý měsíční příjem:</span><span class="font-mono font-semibold">${fmtCZK(net)}</span></div>
                        <div class="flex justify-between"><span>Nemocenská ČSSZ (2026):</span><span class="font-mono">${fmtCZK(nw.stateBenefit)}</span></div>
                        <div class="flex justify-between"><span>Z pojistek (denní dávky PN × 30 dní):</span><span class="font-mono text-sky-300">${fmtCZK(nw.insurance)}</span></div>
                        <div class="flex justify-between border-t border-slate-800 pt-1 mt-1 font-bold"><span>Celkový příjem v PN / měs:</span><span class="font-mono text-sky-300">${fmtCZK(nw.total)}</span></div>
                        <div class="text-[10px] text-slate-400">Pokrytí čistého příjmu: <strong>${newPct.toFixed(0)} %</strong> (chybí ${fmtCZK(Math.max(0, net - nw.total))}/měs)</div>
                        ${meter(newPct)}
                    </div>
                </div>
            </div>
        `;
    }

    /* ════════════ TAB 7: COMPARISON, CONTRACT ACTION ROADMAP & CHARTS ════════════ */
    let chartInstance = null;
    let radarChartInstance = null;

    function refreshCompareFilter() {
        const sel = document.getElementById('compareFilter');
        if (!sel) return;
        const cur = sel.value || 'ALL';
        sel.innerHTML = '<option value="ALL">Souhrn – celá rodina</option>' +
            state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        sel.value = cur;
    }

    function renderContractActionSummary() {
        const el = document.getElementById('contractActionSummary');
        if (!el) return;

        const curRows = state.currentContracts.map(c => `
            <tr>
                <td><strong>${escapeHtml(clientName(c.clientId))}</strong></td>
                <td>${escapeHtml(c.insurer || '—')} <span class="font-mono text-slate-400 text-[10px]">(${escapeHtml(c.contractNo || '—')})</span></td>
                <td class="num">${fmtCZK(contractMonthlyPremium(c))}</td>
                <td>${actionBadgeHtml(c, 'current')}</td>
                <td class="text-slate-300 text-[11px]">${escapeHtml(c.actionReason || c.note || '—')}</td>
            </tr>
        `).join('');

        const newOnly = state.proposedContracts.filter(c => c.proposalStatus === 'new' || c.proposalStatus === 'modified');
        const newRows = newOnly.map(c => `
            <tr>
                <td><strong>${escapeHtml(clientName(c.clientId))}</strong></td>
                <td>${escapeHtml(c.insurer || '—')} <span class="font-mono text-slate-400 text-[10px]">(${escapeHtml(c.contractNo || '—')})</span></td>
                <td class="num text-sky-300 font-bold">${fmtCZK(contractMonthlyPremium(c))}</td>
                <td>${actionBadgeHtml(c, 'proposed')}</td>
                <td class="text-slate-300 text-[11px]">${escapeHtml(c.actionReason || c.note || '—')}</td>
            </tr>
        `).join('');

        el.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                    <div class="text-xs font-bold uppercase text-slate-400 mb-1.5">A) Co udělat se stávajícími smlouvami klienta (${state.currentContracts.length})</div>
                    <div class="overflow-x-auto border border-slate-800 rounded">
                        <table class="data-table">
                            <thead>
                                <tr><th>Osoba</th><th>Smlouva</th><th class="num">Platba</th><th>Krok</th><th>Zdůvodnění poradce</th></tr>
                            </thead>
                            <tbody>${curRows || '<tr><td colspan="5" class="text-center text-slate-500 italic py-2">Žádné stávající smlouvy</td></tr>'}</tbody>
                        </table>
                    </div>
                </div>
                <div>
                    <div class="text-xs font-bold uppercase text-sky-400 mb-1.5">B) Nově sjednávané / upravované smlouvy v Návrhu (${newOnly.length})</div>
                    <div class="overflow-x-auto border border-slate-800 rounded">
                        <table class="data-table">
                            <thead>
                                <tr><th>Osoba</th><th>Nová smlouva</th><th class="num">Platba</th><th>Status</th><th>Účel v modelaci poradce</th></tr>
                            </thead>
                            <tbody>${newRows || '<tr><td colspan="5" class="text-center text-slate-500 italic py-2">Žádné nové smlouvy</td></tr>'}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    function renderComparison() {
        refreshCompareFilter();
        renderContractActionSummary();
        const filter = document.getElementById('compareFilter')?.value || 'ALL';
        const catMode = document.getElementById('compareCatMode')?.value || 'active';
        const filterList = (list) => filter === 'ALL' ? list : list.filter(c => c.clientId === filter);
        const cur = filterList(state.currentContracts);
        const nw  = filterList(state.proposedContracts);

        let html = `
            <div class="cmp-row cmp-row-header">
                <div>Pojistné riziko / kategorie</div>
                <div class="text-right">Stávající PČ</div>
                <div class="text-right text-amber-300/90">Stáv. pojistné</div>
                <div class="text-right">Návrh PČ</div>
                <div class="text-right text-sky-300/90">Návrh pojistné</div>
                <div class="text-right">Rozdíl PČ &amp; ceny (Δ)</div>
                <div class="text-right">Hodnocení změny</div>
            </div>
        `;

        let totalCurItemPrem = 0;
        let totalNwItemPrem = 0;

        D.CATEGORY_GROUPS.forEach(grp => {
            const grpCats = D.CATEGORIES.filter(cat => {
                if (cat.group !== grp.key) return false;
                if (catMode === 'all') return true;
                const cv = cur.reduce((s, c) => s + num(c.items && c.items[cat.key]), 0);
                const nv = nw.reduce((s, c) => s + num(c.items && c.items[cat.key]), 0);
                const cp = sumItemPremium(cur, cat.key);
                const np = sumItemPremium(nw, cat.key);
                return cat.core || cv > 0 || nv > 0 || cp > 0 || np > 0;
            });
            if (!grpCats.length) return;

            const grpCurPrem = sumGroupPremium(cur, grp.key, 'ALL');
            const grpNwPrem  = sumGroupPremium(nw, grp.key, 'ALL');
            const grpPremDiff = grpNwPrem - grpCurPrem;

            html += `<div class="cmp-group-header flex items-center justify-between flex-wrap gap-2">
                <span>${escapeHtml(grp.label)}</span>
                <span class="text-[10px] font-mono font-normal text-slate-300">
                    Pojistné bloku: <strong class="text-amber-300">${fmt(grpCurPrem)} Kč/měs</strong>
                    → <strong class="text-sky-300">${fmt(grpNwPrem)} Kč/měs</strong>
                    (${grpPremDiff === 0 ? '±0' : (grpPremDiff > 0 ? '+' : '') + fmt(grpPremDiff)} Kč/měs)
                </span>
            </div>`;

            grpCats.forEach(cat => {
                const cv = cur.reduce((s, c) => s + num(c.items && c.items[cat.key]), 0);
                const nv = nw.reduce((s, c) => s + num(c.items && c.items[cat.key]), 0);
                const cp = sumItemPremium(cur, cat.key);
                const np = sumItemPremium(nw, cat.key);
                totalCurItemPrem += cp;
                totalNwItemPrem += np;

                const diff = nv - cv;
                const diffP = np - cp;
                const cls = diff > 0 ? 'v-diff-pos' : diff < 0 ? 'v-diff-neg' : 'v-diff-zero';
                const pDiffCls = diffP > 0 ? 'text-amber-300' : diffP < 0 ? 'text-emerald-400' : 'text-slate-500';

                let verdict = '<span class="text-slate-600">Beze změny</span>';
                if (cv === 0 && nv > 0) verdict = '<span class="badge badge-sky">★ Nově doplněno</span>';
                else if (diff > 0 && diffP <= 0) verdict = '<span class="badge badge-emerald">▲ Vyšší PČ levněji</span>';
                else if (diff > 0)      verdict = '<span class="badge badge-emerald">▲ Posíleno</span>';
                else if (cv > 0 && nv === 0) verdict = '<span class="badge badge-amber">Odebráno</span>';
                else if (diff < 0)      verdict = '<span class="badge badge-slate">Optimalizováno</span>';
                else if (cv > 0 && diff === 0 && diffP < 0) verdict = '<span class="badge badge-emerald">✓ Stejná PČ levněji</span>';
                else if (cv > 0 && diff === 0) verdict = '<span class="text-emerald-400 text-[11px]">● Zachováno</span>';

                html += `<div class="cmp-row">
                    <div>
                        <div class="text-xs font-semibold text-slate-200">${escapeHtml(cat.label)}</div>
                        <div class="text-[10px] text-slate-500">${escapeHtml(cat.help.slice(0, 90))}${cat.help.length > 90 ? '…' : ''}</div>
                    </div>
                    <div class="v v-curr">${fmtCatValue(cv, cat)}</div>
                    <div class="v font-mono text-[11px] ${cp > 0 ? 'text-amber-300 font-semibold' : 'text-slate-600'}">${cp > 0 ? fmt(cp) + ' Kč' : '—'}</div>
                    <div class="v v-new">${fmtCatValue(nv, cat)}</div>
                    <div class="v font-mono text-[11px] ${np > 0 ? 'text-sky-300 font-semibold' : 'text-slate-600'}">${np > 0 ? fmt(np) + ' Kč' : '—'}</div>
                    <div class="v ${cls}">
                        <div>${diff === 0 ? '±0' : (diff > 0 ? '+' : '') + fmtCatValue(diff, cat)}</div>
                        ${(cp > 0 || np > 0) ? `<div class="text-[10px] font-mono ${pDiffCls}">Poj.: ${diffP === 0 ? '±0' : (diffP > 0 ? '+' : '') + fmt(diffP)} Kč/měs</div>` : ''}
                    </div>
                    <div class="text-right">${verdict}</div>
                </div>`;
            });
        });

        const curM = totalPremiumMonthly(cur);
        const newM = totalPremiumMonthly(nw);
        const diffPrem = newM - curM;
        const diffItemPrem = totalNwItemPrem - totalCurItemPrem;
        const premCls = diffPrem > 0 ? 'v-diff-neg' : diffPrem < 0 ? 'v-diff-pos' : 'v-diff-zero';

        html += `
            <div class="cmp-row" style="background:#131e34 !important; border-top:2px solid #334155;">
                <div class="text-xs font-bold text-slate-100">
                    <div>Měsíční pojistné celkem</div>
                    <div class="text-[10px] font-normal text-slate-400">Součet položek PČ a měsíčního pojistného</div>
                </div>
                <div class="v v-curr font-bold text-[11px] text-slate-400">Σ smluv: ${cur.length}</div>
                <div class="v font-mono font-bold text-amber-300">${fmtCZK(curM)}<div class="text-[9px] font-normal text-slate-400">položky: ${fmt(totalCurItemPrem)} Kč</div></div>
                <div class="v v-new font-bold text-[11px] text-slate-400">Σ smluv: ${nw.length}</div>
                <div class="v font-mono font-bold text-sky-300">${fmtCZK(newM)}<div class="text-[9px] font-normal text-slate-400">položky: ${fmt(totalNwItemPrem)} Kč</div></div>
                <div class="v ${premCls} font-bold">
                    <div>${diffPrem === 0 ? '±0' : (diffPrem > 0 ? '+' : '') + fmtCZK(diffPrem)}</div>
                    <div class="text-[10px] font-normal text-slate-400">Δ položek: ${diffItemPrem > 0 ? '+' : ''}${fmt(diffItemPrem)} Kč</div>
                </div>
                <div class="text-right text-[11px] text-slate-300 font-mono">${fmtCZK(newM * 12)} / rok</div>
            </div>
        `;

        document.getElementById('comparisonContent').innerHTML = html;

        renderRecommendations(cur, nw, filter);
        renderRadarChart(filter);
        renderCategoryChart(cur, nw);
    }

    function renderRadarChart(filter) {
        const ctx = document.getElementById('radarChart');
        if (!ctx) return;
        const curP = computePortfolioPillars(state.currentContracts, filter);
        const newP = computePortfolioPillars(state.proposedContracts, filter);

        if (radarChartInstance) radarChartInstance.destroy();
        radarChartInstance = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: curP.labels,
                datasets: [
                    {
                        label: `Stávající stav (${curP.overall} %)`,
                        data: curP.scores,
                        backgroundColor: 'rgba(16, 185, 129, 0.18)',
                        borderColor: 'rgba(16, 185, 129, 0.9)',
                        pointBackgroundColor: '#10b981',
                        borderWidth: 2
                    },
                    {
                        label: `Návrh poradce (${newP.overall} %)`,
                        data: newP.scores,
                        backgroundColor: 'rgba(14, 165, 233, 0.25)',
                        borderColor: 'rgba(56, 189, 248, 1)',
                        pointBackgroundColor: '#38bdf8',
                        borderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        min: 0,
                        max: 100,
                        ticks: { stepSize: 25, color: '#64748b', backdropColor: 'transparent', font: { size: 9 } },
                        grid: { color: 'rgba(51, 65, 85, 0.5)' },
                        angleLines: { color: 'rgba(51, 65, 85, 0.5)' },
                        pointLabels: { color: '#cbd5e1', font: { size: 11, weight: '600' } }
                    }
                },
                plugins: {
                    legend: { labels: { color: '#cbd5e1', font: { size: 11 } } }
                }
            }
        });
    }

    function renderCategoryChart(cur, nw) {
        const ctx = document.getElementById('categoryChart');
        if (!ctx) return;
        const activeSumCats = D.CATEGORIES.filter(c =>
            c.kind === 'sum' && (sumItem(cur, c.key) > 0 || sumItem(nw, c.key) > 0 || ['smrt', 'invalidita', 'zavOn', 'tnUraz'].includes(c.key))
        );
        const labels = activeSumCats.map(c => c.short);
        const dataCur = activeSumCats.map(c => cur.reduce((s, x) => s + num(x.items && x.items[c.key]), 0));
        const dataNw  = activeSumCats.map(c => nw.reduce((s, x) => s + num(x.items && x.items[c.key]), 0));

        if (chartInstance) chartInstance.destroy();
        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Stávající (Kč)', data: dataCur, backgroundColor: 'rgba(16,185,129,0.7)', borderColor: 'rgba(16,185,129,1)', borderWidth: 1 },
                    { label: 'Návrh poradce (Kč)', data: dataNw, backgroundColor: 'rgba(14,165,233,0.75)', borderColor: 'rgba(14,165,233,1)', borderWidth: 1 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#cbd5e1', font: { size: 11 } } },
                    tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + fmtCZK(ctx.parsed.y) } }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(30,41,59,0.5)' } },
                    y: { ticks: { color: '#94a3b8', font: { size: 10 }, callback: (v) => v >= 1e6 ? (v / 1e6) + 'M' : v >= 1e3 ? (v / 1e3) + 'k' : v }, grid: { color: 'rgba(30,41,59,0.5)' } }
                }
            }
        });
    }

    function renderRecommendations(cur, nw, filter) {
        const recos = [];
        const personLabel = filter === 'ALL' ? 'za celou rodinu' : 'pro osobu ' + clientName(filter);

        /* 1. Podpojištění úvěrů (Smrt + Smrt klesající) */
        const loans = filter === 'ALL' ? sumLoans() : sumLoansFor(filter);
        const smrtCur = effectiveDeathCover(cur);
        const smrtNw  = effectiveDeathCover(nw);
        if (loans > 0) {
            if (smrtCur < loans) {
                recos.push({ type: 'danger', icon: 'alert-triangle',
                    text: `<strong>Kritické podpojištění úvěrů ve stávajícím stavu (${escapeHtml(personLabel)}):</strong> Celkové krytí smrti (${fmtCZK(smrtCur)}) je o <strong>${fmtCZK(loans - smrtCur)} nižší než nesplacené závazky</strong> (${fmtCZK(loans)}).` });
            }
            if (smrtNw >= loans) {
                recos.push({ type: 'success', icon: 'check-circle',
                    text: `<strong>Návrh poradce plně zajišťuje úvěry:</strong> Kombinace konstantní a klesající PČ smrti (${fmtCZK(smrtNw)}) pokrývá 100 % závazků (${fmtCZK(loans)}) a vytváří rezervu +${fmtCZK(smrtNw - loans)}.` });
            } else {
                recos.push({ type: 'warning', icon: 'alert-circle',
                    text: `<strong>Upozornění k návrhu:</strong> Krytí smrti (${fmtCZK(smrtNw)}) je stále o ${fmtCZK(loans - smrtNw)} nižší než závazky (${fmtCZK(loans)}). Zvažte navýšení klesající PČ.` });
            }
        }

        /* 2. Invalidita I., II., III. stupně */
        const inv3Cur = effectiveInv3Cover(cur);
        const inv3Nw  = effectiveInv3Cover(nw);
        const inv1Nw  = effectiveInv1Cover(nw);
        if (inv3Cur < 500000 && inv3Nw >= 1500000) {
            recos.push({ type: 'success', icon: 'shield-check',
                text: `<strong>Zásadní posílení krytí invalidity:</strong> Stávající portfolio krylo invaliditu pouze na ${fmtCZK(inv3Cur)}, návrh poradce ji navyšuje na <strong>${fmtCZK(inv3Nw)}</strong>${inv1Nw > 0 ? ` (včetně I. stupně na ${fmtCZK(inv1Nw)})` : ''}.` });
        } else if (loans > 0 && inv3Nw < loans * 0.5) {
            recos.push({ type: 'warning', icon: 'shield-alert',
                text: `<strong>Nízké krytí invalidity vůči závazkům:</strong> Navržená invalidita (${fmtCZK(inv3Nw)}) nedosahuje ani 50 % výše úvěrů (${fmtCZK(loans)}).` });
        }

        /* 3. Kontrola zachovaných smluv (zdravotní stav / čekací doby) */
        const keptContracts = (filter === 'ALL' ? state.currentContracts : cur).filter(c => c.actionStatus === 'keep');
        if (keptContracts.length > 0) {
            recos.push({ type: 'info', icon: 'lock',
                text: `<strong>Ochrana zdravotní historie (Ponechané smlouvy: ${keptContracts.length}×):</strong> Poradce doporučuje ponechat smlouvy ${keptContracts.map(k => `<em>${escapeHtml(k.insurer)} č. ${escapeHtml(k.contractNo)}</em>`).join(', ')} beze změny, aby klient nepřišel o bezvýlukové krytí sjednané v minulosti.` });
        }

        /* 4. Bezpečný přechod u rušených smluv */
        const canceledContracts = (filter === 'ALL' ? state.currentContracts : cur).filter(c => c.actionStatus === 'cancel' || c.actionStatus === 'consolidate');
        if (canceledContracts.length > 0) {
            recos.push({ type: 'warning', icon: 'clock',
                text: `<strong>Bezpečný postup při rušení starých smluv (${canceledContracts.length}×):</strong> Výpověď smluv (${canceledContracts.map(k => escapeHtml(k.contractNo || k.insurer)).join(', ')}) podejte <strong>až po potvrzení přijetí nové smlouvy do pojištění</strong> (dokončení lékařského/finančního ocenění).` });
        }

        document.getElementById('recommendationsList').innerHTML = recos.map(r =>
            `<div class="reco reco-${r.type}">
                <span class="reco-icon"><i data-lucide="${r.icon}" class="w-4 h-4"></i></span>
                <div>${r.text}</div>
            </div>`).join('');
        if (window.lucide) lucide.createIcons();
    }

    /* ════════════ AI / GROQ ════════════ */
    function getApiKey() { return lsGet('groq_api_key') || getCookie('groq_api_key') || ''; }
    function getModel()  { return lsGet('groq_model') || 'llama-3.3-70b-versatile'; }

    function buildPortfolioContext() {
        const totalCurMonthly = totalPremiumMonthly(state.currentContracts);
        const totalNewMonthly = totalPremiumMonthly(state.proposedContracts);
        return {
            klienti: state.clients.map(c => ({
                jmeno: c.name, role: c.role, rok_narozeni: c.birthYear,
                hruby_prijem_kc: c.incomeGross, cisty_prijem_kc: D.computeNetIncome(c.incomeGross, c.isEntrepreneur),
                OSVC: c.isEntrepreneur, poznamka: c.notes
            })),
            uvery_celkem_kc: sumLoans(),
            uvery_polozky: state.loans.map(l => ({ nazev: l.name, vyse_kc: l.amount, splatka_kc: l.monthlyPayment, klient: clientName(l.linkedClientId) })),
            stavajici_smlouvy: state.currentContracts.map(c => ({
                klient: clientName(c.clientId), pojistovna: c.insurer, cislo: c.contractNo,
                doporuceni_poradce: c.actionStatus, duvod: c.actionReason || c.note,
                platba_mesicni_kc: contractMonthlyPremium(c),
                kryti: Object.fromEntries(D.CATEGORIES.map(cat => [cat.short, c.items && c.items[cat.key] || 0]).filter(([_, v]) => v > 0)),
                podminky: c.conditions
            })),
            navrhovane_smlouvy: state.proposedContracts.map(c => ({
                klient: clientName(c.clientId), pojistovna: c.insurer, cislo: c.contractNo,
                status_v_navrhu: c.proposalStatus, duvod: c.actionReason || c.note,
                platba_mesicni_kc: contractMonthlyPremium(c),
                kryti: Object.fromEntries(D.CATEGORIES.map(cat => [cat.short, c.items && c.items[cat.key] || 0]).filter(([_, v]) => v > 0)),
                podminky: c.conditions
            })),
            celkove_mesicni_platby: { stavajici: totalCurMonthly, navrh: totalNewMonthly, rozdil: totalNewMonthly - totalCurMonthly },
            zadani_klienta: state.adviserBrief,
            hlavni_doporuceni_poradce: state.advisorRecommendation
        };
    }

    function aiPrompt(taskType, customQ) {
        const portfolioJson = JSON.stringify(buildPortfolioContext(), null, 2);
        const sys = `Jsi zkušený český finanční a pojistný poradce (standard EFPA ČR) a metodik životního pojištění. Mluvíš česky, věcně a strukturovaně v Markdownu. Čísla formátuj s mezerou (např. 3 000 000 Kč). Znáš zákon č. 170/2018 Sb., občanský zákoník, redukční hranice ČSSZ 2026 a produkty českých pojišťoven.`;
        const tasks = {
            overall: `Proveď komplexní vyhodnocení stávajícího a navrhovaného portfolia vůči zadání klienta a úvěrům. Vyzdvihni klíčové slabiny stávajícího stavu, přínosy návrhu poradce, ochranu zdravotní historie (ponechané smlouvy) a případné návrhy na doladění.`,
            underinsurance: `Detailně posuď každou osobu z hlediska podpojištění či přepojištění (smrt konstantní + klesající vs. úvěry, invalidita I.–III. st., závažná onemocnění, TN s progresí, PN a OČR). Uveď konkrétní čísla.`,
            conditions: `Zhodnoť pojistné podmínky smluv: progresi TN (400 % vs. 800/1000 %), klauzuli PN zpětně od 1. dne, krytí psychických onemocnění a zad, čekací doby při přechodu mezi smlouvami.`,
            cost: `Zpracuj přesvědčivou Cost-Benefit analýzu pro klienta: co přesně klient získává za rozdíl v měsíčním pojistném, jak fungují klesající částky k hypotéce a jak využít příspěvek zaměstnavatele a daňový odpočet.`,
            legal: `Připrav strukturovaný text přímo do **Záznamu z jednání dle § 79 zákona č. 170/2018 Sb.**: 1) Požadavky a cíle klienta, 2) Zjištěná fakta a analýza potřeb, 3) Konkrétní doporučení poradce (které smlouvy ponechat, které vypovědět a které nově sjednat), 4) Odůvodnění vhodnosti a upozornění na čekací doby.`,
            custom: customQ || 'Zhodnoť toto portfolio.'
        };
        return [
            { role: 'system', content: sys },
            { role: 'user', content: `${tasks[taskType] || tasks.overall}\n\n### DATA PORTFOLIA:\n\`\`\`json\n${portfolioJson}\n\`\`\`` }
        ];
    }

    async function callGroq(messages) {
        const apiKey = getApiKey();
        if (!apiKey) throw new Error('Není nastaven Groq API klíč (záložka Nastavení & Tisk).');
        const model = getModel();
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 3500 })
        });
        if (!res.ok) {
            const t = await res.text();
            throw new Error('Groq ' + res.status + ': ' + t.slice(0, 300));
        }
        const json = await res.json();
        return (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
    }

    function markdownToHtml(md) {
        let s = escapeHtml(md);
        s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
        s = s.replace(/^---$/gm, '<hr>');
        s = s.replace(/(^|\n)([-*]) (.+(?:\n[-*] .+)*)/g, (m, pre, _, items) => {
            const li = items.split(/\n[-*] /).map(t => '<li>' + t.replace(/^[-*] /, '') + '</li>').join('');
            return pre + '<ul>' + li + '</ul>';
        });
        s = s.split(/\n\n+/).map(p => {
            if (/^<(h\d|ul|ol|hr|pre|blockquote)/.test(p.trim())) return p;
            return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
        }).join('\n');
        return s;
    }

    async function runAiAnalysis() {
        const out = document.getElementById('aiOutput');
        const btn = document.getElementById('aiRunBtn');
        const taskType = document.getElementById('aiTaskType').value;
        const customQ = document.getElementById('aiCustomQuestion').value;
        out.innerHTML = '<div class="text-slate-400 italic">⏳ AI analyzuje portfolio…</div>';
        btn.disabled = true;
        try {
            const msgs = aiPrompt(taskType, customQ);
            const text = await callGroq(msgs);
            out.innerHTML = markdownToHtml(text);
        } catch (e) {
            out.innerHTML = `<div class="reco reco-danger">
                <span class="reco-icon"><i data-lucide="alert-octagon" class="w-4 h-4"></i></span>
                <div><strong>Chyba volání AI:</strong> ${escapeHtml(e.message || String(e))}</div>
            </div>`;
            if (window.lucide) lucide.createIcons();
        } finally {
            btn.disabled = false;
        }
    }

    function renderAiPanel() {
        const sel = document.getElementById('aiTaskType');
        const custom = document.getElementById('aiCustomQuestion');
        if (sel && custom) custom.classList.toggle('hidden', sel.value !== 'custom');
    }
    function openAiPanel() { switchTab('ai'); }

    /* ════════════ BULK IMPORT (AI) ════════════ */
    let bulkTarget = 'current';
    function bulkImport(which) {
        bulkTarget = which;
        document.getElementById('bulkInput').value = '';
        document.getElementById('bulkModal').classList.remove('hidden');
        document.getElementById('bulkModal').classList.add('flex');
    }
    function closeBulkModal() {
        document.getElementById('bulkModal').classList.add('hidden');
        document.getElementById('bulkModal').classList.remove('flex');
    }
    async function runBulkParse() {
        const input = document.getElementById('bulkInput').value.trim();
        if (!input) { toast('Zadejte text k parsování', 'info'); return; }
        const btn = document.getElementById('bulkParseBtn');
        btn.disabled = true;
        try {
            const clientList = state.clients.map(c => `${c.id} = ${c.name}`).join('; ') || '(žádní klienti)';
            const insurerList = D.INSURER_NAMES.join(', ');
            const categoryList = D.CATEGORIES.map(c => `${c.key} (${c.label})`).join(', ');
            const messages = [
                { role: 'system', content: `Jsi parser pojistných smluv. Z volně zadaného textu vytvoříš strukturované JSON pole. Vracíš POUZE platný JSON array.` },
                { role: 'user', content: `Pojistné kategorie (klíče): ${categoryList}.\nPojišťovny: ${insurerList}.\nKlienti: ${clientList}.\n\nVrať JSON pole objektů: [{ "clientName": "...", "insurer": "...", "contractNo": "...", "start": rok, "end": rok, "premium": cislo_mesicne, "items": { "smrt": 0, ... }, "note": "..." }]\n\nTEXT:\n${input}` }
            ];
            const text = await callGroq(messages);
            const match = text.match(/\[[\s\S]*\]/);
            if (!match) throw new Error('AI nevrátila JSON pole.');
            const parsed = JSON.parse(match[0]);
            let added = 0;
            parsed.forEach(item => {
                const target = bulkTarget === 'current' ? state.currentContracts : state.proposedContracts;
                let clientId = state.clients[0] ? state.clients[0].id : '';
                if (item.clientName) {
                    const found = state.clients.find(c => c.name.toLowerCase().includes(String(item.clientName).toLowerCase()));
                    if (found) clientId = found.id;
                }
                const newC = emptyContract(clientId, bulkTarget);
                newC.insurer = item.insurer || '';
                newC.contractNo = item.contractNo || '';
                newC.start = item.start || null;
                newC.end   = item.end   || null;
                newC.premium = num(item.premium);
                newC.note = item.note || '';
                newC.actionReason = item.note || '';
                if (item.items) {
                    D.CATEGORIES.forEach(cat => {
                        if (item.items[cat.key] != null) newC.items[cat.key] = num(item.items[cat.key]);
                    });
                }
                target.push(newC);
                added++;
            });
            save(); closeBulkModal(); renderAll();
            toast(`AI naimportovala ${added} smluv`, 'success');
        } catch (e) {
            toast('Chyba parsování: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    /* ════════════════════════════════════════════════════════════════════
       NAHRÁNÍ DOKUMENTU SMLOUVY (PDF / SKEN / FOTKA / TEXT) & PARSER ČESKÝCH POJIŠŤOVEN
       ════════════════════════════════════════════════════════════════════ */
    let docUploadTarget = 'current';
    let lastExtractedContract = null;
    let lastUploadedImages = [];

    function openDocUploadModal(which) {
        docUploadTarget = which || 'current';
        lastExtractedContract = null;
        lastUploadedImages = [];
        const titleEl = document.getElementById('docUploadModalTitle');
        if (titleEl) {
            titleEl.textContent = docUploadTarget === 'current'
                ? 'Nahrát dokument platné smlouvy a automaticky vyplnit Stávající smlouvy'
                : 'Nahrát dokument nabídky / modelace a automaticky vyplnit Návrh poradce';
        }
        const st = document.getElementById('docUploadStatus');
        const prev = document.getElementById('docExtractedPreview');
        const rawEl = document.getElementById('docRawTextInput');
        const btnForm = document.getElementById('docOpenInFormBtn');
        const btnSave = document.getElementById('docSaveDirectBtn');
        const fInput = document.getElementById('docFileInput');
        if (st) st.classList.add('hidden');
        if (prev) { prev.classList.add('hidden'); prev.innerHTML = ''; }
        if (rawEl) rawEl.value = '';
        if (btnForm) btnForm.classList.add('hidden');
        if (btnSave) btnSave.classList.add('hidden');
        if (fInput) fInput.value = '';

        const m = document.getElementById('docUploadModal');
        if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
        if (window.lucide) lucide.createIcons();
    }

    function closeDocUploadModal() {
        const m = document.getElementById('docUploadModal');
        if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    }

    async function ensurePdfJs() {
        if (window.pdfjsLib) {
            if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            }
            return window.pdfjsLib;
        }
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            s.onload = () => {
                if (window.pdfjsLib) {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                    resolve(window.pdfjsLib);
                } else {
                    reject(new Error('Knihovna PDF.js se nenačetla.'));
                }
            };
            s.onerror = () => reject(new Error('Nelze načíst knihovnu PDF.js z CDN.'));
            document.head.appendChild(s);
        });
    }

    /* Extrakce textu z PDF se zachováním řádků tabulek dle souřadnic Y a X + případné vykreslení skenu */
    async function extractTextFromPdfFile(file) {
        const pdfjsLib = await ensurePdfJs();
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pageTexts = [];
        const renderedImages = [];

        for (let pNum = 1; pNum <= pdf.numPages; pNum++) {
            const page = await pdf.getPage(pNum);
            const tc = await page.getTextContent();
            const rowsMap = new Map();

            (tc.items || []).forEach(it => {
                const str = (it.str || '').trim();
                if (!str) return;
                const x = it.transform ? it.transform[4] : 0;
                const y = it.transform ? it.transform[5] : 0;
                /* Seskupíme položky na stejném řádku s tolerancí cca 3.5 pt */
                let matchedY = null;
                for (const ky of rowsMap.keys()) {
                    if (Math.abs(ky - y) <= 3.5) { matchedY = ky; break; }
                }
                if (matchedY === null) {
                    matchedY = y;
                    rowsMap.set(matchedY, []);
                }
                rowsMap.get(matchedY).push({ x, str });
            });

            /* Seřadit řádky shora dolů (v PDF roste Y zdola nahoru) a položky v řádku zleva doprava */
            const sortedY = Array.from(rowsMap.keys()).sort((a, b) => b - a);
            const lines = sortedY.map(yKey => {
                const items = rowsMap.get(yKey).sort((a, b) => a.x - b.x);
                let lineStr = '';
                let prevX = null;
                items.forEach(item => {
                    if (prevX !== null) {
                        const gap = item.x - prevX;
                        lineStr += gap > 28 ? '    ' : ' ';
                    }
                    lineStr += item.str;
                    prevX = item.x + item.str.length * 4;
                });
                return lineStr.trim();
            }).filter(Boolean);

            pageTexts.push(lines.join('\n'));

            /* Pokud má stránka velmi málo textu (naskenovaná smlouva) a jsme v prvních 3 stranách, vykreslíme ji pro OCR / Vision */
            if (lines.join('').length < 40 && renderedImages.length < 3) {
                const viewport = page.getViewport({ scale: 1.8 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');
                await page.render({ canvasContext: ctx, viewport }).promise;
                renderedImages.push(canvas.toDataURL('image/jpeg', 0.85));
            }
        }

        return {
            text: pageTexts.join('\n\n--- STRANA ---\n\n').trim(),
            numPages: pdf.numPages,
            images: renderedImages
        };
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = e => resolve(e.target.result);
            r.onerror = () => reject(new Error('Chyba čtení souboru.'));
            r.readAsDataURL(file);
        });
    }

    async function extractTextFromImageOrScan(dataUrls, statusCb) {
        if (!dataUrls || !dataUrls.length) return '';
        /* 1. Pokud je k dispozici Groq API klíč, využijeme rychlý Vision model pro přepis smlouvy */
        const apiKey = getApiKey();
        if (apiKey) {
            try {
                if (statusCb) statusCb('Čtu naskenovaný dokument pomocí AI Vision (Groq)…');
                const contentArr = [
                    { type: 'text', text: 'Přečti tuto českou pojistnou smlouvu / tabulku pojistky a vypiš kompletní text všech údajů přesně po řádcích: pojišťovna, produkt, číslo smlouvy, počátek a konec, pojištěné osoby, běžné pojistné a všechny řádky tabulky sjednaných pojistných rizik ve formátu: Název druhu pojištění | Tarif | Počátek | Konec | Pojistná částka (Kč) | Pojistné za položku (Kč).' }
                ];
                dataUrls.slice(0, 2).forEach(url => {
                    contentArr.push({ type: 'image_url', image_url: { url } });
                });
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
                    body: JSON.stringify({
                        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                        messages: [{ role: 'user', content: contentArr }],
                        temperature: 0.1,
                        max_tokens: 2500
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    const txt = data.choices?.[0]?.message?.content || '';
                    if (txt.trim().length > 20) return txt;
                }
            } catch (e) {
                console.warn('Groq Vision fallback to Tesseract:', e);
            }
        }

        /* 2. Lokální OCR přes Tesseract.js (čeština) bez nutnosti API klíče */
        if (statusCb) statusCb('Spouštím lokální české OCR rozpoznávání textu (Tesseract.js)…');
        if (!window.Tesseract) {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
                s.onload = resolve;
                s.onerror = () => reject(new Error('Nelze načíst OCR knihovnu Tesseract.js.'));
                document.head.appendChild(s);
            });
        }
        let fullOcrText = '';
        for (let i = 0; i < Math.min(dataUrls.length, 2); i++) {
            if (statusCb) statusCb(`Rozpoznávám text ze skenu (strana ${i + 1})…`);
            const res = await window.Tesseract.recognize(dataUrls[i], 'ces');
            fullOcrText += (res?.data?.text || '') + '\n';
        }
        return fullOcrText.trim();
    }

    /* ─────────────────────────────────────────────────────────────────
       EXPERTNÍ LOKÁLNÍ PARSER ČESKÝCH POJISTNÝCH SMLUV (VŠECH 13 POJIŠŤOVEN)
       Rozpoznává strukturu pojistek, výročních dopisů a nabídek:
       Allianz, ČPP, ČSOB, Generali ČP (vč. Domino Invest / Můj život), KB, Kooperativa,
       Maxima, MetLife, NN, Pillow, Simplea, Uniqa, YOUPLUS.
       ───────────────────────────────────────────────────────────────── */
    function cleanCzechOcrText(rawText) {
        let t = String(rawText || '')
            .replace(/\u00A0/g, ' ')
            .replace(/\r/g, '')
            .replace(/[ \t]+/g, ' ');
        /* Oprava OCR překlepů měny */
        t = t.replace(/\b(\d+)\s*[Kk][eéEÉ]\b/g, '$1 Kč');
        t = t.replace(/\b(\d+)\s*[Kk][cC]\b/g, '$1 Kč');
        t = t.replace(/\b(\d+)\s*,-\s*(?:Kč)?/g, '$1 Kč');
        /* Oprava častých OCR záměn písmen O a číslic 0 v kódech českých tarifů */
        t = t.replace(/\bRPHKO\b/g, 'RPHK0')
             .replace(/\bMZ6ZO\b/g, 'MZ6Z0')
             .replace(/\bNDDBO\b/g, 'NDDB0')
             .replace(/\bCHI2O\b/g, 'CHI20')
             .replace(/\bTN82O\b/g, 'TN820')
             .replace(/\bVZK2O\b/g, 'VZK20')
             .replace(/\bSU2O\b/g, 'SU20')
             .replace(/\bBON2O\b/g, 'BON20')
             .replace(/\bDOZ2O\b/g, 'DOZ20')
             .replace(/\bDO28O\b/g, 'DO280')
             .replace(/\bRZ2OR\b/g, 'RZ20R')
             .replace(/\bRK2OR\b/g, 'RK20R')
             .replace(/\bPR2O1\b/g, 'PR201')
             .replace(/\bRS2O1\b/g, 'RS201')
             .replace(/\bIK32O\b/g, 'IK320')
             .replace(/\bIK22O\b/g, 'IK220')
             .replace(/\bRZP2O\b/g, 'RZP20');
        return t;
    }

    function parseCzechPolicyText(rawText) {
        const text = cleanCzechOcrText(rawText);
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const lower = text.toLowerCase();

        const result = {
            insurer: '',
            productDetected: '',
            contractNo: '',
            clientId: state.clients[0]?.id || '',
            clientName: '',
            birthYear: null,
            start: null,
            end: null,
            premium: 0,
            paymentFrequency: 'monthly',
            contractType: 'risk',
            tnProgression: 800,
            pnFromDay: 29,
            pnRetroactive: false,
            invPsychIncluded: true,
            backPainIncluded: true,
            employerContribution: 0,
            taxDeductibleAnnual: 0,
            items: Object.fromEntries(D.CATEGORIES.map(c => [c.key, 0])),
            itemPremiums: Object.fromEntries(D.CATEGORIES.map(c => [c.key, 0])),
            matchedSummary: [],
            extractedRows: [],
            note: ''
        };

        /* 1. Detekce pojišťovny a produktu (včetně kódů tarifů a historických řad) */
        const insurerPatterns = [
            { name: 'Kooperativa', rx: /kooperativa|pojišťovna\s+české\s+spořitelny|\bflexi\b|napřání|na\s+přání|perspektiva\s*7bn/i, prodRx: /(flexi\s*životní\s*pojištění|flexi\s*junior|flexi|napřání|perspektiva\s*7bn)/i },
            { name: 'ČSOB Pojišťovna', rx: /čsob\s*pojišťovn|csob\s*pojistovn|\bčsob\b|\bnáš\s+život\b|\bforte\b|\bmaxík\b|\bkvarteto\b/i, prodRx: /(náš\s*život|forte|maxík|kvarteto|rytmus)/i },
            { name: 'Generali Česká pojišťovna', rx: /generali\s*česká|česká\s*pojišťovna|generali\s*pojišťovna|domino\s*invest|\bmůj\s+život\b|\bsluníčko\b|\bbel\s+mondo\b|\bdiamant\b|\b(?:RZ20R|RZP20|RS201|RK20R|RK201|PR201|PR02B|VZK20|TN820|RPHK0|DOZ20|DO280|CHI20|RIDI0|MZ6Z0|NDDB0|IK320|IK32B|IK220|BON20)\b/i, prodRx: /(domino\s*invest\s*2020|domino\s*invest|můj\s*život\s*2|můj\s*život|sluníčko|bel\s*mondo|diamant|dynamik)/i },
            { name: 'Allianz', rx: /\ballianz\b/i, prodRx: /(allianz\s*život|allianz\s*plus|rytmus|mercury)/i },
            { name: 'Uniqa', rx: /\buniqa\b|\baxa\s+životní|\baxa\b|život\s*[&a]\s*radost|domino\s*risk|\bržp-d\b|activelife/i, prodRx: /(život\s*[&a]\s*radost|domino\s*risk|ržp-d|activelife)/i },
            { name: 'NN Životní pojišťovna', rx: /\bnn\s+životní|\bnn\s+orange|\borange\s+risk\b|\bing\s+životní|\baegon\b|\bproaktiv\b/i, prodRx: /(nn\s*orange\s*risk|orange\s*risk|nn\s*život|proaktiv|smart)/i },
            { name: 'Česká podnikatelská pojišťovna', rx: /česká\s+podnikatelská|\bčpp\b|\bneon\s+risk|\bneon\s+life|\bneon\b|\bevoluce\b/i, prodRx: /(neon\s*risk|neon\s*life|neon|evoluce)/i },
            { name: 'MetLife', rx: /\bmetlife\b|\bamcico\b|\boneguard\b|\bgarde\b|\bfairlife\b|\bkamarád\b/i, prodRx: /(oneguard|garde\s*6\.0|garde|fairlife|kamarád|onelife)/i },
            { name: 'Komerční pojišťovna', rx: /komerční\s+pojišťovn|\bkb\s+pojišťovn|mojejistota|moje\s+jistota|vital\s+invest|\bmutumutu\b|\belán\b/i, prodRx: /(mojejistota|moje\s*jistota|vital\s*invest|mutumutu|elán)/i },
            { name: 'Simplea', rx: /\bsimplea\b/i, prodRx: /(simplea\s*životní\s*pojištění|simplea)/i },
            { name: 'Pillow pojišťovna', rx: /\bpillow\b/i, prodRx: /(pillow\s*život|pillow\s*úraz\s*a\s*nemoc|pillow)/i },
            { name: 'YOUPLUS', rx: /\byouplus\b|\byou\s+plus\b|\b4u\s+životní/i, prodRx: /(4u\s*životní\s*pojištění|4u)/i },
            { name: 'Maxima / Direct', rx: /\bmaxima\b|\bmaxefekt\b|\bdirect\s+pojišťovn|\bdirect\s+život/i, prodRx: /(maxefekt|direct\s*život)/i }
        ];

        for (const ip of insurerPatterns) {
            if (ip.rx.test(text)) {
                result.insurer = ip.name;
                const pm = text.match(ip.prodRx);
                if (pm) result.productDetected = pm[1];
                else if (ip.name === 'Generali Česká pojišťovna') {
                    if (/domino\s*invest/i.test(text)) result.productDetected = 'Domino Invest 2020';
                    else if (/\b(?:RZ20R|RK20R|PR201|VZK20|TN820|RPHK0|DOZ20|RIDI0)\b/i.test(text)) result.productDetected = 'Můj život 2';
                }
                const insMeta = D.INSURERS.find(i => i.name === ip.name);
                if (insMeta && insMeta.defaultConditions) {
                    result.tnProgression = insMeta.defaultConditions.tnProgression || 800;
                    result.pnRetroactive = !!insMeta.defaultConditions.pnRetroactive;
                    result.invPsychIncluded = insMeta.defaultConditions.invPsychIncluded !== false;
                    result.backPainIncluded = !!insMeta.defaultConditions.backPainIncluded;
                }
                break;
            }
        }

        /* 2. Typ smlouvy (RŽP / IŽP / KŽP / Úrazové) */
        if (/investiční\s+životní|\bižp\b|domino\s*invest|alokace\s+pojistného|podílové\s+jednotky|perspektiva\s*7bn|vital\s*invest|\bforte\b|\brytmus\b/i.test(text)) {
            result.contractType = 'invest';
        } else if (/kapitálové\s+životní|\bkžp\b|pro\s+případ\s+smrti\s+nebo\s+dožití|pojistná\s+částka\s+na\s+dožití/i.test(text)) {
            result.contractType = 'capital';
        } else if (/úrazové\s+pojištění/i.test(text) && !/smrt\s+z\s+jakýchkoliv|invalidit/i.test(text)) {
            result.contractType = 'accident';
        } else {
            result.contractType = 'risk';
        }

        /* 3. Číslo smlouvy */
        const cnoMatch = text.match(/(?:číslo\s*(?:pojistné\s*)?smlouvy|pojistná\s*smlouva\s*č\.?|pojistka\s*k\s*pojistné\s*smlouvě\s*č\.?|pojistka\s*č\.?|smlouva\s*č\.?|č\.\s*smlouvy|č\.\s*ps|návrh\s*(?:pojistné\s*smlouvy\s*)?č\.?|variabilní\s*symbol)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/-]{4,18})/i);
        if (cnoMatch) {
            result.contractNo = cnoMatch[1].trim();
        } else {
            const fallbackNo = text.match(/\b(\d{8,12})\b/);
            if (fallbackNo && !['47116617', '26185610', '45272956', '61859869', '27699781', '49240787'].includes(fallbackNo[1])) {
                result.contractNo = fallbackNo[1];
            }
        }

        /* 4. Počátek a konec pojištění (z hlavičky nebo z dat v tabulce DD.MM.RRRR) */
        const startMatch = text.match(/(?:počátek\s+pojištění|datum\s+počátku|sjednáno\s+(?:od|dne)|platnost\s+od|pojištění\s+od)\s*[:.-]?\s*(?:\d{1,2}\.\s*\d{1,2}\.\s*)?(19\d{2}|20\d{2})/i);
        if (startMatch) result.start = parseInt(startMatch[1], 10);

        const endMatch = text.match(/(?:konec\s+pojištění|datum\s+konce|sjednáno\s+do|platnost\s+do|pojištění\s+do|výroční\s+den\s+konce)\s*[:.-]?\s*(?:\d{1,2}\.\s*\d{1,2}\.\s*)?(20[2-9]\d)/i);
        if (endMatch) result.end = parseInt(endMatch[1], 10);

        if (!result.start || !result.end) {
            const rangeMatch = text.match(/\b(19\d{2}|20[0-2]\d)\s*[–-]\s*(20[2-8]\d)\b/);
            if (rangeMatch) {
                if (!result.start) result.start = parseInt(rangeMatch[1], 10);
                if (!result.end)   result.end   = parseInt(rangeMatch[2], 10);
            }
        }
        if (!result.start || !result.end) {
            const datePairs = [...text.matchAll(/\b\d{1,2}\.\s*\d{1,2}\.\s*(19\d{2}|20[0-3]\d)\b[\s|]+\b\d{1,2}\.\s*\d{1,2}\.\s*(20[2-9]\d)\b/g)];
            if (datePairs.length) {
                const starts = datePairs.map(m => parseInt(m[1], 10)).filter(Boolean);
                const ends   = datePairs.map(m => parseInt(m[2], 10)).filter(Boolean);
                if (!result.start && starts.length) result.start = Math.min(...starts);
                if (!result.end && ends.length)     result.end   = Math.max(...ends);
            }
        }

        /* 5. Pojištěná osoba — spárování s klienty v aplikaci */
        for (const cl of (state.clients || [])) {
            if (!cl.name) continue;
            const parts = cl.name.trim().split(/\s+/).filter(p => p.length >= 3);
            if (parts.length && parts.every(p => lower.includes(p.toLowerCase()))) {
                result.clientId = cl.id;
                result.clientName = cl.name;
                break;
            }
        }
        if (!result.clientName) {
            const nameMatch = text.match(/(?:pojištěn(?:ý|á|á\s+osoba)(?:\s*č\.\s*1)?|1\.\s*pojištěný|hlavní\s+pojištěný|jméno\s+a\s+příjmení)\s*[:.-]?\s*([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+(?:\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+){1,2})/);
            if (nameMatch) {
                result.clientName = nameMatch[1].trim();
                const foundCl = (state.clients || []).find(c =>
                    c.name && (c.name.toLowerCase().includes(result.clientName.toLowerCase()) || result.clientName.toLowerCase().includes(c.name.toLowerCase()))
                );
                if (foundCl) result.clientId = foundCl.id;
            }
        }

        /* 6. Frekvence platby a celkové běžné pojistné */
        if (/frekvence\s+placení\s*[:.-]?\s*roční|roční\s+pojistné|platba\s+ročně/i.test(text) && !/měsíční\s+pojistné/i.test(text)) {
            result.paymentFrequency = 'yearly';
        } else if (/frekvence\s+placení\s*[:.-]?\s*čtvrtletní|čtvrtletní\s+pojistné/i.test(text)) {
            result.paymentFrequency = 'quarterly';
        }

        const premRegexes = [
            /(?:pojistné\s*\([^\)]*\)\s*celkem|celkové\s+(?:běžné\s+)?(?:měsíční\s+)?pojistné|běžné\s+(?:měsíční\s+)?pojistné(?:\s+celkem)?|měsíční\s+pojistné(?:\s+celkem)?|pojistné\s+celkem(?:\s+za\s+smlouvu)?|celkem\s+k\s+úhradě|platba\s+celkem)\s*[:.-]?\s*(\d{1,3}(?:[\s.]\d{3})*(?:[.,]\d{1,2})?)\s*(?:kč|czk|,-)/i,
            /(\d{1,3}(?:[\s.]\d{3})*),-\s*kč\s*(?:[\r\n\s]*způsob\s+placení)/i,
            /(?:pojistné)\s*[:.-]?\s*(\d{1,3}(?:\s?\d{3})?)\s*kč\s*\/\s*měs/i
        ];
        for (const prx of premRegexes) {
            const pm = text.match(prx);
            if (pm) {
                const val = parseFloat(pm[1].replace(/\s|\./g, '').replace(',', '.'));
                if (val >= 50 && val <= 150000) {
                    result.premium = Math.round(val);
                    break;
                }
            }
        }

        /* 7. Specifické podmínky smlouvy */
        if (/\bprog\s*10\b/i.test(text)) {
            result.tnProgression = 1000;
        } else if (/\bprog\s*8\b/i.test(text)) {
            result.tnProgression = 800;
        } else {
            const progMatch = text.match(/progres(?:e|ivní\s+plnění)\s*(?:až\s*)?(\d{3,4})\s*%|(\d{1,2})\s*násobn(?:á|é)\s+progres/i);
            if (progMatch) {
                const pVal = progMatch[1] ? parseInt(progMatch[1], 10) : parseInt(progMatch[2], 10) * 100;
                if ([100, 400, 500, 600, 800, 1000].includes(pVal)) result.tnProgression = pVal;
            }
        }
        if (/zpětně\s+od\s+1\.\s*dne|se\s+zpětným\s+plněním\s+od\s+1\.\s*dne|zpětné\s+plnění|zpětně/i.test(text)) {
            result.pnRetroactive = true;
        }

        /* 8. Pomocná funkce pro vytažení (Pojistná částka, Pojistné za položku) */
        function extractAmountAndPremiumFromRow(rowText, kind) {
            let clean = rowText
                .replace(/\b\d{1,2}\.\s*\d{1,2}\.\s*\d{2,4}\b/g, ' ')
                .replace(/\b(19\d{2}|20[0-8]\d)\s*[–-]\s*(20[0-9]\d)\b/g, ' ')
                .replace(/(?:od|do|rok\w*)\s+(19\d{2}|20[0-9]\d)\b/gi, ' ')
                .replace(/\d+(?:[.,]\d+)?\s*%/g, ' ')
                .replace(/(?:od|po)\s*\d+(?:[.,]\d+)?\s*\.?\s*(?:dne|dnů|dní|dnech|týdne|měsíce)/gi, ' ')
                .replace(/do\s*\d+\s*let/gi, ' ')
                .replace(/\b[1234]\.\s*stup\w*/gi, ' ')
                .replace(/\b\d+\s*x\b/gi, ' ')
                .replace(/\bprog\s*\d+\b/gi, ' ')
                .replace(/\b[A-Z]{2,5}\d{1,3}[A-Z0-9]?\b/g, ' ');

            let amount = 0;
            let itemPrem = 0;

            const kcTokens = [...clean.matchAll(/(\d{1,3}(?:[\s.]\d{3})+|\d{1,7})\s*(?:kč|czk|,-)?(?:\s*\/\s*(?:den|měs\w*))?/gi)];
            if (kcTokens.length >= 2) {
                const kcVals = kcTokens.map(m => parseInt(m[1].replace(/[\s.]/g, ''), 10)).filter(n => !isNaN(n) && n > 0);
                if (kcVals.length >= 2) {
                    const firstVal = kcVals[0];
                    const lastVal  = kcVals[kcVals.length - 1];
                    if (kind === 'sum' && firstVal >= 5000) {
                        amount = firstVal;
                        if (lastVal < firstVal && lastVal <= 25000) itemPrem = lastVal;
                        return { amount, itemPrem };
                    }
                    if ((kind === 'daily' || kind === 'monthly') && firstVal >= 30) {
                        amount = firstVal;
                        if (lastVal <= 15000) itemPrem = lastVal;
                        return { amount, itemPrem };
                    }
                }
            }

            const milMatch = clean.match(/(\d+(?:[.,]\d+)?)\s*mil\.?(?:\s*kč)?/i);
            if (milMatch && kind === 'sum') {
                amount = Math.round(parseFloat(milMatch[1].replace(',', '.')) * 1000000);
            }
            const tisMatch = !amount && clean.match(/(\d+(?:[.,]\d+)?)\s*tis\.?(?:\s*kč)?/i);
            if (tisMatch && kind === 'sum') {
                amount = Math.round(parseFloat(tisMatch[1].replace(',', '.')) * 1000);
            }

            const numMatches = [...clean.matchAll(/\b(\d{1,3}(?:[\s.]\d{3})+|\d{1,7})(?:[.,]\d{1,2})?\b/g)];
            const nums = numMatches.map(m => parseInt(m[1].replace(/[\s.]/g, ''), 10)).filter(n => !isNaN(n) && n > 0);
            const filtered = nums.filter(n => !(n >= 1980 && n <= 2070 && nums.length > 1));

            if (!filtered.length) return { amount, itemPrem };

            if (kind === 'sum') {
                if (!amount) {
                    const big = filtered.filter(n => n >= 5000);
                    amount = big.length ? big[0] : 0;
                }
                const afterAmount = filtered.filter(n => n !== amount && n >= 1 && n <= 15000);
                if (afterAmount.length) itemPrem = afterAmount[afterAmount.length - 1];
                return { amount, itemPrem };
            }
            if (kind === 'daily') {
                const cands = filtered.filter(n => n >= 40 && n <= 15000);
                if (cands.length) {
                    amount = cands[0];
                    if (cands.length >= 2 && cands[cands.length - 1] <= 5000) {
                        itemPrem = cands[cands.length - 1];
                    } else if (filtered.length >= 2 && filtered[filtered.length - 1] < amount) {
                        itemPrem = filtered[filtered.length - 1];
                    }
                }
                return { amount, itemPrem };
            }
            if (kind === 'monthly') {
                const cands = filtered.filter(n => n >= 150 && n <= 150000);
                if (cands.length) {
                    amount = cands[0];
                    const rem = filtered.filter(n => n !== amount && n >= 1 && n <= 10000);
                    if (rem.length) itemPrem = rem[rem.length - 1];
                }
                return { amount, itemPrem };
            }
            return { amount, itemPrem };
        }

        /* 9. Spojení víceřádkových popisů rizik do jednoho logického řádku */
        const hasMoneyOrDate = (s) => /\d{1,3}(?:[\s.]\d{3})+\s*(?:kč|czk|,-)|\b\d+\s*(?:kč|czk|,-)\b|\b\d{1,2}\.\s*\d{1,2}\.\s*\d{4}\b/i.test(s);
        const isContinuationLine = (s) => {
            if (!s || s.length > 95) return false;
            if (hasMoneyOrDate(s)) return false;
            return /^(?:s\s+ročně\s+klesající|s\s+klesající|s\s+konstantní|invalidity\s+třetího|invalidity\s+druhého|stupně\s+s\s+klesající|dopravní\s+nehody|od\s+0[.,]5\s*%|od\s+10\s*%|zpětně|nezpětně|po\s+\d+\s+dnech|fixace\s+\d+\s*%|a\s+výplatou|s\s+navýšením)/i.test(s);
        };

        const logicalLines = [];
        for (let i = 0; i < lines.length; i++) {
            let curr = lines[i];
            while (i + 1 < lines.length && isContinuationLine(lines[i + 1])) {
                curr += ' ' + lines[i + 1];
                i++;
            }
            logicalLines.push(curr);
        }

        /* 10. Pravidla pro rozpoznání všech 34 pojistných kategorií a kódů tarifů */
        const categoryRules = [
            /* Kombinovaný tarif Smrt nebo Invalidita I/II/III s klesající PČ (např. Generali PR201 / PR02B) */
            { key: '__COMBO_SMRT_INV_KLES__', tariff: 'PR201 / PR02B', rx: /\b(?:PR201|PR02B)\b|prvního\s+z\s+rizik\s+smrti\s+nebo\s+invalidity/i },

            /* SMRT A DOŽITÍ */
            { key: 'dozitiInvestice', tariff: 'RZP20 / BON20', rx: /\b(?:RZP20|BON20)\b|smrt\s+nebo\s+dožití|věrnostní\s+bonus|podílov\w*\s+jednotk\w*|dožití/i },
            { key: 'smrtAutonehoda', tariff: 'SA', rx: /smrt.*(?:dopravní\s+nehod|autonehod)(?!.*2x\s+pojistné\s+plnění)|úrazová\s+smrt\s+při\s+dopravní/i },
            { key: 'smrtUraz', tariff: 'SU20', rx: /\bSU20\b|smrt\s+(?:následkem\s+úrazu|úrazem|způsobená\s+úrazem)|úrazové\s+úmrtí|\bsmú\b|\bsmu\b|\bsmur\b/i },
            { key: 'smrtKles', tariff: 'RK20R / RK201', rx: /\b(?:RK20R|RK201)\b|(?:smrt|úmrtí).*(?:ročně\s+klesající|klesající|lineárně|anuitně|k\s+úvěru|hypoték)|\bsmk\b|\bsmtk\b/i },
            { key: 'rentaPozustali', tariff: 'RP', rx: /pozůstalostní\s+(?:renta|důchod)|renta\s+pro\s+pozůstalé|důchod\s+pro\s+pozůstalé/i },
            { key: 'smrt', tariff: 'RZ20R / RS201', rx: /\b(?:RZ20R|RS201)\b|(?:základní\s+|hlavní\s+|doplňkové\s+)?(?:pojištění\s+(?:pro\s+případ\s+)?)?(?:smrt(?:i)?|úmrtí)(?!\s*(?:úrazem|následkem\s+úrazu|při\s+dopravní|s?\s*ročně\s*klesající|s?\s*klesající|nebo\s+dožití))/i },

            /* INVALIDITA A LTC */
            { key: 'dlouhodobaPece', tariff: 'LTC', rx: /dlouhodobá\s+péče|nesoběstačnost|ztráta\s+soběstačnosti|závislost\s+na\s+péči|\bltc\b|bezmocnost/i },
            { key: 'zprosteni', tariff: 'ZPR', rx: /zproštění\s+od\s+placení/i },
            { key: 'invRenta', tariff: 'INVR', rx: /invalidní\s+(?:renta|důchod)|renta\s+při\s+invaliditě|důchod\s+při\s+invaliditě/i },
            { key: 'inv2Kles', tariff: 'IK220', rx: /\bIK220\b|invalidit\w*\s*(?:2\.|ii\.|druhého).*(?:klesající|fixace)/i },
            { key: 'invKles', tariff: 'IK320 / IK32B', rx: /\b(?:IK320|IK32B)\b|invalidit\w*\s*(?:3\.|iii\.|třetího).*(?:klesající|fixace)|invalidit\w*.*(?:ročně\s+klesající|klesající|k\s+úvěru)|\bidk\b|\binvk\b/i },
            { key: 'invalidita', tariff: 'INV3', rx: /invalidit\w*\s*(?:3\.|iii\.|třetího|i\.\s*[–+-]\s*iii\.|1\.\s*[–+-]\s*3\.|1\.,\s*2\.\s*a\s*3\.)(?!.*klesající)|\binv\s*3\b|\bid\s*3\b/i },
            { key: 'inv2', tariff: 'INV2', rx: /invalidit\w*\s*(?:2\.|ii\.|druhého|ii\.\s*a\s*iii\.|2\.\s*a\s*3\.)(?!.*klesající)|\binv\s*2\b|\bid\s*2\b/i },
            { key: 'inv1', tariff: 'INV1', rx: /invalidit\w*\s*(?:1\.|i\.(?!\s*i)|prvního)(?!.*klesající)|\binv\s*1\b|\bid\s*1\b/i },

            /* ZÁVAŽNÁ ONEMOCNĚNÍ */
            { key: 'zavOnKles', tariff: 'VZK20', rx: /\bVZK20\b|(?:závažn\w+|vážn\w+)\s+(?:onemocnění|nemoc\w*).*(?:klesající|lineárně|anuitně)|\bzok\b|\bznk\b/i },
            { key: 'zavOnMuzZena', tariff: 'ZO Onko+', rx: /(?:rakovin\w+|onkolog\w+|karcinom|závažn\w+\s+onemocnění\s+pro\s+(?:ženy|muže)|pro\s+něj|pro\s+ni|in\s*situ)/i },
            { key: 'cukrovkaKompl', tariff: 'Dia', rx: /cukrovk\w+|diabetes/i },
            { key: 'trvaleNasledkyNemoc', tariff: 'TNN', rx: /trvalé\s+následky\s+nemoci|snížená\s+soběstačnost\s+dítěte|dětská\s+invalidita/i },
            { key: 'zavOn', tariff: 'ZO', rx: /(?:závažn\w+|vážn\w+)\s+(?:onemocnění|nemoc\w+|chorob\w+)(?!.*klesající)|\bddz?\b|\bzavo\b/i },

            /* ÚRAZ A TRVALÉ NÁSLEDKY */
            { key: 'tnUraz10', tariff: 'TN100', rx: /\bTN100\b|trvalé\s+následky\s+úrazu.*od\s*10\s*%|\btnu?\s*10\b|\btn\s*od\s*10\b/i },
            { key: 'tnUraz', tariff: 'TN820', rx: /\bTN820\b|trvalé\s+následky\s+úrazu(?!.*od\s*10\s*%)|\btnu\b|\btn01\b/i },
            { key: 'urazVelky', tariff: 'DO280', rx: /\bDO280\b|(?:vážný\s+úraz|denní\s+odškodné.*(?:od\s*2[89]\.\s*dne|nad\s*2[89]\s*dn))/i },
            { key: 'uraz', tariff: 'DOZ20', rx: /\bDOZ20\b|denní\s+odškodné(?:\s+za\s+(?:úraz|dobu\s+(?:nezbytného\s+)?léčení))?(?:\s+úrazu)?(?!.*od\s*2[89]\.\s*dne)|tělesné\s+poškození\s+(?:způsobené\s+)?úrazem|\bdoú\b|\bdou\d?\b/i },
            { key: 'zlomeninyPopaleniny', tariff: 'Zlom', rx: /zlomenin\w*|popálenin\w*/i },
            { key: 'horniKoncetiny', tariff: 'RPHK0', rx: /\bRPHK0\b|horní\w*\s+končetin\w*|poškození\s+rukou/i },

            /* PRACOVNÍ NESCHOPNOST, OČR A HOSPITALIZACE */
            { key: 'pn15', tariff: 'PN15', rx: /prac\w*\s+neschopnost.*(?:od|po)\s*1[45]\.?\s*dn|\bpn\s*15\b/i },
            { key: 'pn61', tariff: 'MZ6Z0', rx: /\bMZ6Z0\b|prac\w*\s+neschopnost.*(?:od|po)\s*6[01]\.?\s*dn|měsíční\s+dávka.*prac\w*\s+neschopnost|\bpn\s*6[01]\b/i },
            { key: 'pn28', tariff: 'Z29Z0', rx: /\bZ29Z0\b|prac\w*\s+neschopnost|denní\s+dávka\s+při\s+prac\w*\s+neschopnosti|\bpn\s*2[89]\b|\bpuv\b/i },
            { key: 'osetrovani', tariff: 'OČR', rx: /ošetřování\s+(?:člena\s+rodiny|dítěte)|\bočr\b|\boset\b/i },
            { key: 'hospUraz', tariff: 'HÚ', rx: /(?:hospitalizace|pobyt\s+v\s+nemocnici).*(?:pouze\s+úraz|následkem\s+úrazu|úrazem)/i },
            { key: 'hosp', tariff: 'NDDB0', rx: /\bNDDB0\b|hospitalizac\w*|pobyt\s+v\s+nemocnici|nemocniční\s+denní\s+dávk\w*/i },

            /* DOPLŇKY A CHIRURGIE */
            { key: 'ztrataRidicskeho', tariff: 'RIDI0', rx: /\bRIDI0\b|ztráta\s+řidičského\s+oprávnění/i },
            { key: 'chir', tariff: 'CHI20', rx: /\bCHI20\b|chirurgick\w+\s+zákrok\w*|operac\w*/i },
            { key: 'rekonvalescence', tariff: 'Reh', rx: /rekonvalescenc\w*|poúrazová\s+péče|rehabilitac\w*|cesta\s+ke\s+zdraví/i },
            { key: 'odpovednostObc', tariff: 'Odp', rx: /občanská\s+odpovědnost|odpovědnost\s+v\s+běžném\s+občanském\s+životě|odpovědnost\s+za\s+škodu/i }
        ];

        for (let i = 0; i < logicalLines.length; i++) {
            const line = logicalLines[i];
            if (line.length > 270) continue;

            for (const rule of categoryRules) {
                if (rule.rx.test(line)) {
                    /* Detekce explicitního tarifního kódu na řádku */
                    const tCodeMatch = line.match(/\b(RZ20R|RZP20|RS201|RK20R|RK201|PR201|PR02B|VZK20|TN820|RPHK0|DOZ20|DO280|CHI20|RIDI0|MZ6Z0|NDDB0|IK320|IK32B|IK220|BON20|Z29Z0)\b/i);
                    const detectedTariff = tCodeMatch ? tCodeMatch[1].toUpperCase() : (rule.tariff || '');

                    /* Speciální hypoteční tarif PR201 / PR02B */
                    if (rule.key === '__COMBO_SMRT_INV_KLES__') {
                        const { amount, itemPrem } = extractAmountAndPremiumFromRow(line, 'sum');
                        if (amount > 0) {
                            result.items.smrtKles = Math.max(result.items.smrtKles || 0, amount);
                            result.items.invKles  = Math.max(result.items.invKles || 0, amount);
                            if (itemPrem > 0) result.itemPremiums.invKles = (result.itemPremiums.invKles || 0) + itemPrem;
                            result.extractedRows.push({
                                id: 'er_' + Math.random().toString(36).substr(2, 7),
                                tariff: detectedTariff,
                                rawTitle: 'První z rizik smrti nebo invalidity klesající',
                                categoryKey: '__COMBO_SMRT_INV_KLES__',
                                amount: amount,
                                itemPrem: itemPrem,
                                unit: 'Kč'
                            });
                        }
                        break;
                    }

                    const cat = D.CATEGORY_BY_KEY[rule.key];
                    if (!cat) continue;
                    let { amount, itemPrem } = extractAmountAndPremiumFromRow(line, cat.kind);

                    /* Pokud je částka na bezprostředně následujícím řádku */
                    if (!amount && i + 1 < logicalLines.length && logicalLines[i + 1].length < 70 && !/[a-záčďéěíňóřšťúůýž]{6,}/i.test(logicalLines[i + 1].replace(/kč|czk|den|měs/gi, ''))) {
                        const nextExtracted = extractAmountAndPremiumFromRow(logicalLines[i + 1], cat.kind);
                        amount = nextExtracted.amount;
                        if (!itemPrem) itemPrem = nextExtracted.itemPrem;
                    }

                    if (amount > 0) {
                        let displayUnit = cat.kind === 'daily' ? 'Kč/den' : cat.kind === 'monthly' ? 'Kč/měs' : 'Kč';
                        let displayAmount = amount;

                        /* Pokud jde o "Měsíční dávku při prac. neschopnosti" (MZ6Z0 = např. 10 000 Kč/měs), převedeme na denní dávku pro aplikaci */
                        if ((rule.key === 'pn61' || rule.key === 'pn28') && (/měsíční\s+dávka|\bMZ6Z0\b/i.test(line) || amount >= 2500)) {
                            displayUnit = 'Kč/měs';
                            amount = Math.round(amount / 30);
                        }

                        if (rule.key === 'smrtUraz' && /2\s*x.*dopravní\s+nehod/i.test(line)) {
                            result.items.smrtAutonehoda = Math.max(result.items.smrtAutonehoda || 0, amount);
                        }

                        if (rule.key === 'invalidita' && /(?:i\.\s*[–+-]\s*iii\.|1\.\s*[–+-]\s*3\.|1\.,\s*2\.\s*a\s*3\.|i\.,\s*ii\.\s*a\s*iii\.)/i.test(line)) {
                            result.items.invalidita = Math.max(result.items.invalidita, amount);
                            result.items.inv2 = Math.max(result.items.inv2, amount);
                            result.items.inv1 = Math.max(result.items.inv1, amount);
                            if (itemPrem > 0) result.itemPremiums.invalidita = (result.itemPremiums.invalidita || 0) + itemPrem;
                        } else {
                            result.items[rule.key] = (result.items[rule.key] || 0) + amount;
                            if (itemPrem > 0) {
                                result.itemPremiums[rule.key] = (result.itemPremiums[rule.key] || 0) + itemPrem;
                            }
                        }

                        /* Záznam do interaktivního kontrolního seznamu pro uživatele */
                        const shortTitle = line.length > 70 ? line.slice(0, 68) + '…' : line;
                        result.extractedRows.push({
                            id: 'er_' + Math.random().toString(36).substr(2, 7),
                            tariff: detectedTariff,
                            rawTitle: shortTitle,
                            categoryKey: rule.key,
                            amount: displayAmount,
                            itemPrem: itemPrem,
                            unit: displayUnit
                        });
                        break;
                    }
                }
            }
        }

        if (result.items.pn15 > 0) result.pnFromDay = 15;
        else if (result.items.pn28 > 0) result.pnFromDay = 29;
        else if (result.items.pn61 > 0) result.pnFromDay = 61;

        /* Součet vytěženého pojistného položek */
        const sumExtractedItemPrems = Object.values(result.itemPremiums).reduce((s, v) => s + num(v), 0);
        if (result.premium === 0 && sumExtractedItemPrems > 0) {
            result.premium = sumExtractedItemPrems;
        } else if (sumExtractedItemPrems === 0 && result.premium > 0 && D.estimateItemPremiums) {
            result.itemPremiums = D.estimateItemPremiums(result.items, result.premium);
        }

        /* Souhrn nalezených rizik */
        D.CATEGORIES.forEach(cat => {
            const v = num(result.items[cat.key]);
            const pv = num(result.itemPremiums[cat.key]);
            if (v > 0 || pv > 0) {
                result.matchedSummary.push({
                    key: cat.key,
                    label: cat.label,
                    val: v,
                    prem: pv,
                    formatted: fmtCatValue(v, cat),
                    formattedPrem: pv > 0 ? `${fmt(pv)} Kč/měs` : '—'
                });
            }
        });

        const noteParts = [];
        if (result.productDetected) noteParts.push(`Produkt: ${result.productDetected}`);
        if (result.clientName) noteParts.push(`Pojištěný: ${result.clientName}`);
        noteParts.push('Vytěženo lokálním parserem');
        result.note = noteParts.join(' · ');

        return result;
    }

    /* Pomocný generátor options pro dropdown výběr kategorie v kontrolní tabulce OCR */
    function buildCategorySelectOptions(selectedKey) {
        let html = `<option value="IGNORE" ${selectedKey === 'IGNORE' ? 'selected' : ''}>-- Ignorovat položku (nezařazovat) --</option>`;
        html += `<option value="__COMBO_SMRT_INV_KLES__" ${selectedKey === '__COMBO_SMRT_INV_KLES__' ? 'selected' : ''}>⚡ Hypoteční balíček: Smrt i Invalidita klesající (PR201 / PR02B)</option>`;

        D.CATEGORY_GROUPS.forEach(grp => {
            const cats = D.CATEGORIES.filter(c => c.group === grp.key);
            html += `<optgroup label="${escapeHtml(grp.label)}">`;
            cats.forEach(c => {
                const u = c.kind === 'daily' ? 'Kč/den' : c.kind === 'monthly' ? 'Kč/měs' : 'Kč';
                html += `<option value="${c.key}" ${c.key === selectedKey ? 'selected' : ''}>${escapeHtml(c.label)} (${u})</option>`;
            });
            html += `</optgroup>`;
        });
        return html;
    }

    /* Vykreslení řádků interaktivní kontrolní tabulky OCR */
    function renderExtractedRowsHtml(parsed) {
        if (!parsed.extractedRows || !parsed.extractedRows.length) {
            return `<tr><td colspan="5" class="p-3 text-center text-xs text-amber-300">V dokumentu nebyly automaticky detekovány konkrétní řádky tabulky krytí. Můžete kliknout na „+ Přidat položku ze smlouvy“ a zadat krytí ručně.</td></tr>`;
        }
        return parsed.extractedRows.map(r => `
            <tr class="hover:bg-slate-900/60 transition" id="row_tr_${r.id}">
                <td class="p-2">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        ${r.tariff ? `<span class="tariff-tag">${escapeHtml(r.tariff)}</span>` : ''}
                        <span class="text-slate-200 text-xs truncate max-w-xs" title="${escapeHtml(r.rawTitle)}">${escapeHtml(r.rawTitle)}</span>
                    </div>
                </td>
                <td class="p-2">
                    <div class="flex items-center gap-1">
                        <input type="number" class="pro-input num-input text-xs w-32" value="${r.amount || 0}" step="1000"
                            oninput="app.updateExtractedRowVal('${r.id}', 'amount', this.value)">
                        <span class="text-[10px] font-mono text-slate-400 shrink-0">${r.unit || 'Kč'}</span>
                    </div>
                </td>
                <td class="p-2">
                    <div class="flex items-center gap-1">
                        <input type="number" class="pro-input prem-input text-xs w-24" value="${r.itemPrem || 0}" step="1"
                            oninput="app.updateExtractedRowVal('${r.id}', 'itemPrem', this.value)">
                        <span class="text-[10px] font-mono text-slate-400 shrink-0">Kč/m</span>
                    </div>
                </td>
                <td class="p-2">
                    <select class="pro-input text-xs w-full" onchange="app.updateExtractedRowCategory('${r.id}', this.value)">
                        ${buildCategorySelectOptions(r.categoryKey)}
                    </select>
                </td>
                <td class="p-2 text-center">
                    <button type="button" onclick="app.removeExtractedRow('${r.id}')" class="text-slate-400 hover:text-red-400 p-1 font-bold" title="Odstranit řádek">✕</button>
                </td>
            </tr>
        `).join('');
    }

    /* Vykreslení přehledné karty vytěžené smlouvy s interaktivní kontrolní tabulkou v modalu */
    function renderExtractedContractPreview(parsed, sourceFileName) {
        const prev = document.getElementById('docExtractedPreview');
        const btnForm = document.getElementById('docOpenInFormBtn');
        const btnSave = document.getElementById('docSaveDirectBtn');
        const aiBtn = document.getElementById('docAiRefineBtn');
        if (!prev) return;

        const clientOptions = (state.clients || []).map(cl =>
            `<option value="${cl.id}" ${parsed.clientId === cl.id ? 'selected' : ''}>${escapeHtml(cl.name)}</option>`
        ).join('');

        const totalItemPrem = Object.values(parsed.itemPremiums || {}).reduce((s, v) => s + num(v), 0);

        prev.innerHTML = `
            <div class="p-4 rounded-lg border border-emerald-500/40 bg-emerald-950/15 space-y-3">
                <div class="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2.5">
                    <div class="flex items-center gap-2">
                        <span class="badge badge-emerald">✓ Vytěženo z dokumentu</span>
                        <span class="text-xs font-semibold text-slate-100">${escapeHtml(sourceFileName || 'Dokument smlouvy')}</span>
                    </div>
                    <span class="text-[11px] font-mono text-sky-300">
                        Nalezeno ${parsed.extractedRows ? parsed.extractedRows.length : parsed.matchedSummary.length} položek · Součet pojistného položek: <strong class="text-amber-300" id="docHeaderSumIP">${fmt(totalItemPrem)} Kč/měs</strong>
                    </span>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
                    <div class="p-2 rounded bg-slate-900/80 border border-slate-800">
                        <div class="text-[10px] uppercase text-slate-400 font-bold">Přiřadit osobě</div>
                        <select id="docPreviewClientSelect" class="pro-input text-xs mt-1" onchange="app.updateExtractedClient(this.value)">
                            ${clientOptions}
                        </select>
                    </div>
                    <div class="p-2 rounded bg-slate-900/80 border border-slate-800">
                        <div class="text-[10px] uppercase text-slate-400 font-bold">Pojišťovna</div>
                        <div class="font-semibold text-slate-100 mt-1">${escapeHtml(parsed.insurer || 'Nerozpoznáno (vyberete ve formuláři)')}</div>
                        ${parsed.productDetected ? `<div class="text-[10px] text-sky-400">${escapeHtml(parsed.productDetected)}</div>` : ''}
                    </div>
                    <div class="p-2 rounded bg-slate-900/80 border border-slate-800">
                        <div class="text-[10px] uppercase text-slate-400 font-bold">Číslo smlouvy</div>
                        <div class="font-mono font-bold text-amber-300 mt-1">${escapeHtml(parsed.contractNo || '—')}</div>
                    </div>
                    <div class="p-2 rounded bg-slate-900/80 border border-slate-800">
                        <div class="text-[10px] uppercase text-slate-400 font-bold">Trvání (Od–Do)</div>
                        <div class="font-mono text-slate-200 mt-1">${parsed.start || '?'} – ${parsed.end || '?'}</div>
                    </div>
                    <div class="p-2 rounded bg-slate-900/80 border border-slate-800">
                        <div class="text-[10px] uppercase text-slate-400 font-bold">Běžné pojistné</div>
                        <div class="font-mono font-bold text-emerald-300 mt-1" id="docBadgePrem">${parsed.premium ? fmtCZK(parsed.premium) : '—'}</div>
                    </div>
                    <div class="p-2 rounded bg-slate-900/80 border border-slate-800">
                        <div class="text-[10px] uppercase text-slate-400 font-bold">Podmínky</div>
                        <div class="text-[11px] text-slate-300 mt-1">TN ${parsed.tnProgression}% · PN ${parsed.pnFromDay}.d${parsed.pnRetroactive ? ' zp.' : ''}</div>
                    </div>
                </div>

                <!-- INTERAKTIVNÍ KONTROLNÍ TABULKA OCR -->
                <div class="p-3 rounded-lg border border-slate-700 bg-slate-900/90 space-y-2 mt-2">
                    <div class="flex items-center justify-between flex-wrap gap-2">
                        <div>
                            <div class="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                                <i data-lucide="list-checks" class="w-4 h-4 text-emerald-400"></i>
                                Položky vytěžené ze smlouvy — kontrola a možnost okamžité úpravy před vložením
                            </div>
                            <div class="text-[11px] text-slate-400">
                                Libovolnou chybně rozpoznanou částku, pojistné či kategorii můžete přímo v tabulce přepsat nebo položku přeřadit.
                            </div>
                        </div>
                        <button type="button" onclick="app.addExtractedRowManual()" class="btn-secondary text-[11px] py-1 px-2.5 flex items-center gap-1">
                            <i data-lucide="plus" class="w-3 h-3 text-sky-400"></i>+ Přidat položku ze smlouvy
                        </button>
                    </div>

                    <div class="overflow-x-auto max-h-[340px] overflow-y-auto border border-slate-800 rounded">
                        <table class="w-full text-xs text-left">
                            <thead class="bg-slate-950 text-slate-400 font-mono text-[10px] uppercase sticky top-0 border-b border-slate-800">
                                <tr>
                                    <th class="p-2">Druh pojištění / Kód tarifu ze smlouvy</th>
                                    <th class="p-2 w-44">Pojistná částka / dávka</th>
                                    <th class="p-2 w-32">Pojistné (Kč/měs)</th>
                                    <th class="p-2 w-64">Zařadit do kategorie v aplikaci</th>
                                    <th class="p-2 w-10 text-center">Akce</th>
                                </tr>
                            </thead>
                            <tbody id="extractedRowsTbody" class="divide-y divide-slate-800/60 bg-slate-950/40 font-sans">
                                ${renderExtractedRowsHtml(parsed)}
                            </tbody>
                        </table>
                    </div>

                    <div class="flex items-center justify-between text-xs text-slate-400 pt-1.5 flex-wrap gap-2 border-t border-slate-800/80">
                        <div>
                            Součet položek: <strong class="text-amber-300 font-mono" id="docExtractedSumIP">${fmt(totalItemPrem)} Kč/měs</strong>
                            · Celkové pojistné smlouvy: <strong class="text-sky-300 font-mono" id="docExtractedPrem">${parsed.premium ? fmt(parsed.premium) + ' Kč' : '0 Kč'}</strong>
                        </div>
                        <button type="button" onclick="app.syncExtractedTotalFromItems()" class="text-[11px] text-sky-400 hover:underline font-mono">
                            ↳ Převzít součet položek (${fmt(totalItemPrem)} Kč) jako celkové pojistné smlouvy
                        </button>
                    </div>
                </div>
            </div>
        `;

        prev.classList.remove('hidden');
        if (btnForm) btnForm.classList.remove('hidden');
        if (btnSave) btnSave.classList.remove('hidden');
        if (aiBtn)   aiBtn.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    }

    /* Funkce pro interaktivní úpravy řádků v OCR kontrolní tabulce */
    function updateExtractedRowVal(id, field, val) {
        if (!lastExtractedContract || !lastExtractedContract.extractedRows) return;
        const row = lastExtractedContract.extractedRows.find(r => r.id === id);
        if (!row) return;
        row[field] = num(val);
        syncExtractedRowsToParsed();
    }

    function updateExtractedRowCategory(id, catKey) {
        if (!lastExtractedContract || !lastExtractedContract.extractedRows) return;
        const row = lastExtractedContract.extractedRows.find(r => r.id === id);
        if (!row) return;
        row.categoryKey = catKey;
        const cat = D.CATEGORY_BY_KEY[catKey];
        if (cat) row.unit = cat.kind === 'daily' ? 'Kč/den' : cat.kind === 'monthly' ? 'Kč/měs' : 'Kč';
        syncExtractedRowsToParsed();
    }

    function removeExtractedRow(id) {
        if (!lastExtractedContract || !lastExtractedContract.extractedRows) return;
        lastExtractedContract.extractedRows = lastExtractedContract.extractedRows.filter(r => r.id !== id);
        syncExtractedRowsToParsed();
        const tr = document.getElementById('row_tr_' + id);
        if (tr) tr.remove();
    }

    function addExtractedRowManual() {
        if (!lastExtractedContract) return;
        lastExtractedContract.extractedRows = lastExtractedContract.extractedRows || [];
        const newId = 'er_' + Math.random().toString(36).substr(2, 7);
        lastExtractedContract.extractedRows.push({
            id: newId,
            tariff: 'RUČNÍ',
            rawTitle: 'Nové připojištění',
            categoryKey: 'smrt',
            amount: 500000,
            itemPrem: 50,
            unit: 'Kč'
        });
        syncExtractedRowsToParsed();
        renderExtractedContractPreview(lastExtractedContract, 'Ručně přidaná položka');
    }

    function syncExtractedTotalFromItems() {
        if (!lastExtractedContract) return;
        const totalIP = Object.values(lastExtractedContract.itemPremiums || {}).reduce((s, v) => s + num(v), 0);
        lastExtractedContract.premium = totalIP;
        const premEl = document.getElementById('docExtractedPrem');
        const badgeEl = document.getElementById('docBadgePrem');
        if (premEl) premEl.textContent = `${fmt(totalIP)} Kč`;
        if (badgeEl) badgeEl.textContent = fmtCZK(totalIP);
        toast(`Celkové pojistné nastaveno na ${fmt(totalIP)} Kč`, 'success');
    }

    function syncExtractedRowsToParsed() {
        if (!lastExtractedContract) return;
        const p = lastExtractedContract;
        p.items = Object.fromEntries(D.CATEGORIES.map(c => [c.key, 0]));
        p.itemPremiums = Object.fromEntries(D.CATEGORIES.map(c => [c.key, 0]));

        (p.extractedRows || []).forEach(r => {
            if (!r.categoryKey || r.categoryKey === 'IGNORE') return;
            const amt = num(r.amount);
            const prem = num(r.itemPrem);
            if (r.categoryKey === '__COMBO_SMRT_INV_KLES__') {
                p.items.smrtKles = Math.max(p.items.smrtKles || 0, amt);
                p.items.invKles  = Math.max(p.items.invKles || 0, amt);
                if (prem > 0) p.itemPremiums.invKles = (p.itemPremiums.invKles || 0) + prem;
            } else {
                let finalAmt = amt;
                if (r.unit === 'Kč/měs' && ['pn15', 'pn28', 'pn61'].includes(r.categoryKey) && amt >= 2000) {
                    finalAmt = Math.round(amt / 30);
                }
                p.items[r.categoryKey] = (p.items[r.categoryKey] || 0) + finalAmt;
                if (prem > 0) p.itemPremiums[r.categoryKey] = (p.itemPremiums[r.categoryKey] || 0) + prem;
            }
        });

        p.matchedSummary = [];
        D.CATEGORIES.forEach(cat => {
            const v = num(p.items[cat.key]);
            const pv = num(p.itemPremiums[cat.key]);
            if (v > 0 || pv > 0) {
                p.matchedSummary.push({
                    key: cat.key,
                    label: cat.label,
                    val: v,
                    prem: pv,
                    formatted: fmtCatValue(v, cat),
                    formattedPrem: pv > 0 ? `${fmt(pv)} Kč/měs` : '—'
                });
            }
        });

        const sumIP = Object.values(p.itemPremiums).reduce((s, v) => s + num(v), 0);
        const sumEl = document.getElementById('docExtractedSumIP');
        const headerSumEl = document.getElementById('docHeaderSumIP');
        if (sumEl) sumEl.textContent = `${fmt(sumIP)} Kč/měs`;
        if (headerSumEl) headerSumEl.textContent = `${fmt(sumIP)} Kč/měs`;
    }

    function updateExtractedClient(clientId) {
        if (lastExtractedContract) lastExtractedContract.clientId = clientId;
    }

    async function processUploadedContractFile(file, statusCb) {
        const name = (file.name || '').toLowerCase();
        let extractedText = '';
        lastUploadedImages = [];

        if (name.endsWith('.pdf') || file.type === 'application/pdf') {
            if (statusCb) statusCb(`Načítám PDF smlouvu „${file.name}"…`);
            const pdfRes = await extractTextFromPdfFile(file);
            extractedText = pdfRes.text;
            lastUploadedImages = pdfRes.images || [];
            if (extractedText.replace(/---\s*STRANA\s*---/g, '').trim().length < 40 && lastUploadedImages.length > 0) {
                extractedText = await extractTextFromImageOrScan(lastUploadedImages, statusCb);
            }
        } else if (/\.(jpg|jpeg|png|webp)$/i.test(name) || file.type.startsWith('image/')) {
            if (statusCb) statusCb(`Zpracovávám snímek smlouvy „${file.name}"…`);
            const dataUrl = await readFileAsDataUrl(file);
            lastUploadedImages = [dataUrl];
            extractedText = await extractTextFromImageOrScan(lastUploadedImages, statusCb);
        } else {
            if (statusCb) statusCb(`Čtu textový soubor „${file.name}"…`);
            extractedText = await file.text();
        }

        const parsed = parseCzechPolicyText(extractedText);
        return { extractedText, parsed };
    }

    async function handleContractFileSelect(ev) {
        const file = ev.target?.files?.[0] || ev.dataTransfer?.files?.[0];
        if (!file) return;
        const stBox = document.getElementById('docUploadStatus');
        const stTxt = document.getElementById('docUploadStatusText');
        const rawEl = document.getElementById('docRawTextInput');
        if (stBox) stBox.classList.remove('hidden');
        const setStatus = msg => { if (stTxt) stTxt.textContent = msg; };

        try {
            const { extractedText, parsed } = await processUploadedContractFile(file, setStatus);
            lastExtractedContract = parsed;
            if (rawEl) rawEl.value = extractedText;
            setStatus(`Hotovo: dokument „${file.name}" byl analyzován (${parsed.insurer || 'pojišťovna neurčena'}, nalezeno ${parsed.matchedSummary.length} rizik).`);
            renderExtractedContractPreview(parsed, file.name);
            toast(`Smlouva vytěžena (${parsed.matchedSummary.length} rizik)`, 'success');
        } catch (err) {
            console.error('Contract file parse error:', err);
            setStatus('Chyba při zpracování dokumentu: ' + err.message);
            toast('Chyba čtení dokumentu: ' + err.message, 'error');
        }
    }

    function reparseDocRawText() {
        const rawEl = document.getElementById('docRawTextInput');
        if (!rawEl || !rawEl.value.trim()) {
            toast('Nejprve nahrajte dokument nebo vložte text smlouvy.', 'info');
            return;
        }
        const parsed = parseCzechPolicyText(rawEl.value);
        lastExtractedContract = parsed;
        renderExtractedContractPreview(parsed, 'Upravený text smlouvy');
        toast(`Text znovu analyzován (${parsed.matchedSummary.length} rizik)`, 'success');
    }

    async function refineDocWithAi() {
        const rawEl = document.getElementById('docRawTextInput');
        const text = rawEl ? rawEl.value.trim() : '';
        if (!text) { toast('Žádný text k AI analýze.', 'info'); return; }
        const btn = document.getElementById('docAiRefineBtn');
        const stTxt = document.getElementById('docUploadStatusText');
        if (btn) btn.disabled = true;
        if (stTxt) stTxt.textContent = 'AI (Groq) analyzuje detaily pojistné smlouvy…';

        try {
            const insurerList = D.INSURER_NAMES.join(', ');
            const catList = D.CATEGORIES.map(c => `${c.key}: ${c.label} (${c.kind === 'daily' ? 'Kč/den' : c.kind === 'monthly' ? 'Kč/měs' : 'Kč'})`).join('\n');
            const messages = [
                {
                    role: 'system',
                    content: 'Jsi expertní analytik českých životních pojistných smluv. Z textu pojistné smlouvy vytěžíš strukturovaný JSON objekt včetně pojistné částky (items) i měsíčního pojistného za každou položku (itemPremiums). Vrať POUZE platný JSON objekt.'
                },
                {
                    role: 'user',
                    content: `Povolené názvy pojišťoven: ${insurerList}.\nKategorie pojištění (klíče):\n${catList}\n\nVrať JSON objekt ve tvaru:\n{\n  "insurer": "přesný název pojišťovny ze seznamu",\n  "productDetected": "název produktu",\n  "contractNo": "číslo smlouvy",\n  "clientName": "jméno pojištěného",\n  "start": rok_pocatku_cislo,\n  "end": rok_konce_cislo,\n  "premium": mesicni_pojistne_celkem_cislo,\n  "tnProgression": 800,\n  "pnFromDay": 29,\n  "pnRetroactive": true/false,\n  "items": { "smrt": 0, "invalidita": 0, ... },\n  "itemPremiums": { "smrt": 0, "invalidita": 0, ... },\n  "note": "stručná poznámka"\n}\n\nTEXT SMLOUVY:\n${text.slice(0, 12000)}`
                }
            ];
            const aiResp = await callGroq(messages);
            const m = aiResp.match(/\{[\s\S]*\}/);
            if (!m) throw new Error('AI nevrátila platný JSON objekt.');
            const aiObj = JSON.parse(m[0]);
            const base = lastExtractedContract || parseCzechPolicyText(text);
            if (aiObj.insurer) base.insurer = aiObj.insurer;
            if (aiObj.productDetected) base.productDetected = aiObj.productDetected;
            if (aiObj.contractNo) base.contractNo = String(aiObj.contractNo);
            if (aiObj.start) base.start = num(aiObj.start);
            if (aiObj.end)   base.end   = num(aiObj.end);
            if (aiObj.premium) base.premium = num(aiObj.premium);
            if (aiObj.tnProgression) base.tnProgression = num(aiObj.tnProgression);
            if (aiObj.pnFromDay) base.pnFromDay = num(aiObj.pnFromDay);
            if (typeof aiObj.pnRetroactive === 'boolean') base.pnRetroactive = aiObj.pnRetroactive;
            if (aiObj.note) base.note = aiObj.note;
            if (aiObj.items && typeof aiObj.items === 'object') {
                D.CATEGORIES.forEach(cat => {
                    if (num(aiObj.items[cat.key]) > 0) base.items[cat.key] = num(aiObj.items[cat.key]);
                });
            }
            base.itemPremiums = base.itemPremiums || {};
            if (aiObj.itemPremiums && typeof aiObj.itemPremiums === 'object') {
                D.CATEGORIES.forEach(cat => {
                    if (num(aiObj.itemPremiums[cat.key]) > 0) base.itemPremiums[cat.key] = num(aiObj.itemPremiums[cat.key]);
                });
            }
            const sumIP = Object.values(base.itemPremiums).reduce((s, v) => s + num(v), 0);
            if (!base.premium && sumIP > 0) base.premium = sumIP;

            base.matchedSummary = [];
            base.extractedRows = [];
            D.CATEGORIES.forEach(cat => {
                const v = num(base.items[cat.key]);
                const pv = num(base.itemPremiums[cat.key]);
                if (v > 0 || pv > 0) {
                    base.matchedSummary.push({
                        key: cat.key,
                        label: cat.label,
                        val: v,
                        prem: pv,
                        formatted: fmtCatValue(v, cat),
                        formattedPrem: pv > 0 ? `${fmt(pv)} Kč/měs` : '—'
                    });
                    base.extractedRows.push({
                        id: 'er_' + cat.key + '_' + Math.random().toString(36).substr(2, 6),
                        tariff: '',
                        rawTitle: cat.label,
                        categoryKey: cat.key,
                        amount: v,
                        itemPrem: pv,
                        unit: cat.kind === 'daily' ? 'Kč/den' : cat.kind === 'monthly' ? 'Kč/měs' : 'Kč'
                    });
                }
            });
            lastExtractedContract = base;
            renderExtractedContractPreview(base, 'Zpřesněno přes AI (Groq)');
            if (stTxt) stTxt.textContent = `AI analýza dokončena (${base.matchedSummary.length} rizik).`;
            toast('AI zpřesnila vytěžená data smlouvy (včetně pojistného po položkách)', 'success');
        } catch (e) {
            toast('AI zpřesnění selhalo: ' + e.message, 'error');
            if (stTxt) stTxt.textContent = 'AI zpřesnění selhalo: ' + e.message;
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    /* Vyplnění polí přímo v otevřeném modalu smlouvy (#contractModal) */
    function fillOpenContractModalWithParsed(parsed) {
        if (!parsed) return;
        const setVal = (id, val) => { const el = document.getElementById(id); if (el && val != null && val !== '') el.value = val; };
        const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

        if (parsed.clientId) setVal('mod_client', parsed.clientId);
        if (parsed.insurer) {
            const insSel = document.getElementById('mod_insurer');
            const wrap = document.getElementById('mod_otherInsurerWrap');
            if (insSel) {
                if (D.INSURER_NAMES.includes(parsed.insurer)) {
                    insSel.value = parsed.insurer;
                    if (wrap) wrap.classList.add('hidden');
                } else {
                    insSel.value = 'OTHER';
                    if (wrap) wrap.classList.remove('hidden');
                    setVal('mod_otherInsurer', parsed.insurer);
                }
            }
        }
        if (parsed.contractNo) setVal('mod_contractNo', parsed.contractNo);
        if (parsed.start)      setVal('mod_start', parsed.start);
        if (parsed.end)        setVal('mod_end', parsed.end);
        if (parsed.premium) {
            setVal('mod_premium', parsed.premium);
            const prEl = document.getElementById('mod_premium');
            if (prEl) prEl.classList.toggle('has-val', num(parsed.premium) > 0);
        }
        if (parsed.paymentFrequency) setVal('mod_freq', parsed.paymentFrequency);
        if (parsed.contractType)     setVal('mod_contractType', parsed.contractType);
        if (parsed.tnProgression)    setVal('mod_tnProg', String(parsed.tnProgression));
        if (parsed.pnFromDay)        setVal('mod_pnFromDay', String(parsed.pnFromDay));
        setChk('mod_pnRetroactive', parsed.pnRetroactive);
        setChk('mod_invPsych', parsed.invPsychIncluded !== false);
        setChk('mod_backPain', parsed.backPainIncluded);
        if (parsed.note) setVal('mod_actionReason', parsed.note);

        let filledCount = 0;
        D.CATEGORIES.forEach(cat => {
            const val = num(parsed.items && parsed.items[cat.key]);
            const pval = num(parsed.itemPremiums && parsed.itemPremiums[cat.key]);
            const input = document.getElementById('mod_item_' + cat.key);
            const pInput = document.getElementById('mod_prem_' + cat.key);
            if (input && val > 0) {
                input.value = val;
                input.classList.add('has-val');
                input.style.borderColor = '#10b981';
                input.style.backgroundColor = 'rgba(16, 185, 129, 0.12)';
                filledCount++;
            }
            if (pInput && pval > 0) {
                pInput.value = pval;
                pInput.classList.add('has-val');
                pInput.style.borderColor = '#f59e0b';
                pInput.style.backgroundColor = 'rgba(245, 158, 11, 0.15)';
            }
        });
        recalcModalItemPremiums(false);

        const inlineSt = document.getElementById('mod_inlineUploadStatus');
        if (inlineSt) {
            inlineSt.innerHTML = `<span class="text-emerald-300 font-semibold">✓ Ze souboru vyplněno: ${escapeHtml(parsed.insurer || 'Pojišťovna')} ${parsed.contractNo ? 'č. ' + escapeHtml(parsed.contractNo) : ''}, celkové pojistné ${fmtCZK(parsed.premium || 0)} a ${filledCount} pojistných rizik včetně pojistného za položku.</span>`;
        }
    }

    async function handleInlineModalFileUpload(ev) {
        const file = ev.target?.files?.[0];
        if (!file) return;
        const inlineSt = document.getElementById('mod_inlineUploadStatus');
        const setSt = msg => { if (inlineSt) inlineSt.textContent = msg; };
        try {
            const { parsed } = await processUploadedContractFile(file, setSt);
            fillOpenContractModalWithParsed(parsed);
            toast(`Formulář předvyplněn ze souboru (${parsed.matchedSummary.length} rizik)`, 'success');
        } catch (err) {
            toast('Chyba načtení souboru: ' + err.message, 'error');
        }
        ev.target.value = '';
    }

    function applyExtractedContractToForm(openModalAfter) {
        if (!lastExtractedContract) {
            toast('Nejprve nahrajte dokument smlouvy.', 'info');
            return;
        }
        if (!state.clients.length) {
            state.clients.push({
                id: uid(),
                name: lastExtractedContract.clientName || 'Klient 1',
                role: 'adult',
                birthYear: lastExtractedContract.birthYear || 1985,
                incomeGross: 45000,
                expensesMonthly: 22000,
                reserveCash: 100000,
                isEntrepreneur: false,
                occupationRisk: '1',
                note: ''
            });
        }
        const p = lastExtractedContract;
        const clientId = p.clientId || state.clients[0].id;
        const newC = emptyContract(clientId, docUploadTarget);
        newC.insurer = p.insurer || '';
        newC.contractNo = p.contractNo || '';
        newC.start = p.start || new Date().getFullYear();
        newC.end = p.end || null;
        newC.premium = num(p.premium);
        newC.note = p.note || '';
        newC.actionReason = p.note || '';
        newC.conditions = Object.assign(newC.conditions, {
            contractType: p.contractType || 'risk',
            paymentFrequency: p.paymentFrequency || 'monthly',
            tnProgression: p.tnProgression || 800,
            pnFromDay: p.pnFromDay || 29,
            pnWaitingDays: p.pnFromDay || 29,
            pnRetroactive: !!p.pnRetroactive,
            invPsychIncluded: p.invPsychIncluded !== false,
            backPainIncluded: !!p.backPainIncluded
        });
        D.CATEGORIES.forEach(cat => {
            newC.items[cat.key] = num(p.items && p.items[cat.key]);
            newC.itemPremiums[cat.key] = num(p.itemPremiums && p.itemPremiums[cat.key]);
        });

        const targetList = docUploadTarget === 'current' ? state.currentContracts : state.proposedContracts;
        targetList.push(newC);
        save();
        closeDocUploadModal();
        switchTab(docUploadTarget === 'current' ? 'stavajici' : 'navrh');
        renderAll();

        if (openModalAfter) {
            editContract(docUploadTarget, newC.id);
            setTimeout(() => fillOpenContractModalWithParsed(p), 50);
            toast('Smlouva načtena do formuláře ke kontrole', 'success');
        } else {
            toast(`Smlouva ${newC.insurer || ''} (${newC.contractNo || 'nová'}) uložena`, 'success');
        }
    }

    /* ════════════ LEGAL & INSURERS CATALOG ════════════ */
    function renderLegal() {
        const catEl = document.getElementById('insurersCatalogContent');
        if (catEl) {
            catEl.innerHTML = `
                <div class="overflow-x-auto">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Pojišťovna</th>
                                <th>Vlajkový produkt (2026)</th>
                                <th class="num">Max. progrese TN</th>
                                <th>Silné stránky a výhody</th>
                                <th>Specifika / na co dát pozor</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${D.INSURERS.map(ins => `
                                <tr>
                                    <td><strong class="text-slate-100">${escapeHtml(ins.name)}</strong> <span class="badge badge-sky ml-1">${escapeHtml(ins.short)}</span></td>
                                    <td class="text-sky-300 font-medium">${escapeHtml(ins.productLine)}</td>
                                    <td class="num font-bold text-amber-300">${ins.defaultConditions.tnProgression || 800} %</td>
                                    <td class="text-slate-300 text-[11px]">${escapeHtml(ins.strengths || ins.notes)}</td>
                                    <td class="text-slate-400 text-[11px]">${escapeHtml(ins.weaknesses || '—')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
        const legEl = document.getElementById('legalContent');
        if (legEl) {
            legEl.innerHTML = D.LEGAL_FRAMEWORK.map(b =>
                `<div class="legal-block"><h3>${escapeHtml(b.title)}</h3>${b.body}</div>`).join('');
        }
    }

    /* ════════════ SETTINGS & BRANDING ════════════ */
    function renderSettings() {
        const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v || ''; };
        setVal('setGroqKey', getApiKey());
        setVal('setGroqModel', getModel());
        setVal('setAdvisorName', state.advisorName);
        setVal('setAdvisorCompany', state.advisorCompany || DEFAULT_COMPANY);
        setVal('setAdvisorIco', state.advisorIco);
        setVal('setAdvisorPhone', state.advisorPhone);
        setVal('setAdvisorEmail', state.advisorEmail);
        setVal('setModelId', state.modelId);
        setVal('setLogoUrl', state.logoUrl);
        refreshLogoPreview();
        updateStoragePreview();
    }

    function saveSettings() {
        const key = document.getElementById('setGroqKey').value.trim();
        const model = document.getElementById('setGroqModel').value;
        lsSet('groq_api_key', key);
        setCookie('groq_api_key', key, 365);
        lsSet('groq_model', model);
        toast('Nastavení AI uloženo', 'success');
    }

    function savePrintBranding() {
        const g = id => document.getElementById(id)?.value.trim() || '';
        state.advisorName    = g('setAdvisorName');
        state.advisorCompany = g('setAdvisorCompany');
        state.advisorIco     = g('setAdvisorIco');
        state.advisorPhone   = g('setAdvisorPhone');
        state.advisorEmail   = g('setAdvisorEmail');
        state.modelId        = g('setModelId') || 'MOD-2026-01';
        const luVal          = g('setLogoUrl');
        state.logoUrl        = luVal || DEFAULT_LOGO_URL;

        setCookie('insurance_advisor_name', state.advisorName, 365);
        setCookie('insurance_advisor_company', state.advisorCompany, 365);
        setCookie('insurance_advisor_ico', state.advisorIco, 365);
        setCookie('insurance_advisor_phone', state.advisorPhone, 365);
        setCookie('insurance_advisor_email', state.advisorEmail, 365);
        setCookie('insurance_model_id', state.modelId, 365);
        setCookie('insurance_logo_url', state.logoUrl, 365);
        save();
        refreshLogoPreview();
    }

    function refreshLogoPreview() {
        const wrap = document.getElementById('logoPreview');
        const img = document.getElementById('logoPreviewImg');
        if (!wrap || !img) return;
        const url = (state.logoUrl || '').trim();
        if (!url) { wrap.classList.add('hidden'); return; }
        img.onerror = () => { wrap.classList.add('hidden'); };
        img.onload = () => { wrap.classList.remove('hidden'); };
        img.src = url;
    }

    function updateStoragePreview() {
        const el = document.getElementById('storagePreview');
        if (!el) return;
        const s = JSON.stringify(state, null, 2);
        el.textContent = s.slice(0, 4000) + (s.length > 4000 ? '\n…(zkráceno)' : '');
    }

    function setTheme(t) {
        document.documentElement.classList.toggle('light', t === 'light');
        document.documentElement.classList.toggle('dark', t === 'dark');
        lsSet('finance_theme', t);
        setCookie('finance_theme', t, 365);
        toast('Téma: ' + (t === 'light' ? 'světlé' : 'tmavé'), 'info');
    }
    function applyStoredTheme() {
        const t = lsGet('finance_theme') || getCookie('finance_theme') || 'dark';
        if (t === 'light') document.documentElement.classList.add('light');
    }

    /* ════════════ EXPORT / IMPORT / RESET / PRINT ════════════ */
    function buildExportFilename(ext) {
        const date = new Date().toISOString().slice(0, 10);
        let name = state.clients[0]?.name ? state.clients[0].name.trim() : 'Portfolio';
        name = name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
        return `${date} Srovnani ZP - ${name}.${ext || 'json'}`;
    }
    function exportData() {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = buildExportFilename('json');
        a.click();
        URL.revokeObjectURL(url);
        toast('Export JSON hotov', 'success');
    }

    async function ensureExcelJS() {
        if (window.ExcelJS) return window.ExcelJS;
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = () => window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('ExcelJS se nepodařilo inicializovat.'));
            s.onerror = () => reject(new Error('Nelze načíst knihovnu ExcelJS z CDN. Zkontrolujte připojení k internetu.'));
            document.head.appendChild(s);
        });
    }

    function excelColName(n) {
        let s = '';
        while (n > 0) {
            const m = (n - 1) % 26;
            s = String.fromCharCode(65 + m) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    }

    async function exportXlsx() {
        try {
            toast('Generuji strukturovaný Excel (.xlsx)…', 'info');
            const ExcelJS = await ensureExcelJS();
            const wb = new ExcelJS.Workbook();
            const today = new Date().toLocaleDateString('cs-CZ');
            const advName = (state.advisorName || '').trim() || 'Finanční a pojistný poradce';
            const advCompany = (state.advisorCompany || '').trim() || DEFAULT_COMPANY;
            const modId = (state.modelId || '').trim() || 'MOD-2026-01';

            wb.creator = `${advName} (${advCompany})`;
            wb.lastModifiedBy = advName;
            wb.created = new Date();
            wb.modified = new Date();

            /* ── Stylové palety a pomocné funkce ── */
            const FONT = 'Segoe UI';
            const borderThin = {
                top:    { style: 'thin', color: { argb: 'FFCBD5E1' } },
                left:   { style: 'thin', color: { argb: 'FFCBD5E1' } },
                bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                right:  { style: 'thin', color: { argb: 'FFCBD5E1' } }
            };
            const borderHeader = {
                top:    { style: 'thin', color: { argb: 'FF475569' } },
                left:   { style: 'thin', color: { argb: 'FF64748B' } },
                bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
                right:  { style: 'thin', color: { argb: 'FF64748B' } }
            };
            const borderTotal = {
                top:    { style: 'thin', color: { argb: 'FF1E3A8A' } },
                left:   { style: 'thin', color: { argb: 'FF93C5FD' } },
                bottom: { style: 'double', color: { argb: 'FF1E3A8A' } },
                right:  { style: 'thin', color: { argb: 'FF93C5FD' } }
            };

            const FMT_CZK = '#,##0 "Kč"';
            const FMT_CZK_DELTA = '+#,##0 "Kč";-#,##0 "Kč";"0 Kč"';
            const FMT_DAILY = '#,##0 "Kč/den"';
            const FMT_DAILY_DELTA = '+#,##0 "Kč/den";-#,##0 "Kč/den";"0 Kč/den"';
            const FMT_MONTHLY = '#,##0 "Kč/měs"';
            const FMT_MONTHLY_DELTA = '+#,##0 "Kč/měs";-#,##0 "Kč/měs";"0 Kč/měs"';
            const FMT_PCT = '0.0 %';

            function catFmt(cat, isDelta) {
                if (!cat) return isDelta ? FMT_CZK_DELTA : FMT_CZK;
                if (cat.kind === 'daily') return isDelta ? FMT_DAILY_DELTA : FMT_DAILY;
                if (cat.kind === 'monthly') return isDelta ? FMT_MONTHLY_DELTA : FMT_MONTHLY;
                return isDelta ? FMT_CZK_DELTA : FMT_CZK;
            }

            function addSheetBanner(ws, title, subtitle, maxCols) {
                const endCol = excelColName(maxCols);
                const r1 = ws.addRow([title]);
                ws.mergeCells(`A${r1.number}:${endCol}${r1.number}`);
                r1.height = 30;
                r1.getCell(1).font = { name: FONT, size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
                r1.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
                r1.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

                const metaLine = `${subtitle}   |   ID modelace: ${modId}   |   Zpracoval: ${advName} (${advCompany})${state.advisorPhone ? ' · Tel: ' + state.advisorPhone : ''}${state.advisorEmail ? ' · ' + state.advisorEmail : ''}   |   Datum: ${today}`;
                const r2 = ws.addRow([metaLine]);
                ws.mergeCells(`A${r2.number}:${endCol}${r2.number}`);
                r2.height = 20;
                r2.getCell(1).font = { name: FONT, size: 9.5, italic: true, color: { argb: 'FFBAE6FD' } };
                r2.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
                r2.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

                const r3 = ws.addRow([]);
                r3.height = 8;
            }

            function addSectionBar(ws, title, maxCols, bgArgb) {
                const endCol = excelColName(maxCols);
                const r = ws.addRow([title]);
                ws.mergeCells(`A${r.number}:${endCol}${r.number}`);
                r.height = 23;
                r.getCell(1).font = { name: FONT, size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
                r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb || 'FF0369A1' } };
                r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                return r;
            }

            function styleTableHeader(row, maxCols, alignMap) {
                row.height = 24;
                for (let c = 1; c <= maxCols; c++) {
                    const cell = row.getCell(c);
                    cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                    cell.border = borderHeader;
                    cell.alignment = {
                        vertical: 'middle',
                        horizontal: (alignMap && alignMap[c]) || 'left',
                        wrapText: true
                    };
                }
            }

            function styleDataRow(row, maxCols, isEven, alignMap) {
                row.height = 20;
                const bg = isEven ? 'FFF8FAFC' : 'FFFFFFFF';
                for (let c = 1; c <= maxCols; c++) {
                    const cell = row.getCell(c);
                    cell.font = { name: FONT, size: 9.5, color: { argb: 'FF1E293B' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
                    cell.border = borderThin;
                    cell.alignment = {
                        vertical: 'middle',
                        horizontal: (alignMap && alignMap[c]) || 'left',
                        wrapText: true
                    };
                }
            }

            function styleTotalRow(row, maxCols, alignMap, bgArgb) {
                row.height = 22;
                const bg = bgArgb || 'FFDBEAFE';
                for (let c = 1; c <= maxCols; c++) {
                    const cell = row.getCell(c);
                    cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
                    cell.border = borderTotal;
                    cell.alignment = {
                        vertical: 'middle',
                        horizontal: (alignMap && alignMap[c]) || 'left'
                    };
                }
            }

            function applyStatusBadgeStyle(cell, statusKey) {
                const map = {
                    keep:        { bg: 'FFDCFCE7', fg: 'FF166534' },
                    kept:        { bg: 'FFDCFCE7', fg: 'FF166534' },
                    modify:      { bg: 'FFFEF3C7', fg: 'FF92400E' },
                    cancel:      { bg: 'FFFFE4E6', fg: 'FF9F1239' },
                    consolidate: { bg: 'FFF3E8FF', fg: 'FF6B21A8' },
                    new:         { bg: 'FFE0F2FE', fg: 'FF075985' }
                };
                const st = map[statusKey] || map.keep;
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.bg } };
                cell.font = { name: FONT, size: 9, bold: true, color: { argb: st.fg } };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            }

            function applyDeltaStyle(cell, diffVal, invertGood) {
                const isGood = invertGood ? diffVal < 0 : diffVal > 0;
                const isBad  = invertGood ? diffVal > 0 : diffVal < 0;
                if (isGood) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
                    cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF15803D' } };
                } else if (isBad) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
                    cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FFB91C1C' } };
                } else {
                    cell.font = { name: FONT, size: 9.5, color: { argb: 'FF64748B' } };
                }
            }

            /* ── Souhrnná čísla pro sestavu ── */
            const curM = totalPremiumMonthly(state.currentContracts);
            const newM = totalPremiumMonthly(state.proposedContracts);
            const diffM = newM - curM;
            const loansTotal = sumLoans();
            const curHealth = computePortfolioPillars(state.currentContracts, 'ALL');
            const newHealth = computePortfolioPillars(state.proposedContracts, 'ALL');
            const curSmrt = sumItem(state.currentContracts, 'smrt') + sumItem(state.currentContracts, 'smrtKles');
            const newSmrt = sumItem(state.proposedContracts, 'smrt') + sumItem(state.proposedContracts, 'smrtKles');

            const keptCount = (state.currentContracts || []).filter(c => c.actionStatus === 'keep' || c.actionStatus === 'modify').length;
            const cancelCount = (state.currentContracts || []).filter(c => c.actionStatus === 'cancel' || c.actionStatus === 'consolidate').length;
            const newContractCount = (state.proposedContracts || []).filter(c => c.proposalStatus === 'new').length;

            /* ════════════════════════════════════════════════════════════════
               LIST 1: 1. Přehled & Akční plán
               ════════════════════════════════════════════════════════════════ */
            const ws1 = wb.addWorksheet('1. Přehled & Akční plán', {
                properties: { tabColor: { argb: 'FF0284C7' } },
                views: [{ state: 'frozen', ySplit: 2, showGridLines: true }],
                pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
            });
            ws1.columns = [
                { width: 26 }, { width: 22 }, { width: 18 }, { width: 18 },
                { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 38 }
            ];
            addSheetBanner(ws1, 'SROVNÁNÍ A MODELACE ŽIVOTNÍHO POJIŠTĚNÍ — MANAŽERSKÝ PŘEHLED', 'Analytický podklad a akční plán smluv dle doporučení finančního poradce', 9);

            /* Sekce 1A: KPI Přehled */
            addSectionBar(ws1, '1. KLÍČOVÉ UKAZATELE MODELACE (FINANČNÍ BILANCE, SKÓRE ZDRAVÍ POJIŠTĚNÍ & KRYTÍ ÚVĚRŮ)', 9, 'FF0369A1');
            const kpiHead = ws1.addRow(['Ukazatel portfolia', 'Stávající stav', 'Návrh poradce', 'Rozdíl (Δ)', 'Pilíř pojistné ochrany (0–100 %)', 'Stávající %', 'Návrh %', 'Posun', 'Komentář / Stav']);
            styleTableHeader(kpiHead, 9, { 2: 'right', 3: 'right', 4: 'right', 6: 'right', 7: 'right', 8: 'right' });

            const pillarNames = curHealth.labels || ['1. Smrt & Úvěry', '2. Invalidita I.–III.', '3. Závažné nemoci & TN', '4. PN, OČR & Nemocnice', '5. Kvalita podmínek'];
            const curInv3Total = sumItem(state.currentContracts, 'invalidita') + sumItem(state.currentContracts, 'invKles');
            const newInv3Total = sumItem(state.proposedContracts, 'invalidita') + sumItem(state.proposedContracts, 'invKles');
            const kpiRowsData = [
                {
                    label: 'Měsíční pojistné celkem', cur: curM, nw: newM, diff: diffM, fmt: FMT_CZK, dFmt: FMT_CZK_DELTA, inv: true,
                    note: diffM <= 0 ? 'Úspora na měsíčním pojistném' : 'Investice do navýšení pojistné ochrany'
                },
                {
                    label: 'Roční pojistné celkem', cur: curM * 12, nw: newM * 12, diff: diffM * 12, fmt: FMT_CZK, dFmt: FMT_CZK_DELTA, inv: true,
                    note: `Ponecháno: ${keptCount}× | K výpovědi: ${cancelCount}× | Nové: ${newContractCount}×`
                },
                {
                    label: 'Celkové krytí smrti (konst. + kles.)', cur: curSmrt, nw: newSmrt, diff: newSmrt - curSmrt, fmt: FMT_CZK, dFmt: FMT_CZK_DELTA, inv: false,
                    note: loansTotal > 0 ? (newSmrt >= loansTotal ? `Plně pokrývá 100 % úvěrů (${fmtCZK(loansTotal)})` : `Pozor: úvěry činí ${fmtCZK(loansTotal)}`) : 'Bez evidovaných úvěrů'
                },
                {
                    label: 'Krytí invalidity III. st. (konst. + kles.)',
                    cur: curInv3Total,
                    nw:  newInv3Total,
                    diff: newInv3Total - curInv3Total,
                    fmt: FMT_CZK, dFmt: FMT_CZK_DELTA, inv: false,
                    note: 'Klíčové krytí dlouhodobého výpadku příjmu'
                },
                {
                    label: 'Celkové Skóre zdraví pojištění', cur: (curHealth.overall || 0) / 100, nw: (newHealth.overall || 0) / 100, diff: ((newHealth.overall || 0) - (curHealth.overall || 0)) / 100, fmt: FMT_PCT, dFmt: '+0.0 %;-0.0 %;0.0 %', inv: false,
                    note: `Posun kvality portfolia z ${curHealth.overall || 0} % na ${newHealth.overall || 0} %`
                }
            ];

            kpiRowsData.forEach((kr, idx) => {
                const pCur = ((curHealth.scores && curHealth.scores[idx]) || 0) / 100;
                const pNew = ((newHealth.scores && newHealth.scores[idx]) || 0) / 100;
                const pDiff = pNew - pCur;
                const r = ws1.addRow([kr.label, kr.cur, kr.nw, kr.diff, pillarNames[idx], pCur, pNew, pDiff, kr.note]);
                styleDataRow(r, 9, idx % 2 === 1, { 2: 'right', 3: 'right', 4: 'right', 6: 'right', 7: 'right', 8: 'right' });
                r.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                r.getCell(2).numFmt = kr.fmt;
                r.getCell(3).numFmt = kr.fmt;
                r.getCell(3).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
                r.getCell(4).numFmt = kr.dFmt;
                applyDeltaStyle(r.getCell(4), kr.diff, kr.inv);
                r.getCell(5).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF334155' } };
                r.getCell(6).numFmt = FMT_PCT;
                r.getCell(7).numFmt = FMT_PCT;
                r.getCell(7).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
                r.getCell(8).numFmt = '+0.0 %;-0.0 %;0.0 %';
                applyDeltaStyle(r.getCell(8), pDiff, false);
            });

            ws1.addRow([]).height = 10;

            /* Sekce 1B: Zadání klienta & Doporučení poradce */
            if (state.adviserBrief || state.advisorRecommendation) {
                addSectionBar(ws1, '2. ZADÁNÍ KLIENTA A CELKOVÉ ODBORNÉ STANOVISKO FINANČNÍHO PORADCE', 9, 'FF1E3A8A');
                if (state.adviserBrief) {
                    const rb = ws1.addRow(['Zadání a požadavky klienta:', state.adviserBrief]);
                    ws1.mergeCells(`B${rb.number}:I${rb.number}`);
                    rb.height = Math.max(36, Math.ceil(state.adviserBrief.length / 110) * 16);
                    styleDataRow(rb, 9, false);
                    rb.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF075985' } };
                    rb.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
                    rb.getCell(2).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                }
                if (state.advisorRecommendation) {
                    const rr = ws1.addRow([`Doporučení poradce (${advName}, ${advCompany}):`, state.advisorRecommendation]);
                    ws1.mergeCells(`B${rr.number}:I${rr.number}`);
                    rr.height = Math.max(42, Math.ceil(state.advisorRecommendation.length / 110) * 16);
                    styleDataRow(rr, 9, true);
                    rr.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF166534' } };
                    rr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
                    rr.getCell(2).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                    rr.getCell(2).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                }
                ws1.addRow([]).height = 10;
            }

            /* Sekce 1C: Přehled osob a příjmů dle ČSSZ 2026 */
            addSectionBar(ws1, '3. POSUZOVANÉ OSOBY, PŘÍJMY A ODHAD STÁTNÍCH DÁVEK ČSSZ (2026)', 9, 'FF0369A1');
            const clHead = ws1.addRow([
                'Jméno a příjmení', 'Role / Typ osoby', 'Rok nar. (Věk)', 'Režim příjmu',
                'Hrubý příjem / měs', 'Čistý příjem / měs', 'Státní nemocenská / měs', 'Státní inv. důchod III. st.', 'Měsíční výdaje & Rezerva'
            ]);
            styleTableHeader(clHead, 9, { 3: 'center', 4: 'center', 5: 'right', 6: 'right', 7: 'right', 8: 'right' });

            const curY = new Date().getFullYear();
            (state.clients || []).forEach((c, idx) => {
                const child = isChildPerson(c);
                const age = c.birthYear ? (curY - c.birthYear) : null;
                const netInc = child ? 0 : D.computeNetIncome(c.incomeGross, c.isEntrepreneur);
                const sick = child ? { monthlyAvg: 0 } : D.computeExactSickLeave(c.incomeGross, c.isEntrepreneur, 60);
                const pens = child ? { inv3: 0 } : D.computeStateDisabilityPension(c.incomeGross, c.isEntrepreneur, c.birthYear);
                const r = ws1.addRow([
                    c.name || '—',
                    child ? 'Dítě / Nezaopatřená osoba' : 'Dospělý (živitel)',
                    c.birthYear ? `${c.birthYear} (${age} let)` : '—',
                    child ? 'Dítě' : (c.isEntrepreneur ? 'OSVČ' : `Zaměstnanec (sk. ${c.occupationRisk || '1'})`),
                    child ? 0 : num(c.incomeGross),
                    netInc,
                    sick.monthlyAvg,
                    pens.inv3 || 0,
                    child ? (c.note || 'Dětský tarif') : `Výdaje: ${fmtCZK(c.expensesMonthly || 0)}/měs | Rezerva: ${fmtCZK(c.reserveCash || 0)}`
                ]);
                styleDataRow(r, 9, idx % 2 === 1, { 3: 'center', 4: 'center', 5: 'right', 6: 'right', 7: 'right', 8: 'right' });
                r.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                [5, 6, 7, 8].forEach(colIdx => { r.getCell(colIdx).numFmt = FMT_CZK; });
            });

            ws1.addRow([]).height = 10;

            /* Sekce 1D: Akční plán smluv (Stávající + Návrh) */
            addSectionBar(ws1, '4. AKČNÍ PLÁN SMLUV — CO PONECHAT, CO VYPOVĚDĚT A CO SJEDNAT NOVĚ', 9, 'FF0F172A');
            const actHead = ws1.addRow([
                'Portfolio', 'Doporučená akce', 'Pojištěná osoba', 'Pojišťovna',
                'Číslo smlouvy / Produkt', 'Platnost Od–Do', 'Měsíční pojistné', 'Progrese TN / PN', 'Zdůvodnění finančního poradce & Poznámka'
            ]);
            styleTableHeader(actHead, 9, { 2: 'center', 6: 'center', 7: 'right', 8: 'center' });

            let actIdx = 0;
            (state.currentContracts || []).forEach(c => {
                const actKey = c.actionStatus || 'keep';
                const actMeta = (D.CONTRACT_ACTIONS.current || []).find(a => a.key === actKey) || D.CONTRACT_ACTIONS.current[0];
                const cond = c.conditions || {};
                const r = ws1.addRow([
                    'Stávající smlouva',
                    actMeta.short,
                    clientName(c.clientId),
                    c.insurer || '—',
                    c.contractNo || '—',
                    `${c.start || '—'} – ${c.end || 'neurčito'}`,
                    contractMonthlyPremium(c),
                    `TN ${cond.tnProgression || 100}% | PN od ${cond.pnFromDay || 29}.d`,
                    c.actionReason || c.note || '—'
                ]);
                styleDataRow(r, 9, actIdx++ % 2 === 1, { 2: 'center', 6: 'center', 7: 'right', 8: 'center' });
                applyStatusBadgeStyle(r.getCell(2), actKey);
                r.getCell(7).numFmt = FMT_CZK;
            });

            (state.proposedContracts || []).forEach(c => {
                const propKey = c.proposalStatus || 'new';
                const propMeta = (D.CONTRACT_ACTIONS.proposed || []).find(a => a.key === propKey) || D.CONTRACT_ACTIONS.proposed[0];
                const cond = c.conditions || {};
                const r = ws1.addRow([
                    'Návrh poradce',
                    propMeta.short,
                    clientName(c.clientId),
                    c.insurer || '—',
                    c.contractNo || 'Nová smlouva',
                    `${c.start || '—'} – ${c.end || 'neurčito'}`,
                    contractMonthlyPremium(c),
                    `TN ${cond.tnProgression || 800}% | PN od ${cond.pnFromDay || 29}.d${cond.pnRetroactive ? ' zpětně' : ''}`,
                    c.actionReason || c.note || '—'
                ]);
                styleDataRow(r, 9, actIdx++ % 2 === 1, { 2: 'center', 6: 'center', 7: 'right', 8: 'center' });
                applyStatusBadgeStyle(r.getCell(2), propKey);
                r.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
                r.getCell(7).numFmt = FMT_CZK;
                r.getCell(7).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
            });

            /* ════════════════════════════════════════════════════════════════
               LIST 2: 2. Srovnání krytí (33 rizik + Pojistné za položku + Rozpad po osobách)
               ════════════════════════════════════════════════════════════════ */
            const ws2 = wb.addWorksheet('2. Srovnání krytí & Pojistné', {
                properties: { tabColor: { argb: 'FF10B981' } },
                views: [{ state: 'frozen', ySplit: 5, showGridLines: true }],
                pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
            });
            ws2.columns = [
                { width: 24 }, { width: 32 }, { width: 14 }, { width: 17 },
                { width: 15 }, { width: 17 }, { width: 15 }, { width: 17 }, { width: 15 }, { width: 19 }, { width: 38 }
            ];
            addSheetBanner(ws2, 'POLOŽKOVÉ SROVNÁNÍ POJISTNÉ ČÁSTKY A POJISTNÉHO ZA POLOŽKU: STÁVAJÍCÍ × NÁVRH', 'Kompletní srovnání všech 33 pojistných kategorií v 6 skupinách rizik včetně rozpadu měsíčního pojistného za položku', 11);
            addSectionBar(ws2, 'ČÁST A: SOUHRNNÉ SROVNÁNÍ POJISTNÉ ČÁSTKY A MĚSÍČNÍHO POJISTNÉHO DLE SKUPIN RIZIK', 11, 'FF047857');

            const cmpHead = ws2.addRow([
                'Skupina rizik', 'Pojistné riziko / kategorie', 'Typ plnění',
                'Stávající PČ', 'Stáv. pojistné', 'Návrh PČ', 'Návrh pojistné',
                'Rozdíl PČ (Δ)', 'Rozdíl poj. (Δ)', 'Vyhodnocení změny', 'Popis a metodická poznámka'
            ]);
            styleTableHeader(cmpHead, 11, { 3: 'center', 4: 'right', 5: 'right', 6: 'right', 7: 'right', 8: 'right', 9: 'right', 10: 'center' });

            let cmpIdx = 0;
            D.CATEGORY_GROUPS.forEach(grp => {
                const grpCats = D.CATEGORIES.filter(c => c.group === grp.key);
                const grpCurPrem = sumGroupPremium(state.currentContracts, grp.key, 'ALL');
                const grpNwPrem  = sumGroupPremium(state.proposedContracts, grp.key, 'ALL');
                /* Mezititulek skupiny */
                const grRow = ws2.addRow([`${grp.label.toUpperCase()}   (Pojistné bloku: Stávající ${fmt(grpCurPrem)} Kč/měs → Návrh ${fmt(grpNwPrem)} Kč/měs)`]);
                ws2.mergeCells(`A${grRow.number}:K${grRow.number}`);
                grRow.height = 20;
                grRow.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF075985' } };
                grRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
                grRow.getCell(1).border = borderThin;
                grRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

                grpCats.forEach(cat => {
                    const curV = sumItem(state.currentContracts, cat.key);
                    const newV = sumItem(state.proposedContracts, cat.key);
                    const curP = sumItemPremium(state.currentContracts, cat.key);
                    const newP = sumItemPremium(state.proposedContracts, cat.key);
                    const diffV = newV - curV;
                    const diffP = newP - curP;
                    const kindLabel = cat.kind === 'daily' ? 'Denní dávka' : cat.kind === 'monthly' ? 'Měsíční renta' : 'Jednorázová PČ';
                    let evalText = 'Beze změny';
                    if (curV === 0 && newV > 0) evalText = '★ NOVĚ DOPLNĚNO';
                    else if (diffV > 0 && diffP <= 0) evalText = '▲ Vyšší PČ levněji';
                    else if (diffV > 0) evalText = '▲ Navýšení krytí';
                    else if (diffV < 0 && newV === 0) evalText = '✕ Zrušeno v návrhu';
                    else if (diffV < 0) evalText = '▼ Optimalizace PČ';
                    else if (curV > 0 && diffV === 0 && diffP < 0) evalText = '✓ Stejná PČ levněji';
                    else if (curV === 0 && newV === 0) evalText = 'Nesjednáno';

                    const r = ws2.addRow([
                        grp.label,
                        cat.label,
                        kindLabel,
                        curV,
                        curP,
                        newV,
                        newP,
                        diffV,
                        diffP,
                        evalText,
                        cat.help || ''
                    ]);
                    r.getCell(8).value = { formula: `F${r.number}-D${r.number}`, result: diffV };
                    r.getCell(9).value = { formula: `G${r.number}-E${r.number}`, result: diffP };
                    styleDataRow(r, 11, cmpIdx++ % 2 === 1, { 3: 'center', 4: 'right', 5: 'right', 6: 'right', 7: 'right', 8: 'right', 9: 'right', 10: 'center' });
                    r.getCell(2).font = { name: FONT, size: 9.5, bold: (curV > 0 || newV > 0), color: { argb: (curV > 0 || newV > 0) ? 'FF0F172A' : 'FF94A3B8' } };
                    r.getCell(4).numFmt = catFmt(cat, false);
                    r.getCell(5).numFmt = FMT_MONTHLY;
                    r.getCell(5).font = { name: FONT, size: 9, color: { argb: curP > 0 ? 'FFB45309' : 'FF94A3B8' } };
                    r.getCell(6).numFmt = catFmt(cat, false);
                    if (newV > 0) r.getCell(6).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
                    r.getCell(7).numFmt = FMT_MONTHLY;
                    r.getCell(7).font = { name: FONT, size: 9, bold: newP > 0, color: { argb: newP > 0 ? 'FF0369A1' : 'FF94A3B8' } };
                    r.getCell(8).numFmt = catFmt(cat, true);
                    applyDeltaStyle(r.getCell(8), diffV, false);
                    r.getCell(9).numFmt = FMT_MONTHLY_DELTA;
                    applyDeltaStyle(r.getCell(9), diffP, true);
                    applyDeltaStyle(r.getCell(10), diffV, false);
                });
            });

            const totCmpM = ws2.addRow([
                'FINANČNÍ BILANCE', 'Celkové měsíční pojistné', 'Měsíční platba',
                0, curM, 0, newM, 0, diffM,
                diffM <= 0 ? 'Úspora pojistného' : 'Navýšení rozpočtu',
                `Ročně stávající: ${fmtCZK(curM * 12)} → Návrh poradce: ${fmtCZK(newM * 12)}/rok`
            ]);
            totCmpM.getCell(4).value = `${state.currentContracts.length} smluv`;
            totCmpM.getCell(6).value = `${state.proposedContracts.length} smluv`;
            totCmpM.getCell(8).value = '—';
            totCmpM.getCell(9).value = { formula: `G${totCmpM.number}-E${totCmpM.number}`, result: diffM };
            styleTotalRow(totCmpM, 11, { 3: 'center', 4: 'center', 5: 'right', 6: 'center', 7: 'right', 8: 'center', 9: 'right', 10: 'center' });
            totCmpM.getCell(5).numFmt = FMT_CZK;
            totCmpM.getCell(7).numFmt = FMT_CZK;
            totCmpM.getCell(9).numFmt = FMT_CZK_DELTA;

            ws2.addRow([]).height = 12;

            /* Část B: Srovnání po jednotlivých pojištěných osobách */
            addSectionBar(ws2, 'ČÁST B: SROVNÁNÍ KLÍČOVÝCH RIZIK PO JEDNOTLIVÝCH POJIŠTĚNÝCH OSOBÁCH', 11, 'FF0369A1');
            const perPersonHead = ws2.addRow([
                'Pojištěná osoba', 'Varianta', 'Měsíční pojistné', 'Smrt celkem (konst.+kles.)',
                'Invalidita III. st. (konst.+kles.)', 'Invalidita II. / I. st.', 'Závažná onemocnění',
                'Trvalé následky úrazu (základ)', 'Denní dávky (Úraz / Hosp. / PN)', 'Pojistné Smrt+Inv.', 'Pojistné Úraz+Nemoc'
            ]);
            styleTableHeader(perPersonHead, 11, { 2: 'center', 3: 'right', 4: 'right', 5: 'right', 6: 'center', 7: 'right', 8: 'right', 9: 'center', 10: 'right', 11: 'right' });

            (state.clients || []).forEach((cl, cIdx) => {
                const pCurList = (state.currentContracts || []).filter(c => c.clientId === cl.id);
                const pNewList = (state.proposedContracts || []).filter(c => c.clientId === cl.id);

                const pCurPrem = totalPremiumMonthly(pCurList);
                const pNewPrem = totalPremiumMonthly(pNewList);

                const curS = sumItemFor(state.currentContracts, cl.id, 'smrt') + sumItemFor(state.currentContracts, cl.id, 'smrtKles');
                const newS = sumItemFor(state.proposedContracts, cl.id, 'smrt') + sumItemFor(state.proposedContracts, cl.id, 'smrtKles');

                const curI3 = sumItemFor(state.currentContracts, cl.id, 'invalidita') + sumItemFor(state.currentContracts, cl.id, 'invKles') + sumItemFor(state.currentContracts, cl.id, 'trvaleNasledkyNemoc');
                const newI3 = sumItemFor(state.proposedContracts, cl.id, 'invalidita') + sumItemFor(state.proposedContracts, cl.id, 'invKles') + sumItemFor(state.proposedContracts, cl.id, 'trvaleNasledkyNemoc');

                const curI21 = `${fmtCZKShort(sumItemFor(state.currentContracts, cl.id, 'inv2'))} / ${fmtCZKShort(sumItemFor(state.currentContracts, cl.id, 'inv1'))}`;
                const newI21 = `${fmtCZKShort(sumItemFor(state.proposedContracts, cl.id, 'inv2'))} / ${fmtCZKShort(sumItemFor(state.proposedContracts, cl.id, 'inv1'))}`;

                const curZO = sumItemFor(state.currentContracts, cl.id, 'zavOn') + sumItemFor(state.currentContracts, cl.id, 'zavOnKles') + sumItemFor(state.currentContracts, cl.id, 'zavOnMuzZena');
                const newZO = sumItemFor(state.proposedContracts, cl.id, 'zavOn') + sumItemFor(state.proposedContracts, cl.id, 'zavOnKles') + sumItemFor(state.proposedContracts, cl.id, 'zavOnMuzZena');

                const curTN = sumItemFor(state.currentContracts, cl.id, 'tnUraz') + sumItemFor(state.currentContracts, cl.id, 'tnUraz10');
                const newTN = sumItemFor(state.proposedContracts, cl.id, 'tnUraz') + sumItemFor(state.proposedContracts, cl.id, 'tnUraz10');

                const curDaily = `DO: ${sumItemFor(state.currentContracts, cl.id, 'uraz')}/d | Hosp: ${sumItemFor(state.currentContracts, cl.id, 'hosp')}/d | PN: ${sumItemFor(state.currentContracts, cl.id, 'pn15') + sumItemFor(state.currentContracts, cl.id, 'pn28') + sumItemFor(state.currentContracts, cl.id, 'pn61')}/d`;
                const newDaily = `DO: ${sumItemFor(state.proposedContracts, cl.id, 'uraz')}/d | Hosp: ${sumItemFor(state.proposedContracts, cl.id, 'hosp')}/d | PN: ${sumItemFor(state.proposedContracts, cl.id, 'pn15') + sumItemFor(state.proposedContracts, cl.id, 'pn28') + sumItemFor(state.proposedContracts, cl.id, 'pn61')}/d`;

                const curPremCore = sumGroupPremium(state.currentContracts, 'death', cl.id) + sumGroupPremium(state.currentContracts, 'disability', cl.id) + sumGroupPremium(state.currentContracts, 'illness', cl.id);
                const newPremCore = sumGroupPremium(state.proposedContracts, 'death', cl.id) + sumGroupPremium(state.proposedContracts, 'disability', cl.id) + sumGroupPremium(state.proposedContracts, 'illness', cl.id);
                const curPremAcc  = sumGroupPremium(state.currentContracts, 'accident', cl.id) + sumGroupPremium(state.currentContracts, 'sickness', cl.id) + sumGroupPremium(state.currentContracts, 'addons', cl.id);
                const newPremAcc  = sumGroupPremium(state.proposedContracts, 'accident', cl.id) + sumGroupPremium(state.proposedContracts, 'sickness', cl.id) + sumGroupPremium(state.proposedContracts, 'addons', cl.id);

                const rCur = ws2.addRow([cl.name, 'Stávající stav', pCurPrem, curS, curI3, curI21, curZO, curTN, curDaily, curPremCore, curPremAcc]);
                styleDataRow(rCur, 11, false, { 2: 'center', 3: 'right', 4: 'right', 5: 'right', 6: 'center', 7: 'right', 8: 'right', 9: 'center', 10: 'right', 11: 'right' });
                rCur.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                [3, 4, 5, 7, 8, 10, 11].forEach(col => { rCur.getCell(col).numFmt = FMT_CZK; });

                const rNew = ws2.addRow([cl.name, 'Návrh poradce', pNewPrem, newS, newI3, newI21, newZO, newTN, newDaily, newPremCore, newPremAcc]);
                styleDataRow(rNew, 11, true, { 2: 'center', 3: 'right', 4: 'right', 5: 'right', 6: 'center', 7: 'right', 8: 'right', 9: 'center', 10: 'right', 11: 'right' });
                rNew.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
                rNew.getCell(2).font = { name: FONT, size: 9, bold: true, color: { argb: 'FF075985' } };
                rNew.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
                [3, 4, 5, 7, 8, 10, 11].forEach(col => {
                    rNew.getCell(col).numFmt = FMT_CZK;
                    rNew.getCell(col).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
                });

                const rDif = ws2.addRow([
                    cl.name, 'Rozdíl (Δ)',
                    pNewPrem - pCurPrem, newS - curS, newI3 - curI3, '—', newZO - curZO, newTN - curTN,
                    cIdx === 0 ? 'Hlavní živitel rodiny' : (isChildPerson(cl) ? 'Dětský tarif' : 'Dospělá osoba'),
                    newPremCore - curPremCore, newPremAcc - curPremAcc
                ]);
                styleTotalRow(rDif, 11, { 2: 'center', 3: 'right', 4: 'right', 5: 'right', 6: 'center', 7: 'right', 8: 'right', 9: 'center', 10: 'right', 11: 'right' }, 'FFF1F5F9');
                [3, 4, 5, 7, 8, 10, 11].forEach(col => {
                    rDif.getCell(col).numFmt = FMT_CZK_DELTA;
                    applyDeltaStyle(rDif.getCell(col), num(rDif.getCell(col).value), col === 3);
                });
            });

            /* ════════════════════════════════════════════════════════════════
               LIST 3 & LIST 4: Detailní tabulky smluv (Stávající & Návrh)
               ════════════════════════════════════════════════════════════════ */
            /* Zvolíme všechny kategorie, které mají nenulovou hodnotu nebo patří mezi hlavní pilíře */
            const activeSheetCats = D.CATEGORIES.filter(c =>
                c.core ||
                sumItem(state.currentContracts, c.key) > 0 ||
                sumItem(state.proposedContracts, c.key) > 0
            );

            function buildContractsWorksheet(sheetTitle, tabColorArgb, contractsList, isProposed) {
                const ws = wb.addWorksheet(sheetTitle, {
                    properties: { tabColor: { argb: tabColorArgb } },
                    views: [{ state: 'frozen', xSplit: 3, ySplit: 4, showGridLines: true }],
                    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
                });

                const cols = [
                    { width: 20 }, // 1: Osoba
                    { width: 20 }, // 2: Pojišťovna
                    { width: 17 }, // 3: Č. smlouvy
                    { width: 14 }, // 4: Od–Do
                    { width: 15 }, // 5: Akce / Status
                    { width: 16 }, // 6: Měs. pojistné
                    { width: 13 }, // 7: Progrese TN
                    { width: 13 }  // 8: PN od dne
                ];
                activeSheetCats.forEach(() => cols.push({ width: 15 }));
                cols.push({ width: 38 }); // Poznámka
                ws.columns = cols;
                const totalCols = cols.length;

                addSheetBanner(
                    ws,
                    isProposed ? 'NOVÁ MODELACE POJIŠTĚNÍ DLE DOPORUČENÍ PORADCE — DETAIL SMLUV' : 'AUDIT STÁVAJÍCÍHO POJIŠTĚNÍ KLIENTA — DETAIL SMLUV',
                    isProposed ? 'Detailní rozpis ponechaných a nově sjednávaných smluv po jednotlivých rizicích' : 'Přehled současných pojistných smluv klienta, sjednaných pojistných částek a doporučených kroků',
                    totalCols
                );

                const headVals = [
                    'Pojištěná osoba', 'Pojišťovna', 'Číslo smlouvy', 'Od – Do',
                    isProposed ? 'Status v návrhu' : 'Doporučená akce',
                    'Měsíční pojistné', 'Progrese TN', 'PN od dne',
                    ...activeSheetCats.map(c => `${c.short}\n(${c.kind === 'daily' ? 'Kč/d' : c.kind === 'monthly' ? 'Kč/m' : 'Kč'})`),
                    'Zdůvodnění poradce / Poznámka'
                ];
                const hRow = ws.addRow(headVals);
                const alignMap = { 4: 'center', 5: 'center', 6: 'right', 7: 'center', 8: 'center' };
                activeSheetCats.forEach((_, i) => { alignMap[9 + i] = 'right'; });
                styleTableHeader(hRow, totalCols, alignMap);
                hRow.height = 28;

                const firstDataRow = ws.rowCount + 1;
                (contractsList || []).forEach((c, idx) => {
                    const cond = c.conditions || {};
                    const stKey = isProposed ? (c.proposalStatus || 'new') : (c.actionStatus || 'keep');
                    const stList = isProposed ? D.CONTRACT_ACTIONS.proposed : D.CONTRACT_ACTIONS.current;
                    const stMeta = (stList || []).find(a => a.key === stKey) || stList[0];

                    const rowVals = [
                        clientName(c.clientId),
                        c.insurer || '—',
                        c.contractNo || (isProposed ? 'Nová smlouva' : '—'),
                        `${c.start || '—'}–${c.end || 'neurč.'}`,
                        stMeta.short,
                        contractMonthlyPremium(c),
                        `${cond.tnProgression || (isProposed ? 800 : 100)} %`,
                        `${cond.pnFromDay || 29}. den${cond.pnRetroactive ? ' (zp.)' : ''}`,
                        ...activeSheetCats.map(cat => num(c.items && c.items[cat.key])),
                        c.actionReason || c.note || ''
                    ];
                    const r = ws.addRow(rowVals);
                    styleDataRow(r, totalCols, idx % 2 === 1, alignMap);
                    r.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                    applyStatusBadgeStyle(r.getCell(5), stKey);
                    r.getCell(6).numFmt = FMT_CZK;
                    r.getCell(6).font = { name: FONT, size: 9.5, bold: true, color: { argb: isProposed ? 'FF0369A1' : 'FF0F172A' } };

                    activeSheetCats.forEach((cat, i) => {
                        const cell = r.getCell(9 + i);
                        const val = num(c.items && c.items[cat.key]);
                        cell.numFmt = catFmt(cat, false);
                        if (val === 0) {
                            cell.font = { name: FONT, size: 9, color: { argb: 'FFCBD5E1' } };
                        } else if (isProposed) {
                            cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
                        }
                    });
                });

                const lastDataRow = ws.rowCount;
                const sumLabel = isProposed ? 'CELKEM NÁVRH PORADCE' : 'CELKEM STÁVAJÍCÍ PORTFOLIO';
                const totVals = [
                    sumLabel, `${(contractsList || []).length} smluv`, '', '', '',
                    lastDataRow >= firstDataRow
                        ? { formula: `SUM(F${firstDataRow}:F${lastDataRow})`, result: totalPremiumMonthly(contractsList) }
                        : totalPremiumMonthly(contractsList),
                    '', '',
                    ...activeSheetCats.map((cat, i) => {
                        const colLet = excelColName(9 + i);
                        const res = sumItem(contractsList, cat.key);
                        return lastDataRow >= firstDataRow
                            ? { formula: `SUM(${colLet}${firstDataRow}:${colLet}${lastDataRow})`, result: res }
                            : res;
                    }),
                    `Roční pojistné: ${fmtCZK(totalPremiumMonthly(contractsList) * 12)}/rok`
                ];
                const totRow = ws.addRow(totVals);
                styleTotalRow(totRow, totalCols, alignMap);
                totRow.getCell(6).numFmt = FMT_CZK;
                activeSheetCats.forEach((cat, i) => {
                    totRow.getCell(9 + i).numFmt = catFmt(cat, false);
                });

                /* Přidáme řádek součtu měsíčního pojistného za každou jednotlivou položku (Kč/měs) */
                const sumAllItemPrems = activeSheetCats.reduce((acc, cat) => acc + sumItemPremium(contractsList, cat.key), 0);
                const itemPremVals = [
                    '↳ Σ POJISTNÉ ZA POLOŽKU (Kč/měs)', 'Rozpad měsíčního pojistného dle rizik', '', '', '',
                    sumAllItemPrems, '', '',
                    ...activeSheetCats.map(cat => sumItemPremium(contractsList, cat.key)),
                    'Součet měsíčního pojistného hrazeného za jednotlivé druhy pojištění'
                ];
                const itemPremRow = ws.addRow(itemPremVals);
                styleDataRow(itemPremRow, totalCols, false, alignMap);
                itemPremRow.getCell(1).font = { name: FONT, size: 9, bold: true, color: { argb: 'FF92400E' } };
                itemPremRow.getCell(6).numFmt = FMT_MONTHLY;
                itemPremRow.getCell(6).font = { name: FONT, size: 9, bold: true, color: { argb: 'FFB45309' } };
                activeSheetCats.forEach((_, i) => {
                    const cell = itemPremRow.getCell(9 + i);
                    cell.numFmt = FMT_MONTHLY;
                    cell.font = { name: FONT, size: 9, bold: true, color: { argb: 'FFB45309' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
                });

                if (isProposed) {
                    /* Přidáme srovnávací řádek Stávající a Rozdíl přímo pod Návrh poradce */
                    const curCompareVals = [
                        'CELKEM STÁVAJÍCÍ STAV (pro srovnání)', `${(state.currentContracts || []).length} smluv`, '', '', '',
                        curM, '', '',
                        ...activeSheetCats.map(cat => sumItem(state.currentContracts, cat.key)),
                        `Ročně stávající: ${fmtCZK(curM * 12)}/rok`
                    ];
                    const curRow = ws.addRow(curCompareVals);
                    styleDataRow(curRow, totalCols, false, alignMap);
                    curRow.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF475569' } };
                    curRow.getCell(6).numFmt = FMT_CZK;
                    activeSheetCats.forEach((cat, i) => {
                        curRow.getCell(9 + i).numFmt = catFmt(cat, false);
                    });

                    const diffCompareVals = [
                        'ROZDÍL (NÁVRH PORADCE − STÁVAJÍCÍ)', '', '', '', '',
                        diffM, '', '',
                        ...activeSheetCats.map(cat => sumItem(state.proposedContracts, cat.key) - sumItem(state.currentContracts, cat.key)),
                        diffM <= 0 ? 'Úspora měsíčního pojistného' : 'Navýšení pojistné ochrany rodiny'
                    ];
                    const difRow = ws.addRow(diffCompareVals);
                    styleTotalRow(difRow, totalCols, alignMap, 'FFF0FDF4');
                    difRow.getCell(6).numFmt = FMT_CZK_DELTA;
                    applyDeltaStyle(difRow.getCell(6), diffM, true);
                    activeSheetCats.forEach((cat, i) => {
                        const cell = difRow.getCell(9 + i);
                        const dv = sumItem(state.proposedContracts, cat.key) - sumItem(state.currentContracts, cat.key);
                        cell.numFmt = catFmt(cat, true);
                        applyDeltaStyle(cell, dv, false);
                    });
                }
            }

            buildContractsWorksheet('3. Stávající smlouvy', 'FFD97706', state.currentContracts, false);
            buildContractsWorksheet('4. Návrh poradce', 'FF2563EB', state.proposedContracts, true);

            /* ════════════════════════════════════════════════════════════════
               LIST 5: 5. Kalkulačka potřeb & Scénář
               ════════════════════════════════════════════════════════════════ */
            const ws5 = wb.addWorksheet('5. Kalkulačka potřeb & Scénář', {
                properties: { tabColor: { argb: 'FF7C3AED' } },
                views: [{ state: 'frozen', ySplit: 2, showGridLines: true }],
                pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
            });
            ws5.columns = [
                { width: 24 }, { width: 28 }, { width: 18 }, { width: 18 },
                { width: 18 }, { width: 18 }, { width: 18 }, { width: 36 }
            ];
            addSheetBanner(ws5, 'KALKULAČKA POTŘEBNÉHO KRYTÍ (ČSSZ 2026), PROGRESE TN A MODELOVÝ SCÉNÁŘ', 'Výpočet propadu příjmu v pracovní neschopnosti a invaliditě, simulace progrese TN a daňové odpočty', 8);

            addSectionBar(ws5, '1. ANALÝZA POTŘEBNÉHO KRYTÍ DLE PŘÍJMŮ A ZÁVAZKŮ (METODIKA ČSSZ 2026)', 8, 'FF6D28D9');
            const needsHead = ws5.addRow([
                'Posuzovaná osoba', 'Riziko / Oblast zajištění', 'Doporučené minimum',
                'Stávající krytí', 'Návrh poradce', 'Chybí ve stávajícím', 'Stav v návrhu poradce', 'Metodika výpočtu (2026)'
            ]);
            styleTableHeader(needsHead, 8, { 3: 'right', 4: 'right', 5: 'right', 6: 'right', 7: 'center' });

            let nRowIdx = 0;
            (state.clients || []).filter(c => !isChildPerson(c)).forEach(person => {
                const netInc = D.computeNetIncome(person.incomeGross, person.isEntrepreneur);
                const sick = D.computeExactSickLeave(person.incomeGross, person.isEntrepreneur, 60);
                const pens = D.computeStateDisabilityPension(person.incomeGross, person.isEntrepreneur, person.birthYear);
                const inv3Pen = pens.inv3 || 0;
                const personLoans = (state.loans || []).filter(l => !l.linkedClientId || l.linkedClientId === person.id).reduce((s, l) => s + num(l.amount), 0) || loansTotal;

                const recSmrt = Math.round((personLoans + Math.max(0, netInc * 36 - num(person.reserveCash))) / 50000) * 50000;
                const gapInv3 = Math.max(0, netInc - inv3Pen);
                const recInv3 = Math.round((gapInv3 * 12 * 10 + personLoans * 0.5) / 50000) * 50000;
                const recZO   = Math.round((netInc * 24) / 50000) * 50000;
                const recTN   = Math.round(Math.max(1000000, netInc * 30) / 50000) * 50000;
                const recPN   = Math.ceil(Math.max(0, netInc - sick.monthlyAvg) / 30 / 50) * 50;

                const curS = sumItemFor(state.currentContracts, person.id, 'smrt') + sumItemFor(state.currentContracts, person.id, 'smrtKles');
                const newS = sumItemFor(state.proposedContracts, person.id, 'smrt') + sumItemFor(state.proposedContracts, person.id, 'smrtKles');
                const curI = sumItemFor(state.currentContracts, person.id, 'invalidita') + sumItemFor(state.currentContracts, person.id, 'invKles');
                const newI = sumItemFor(state.proposedContracts, person.id, 'invalidita') + sumItemFor(state.proposedContracts, person.id, 'invKles');
                const curZ = sumItemFor(state.currentContracts, person.id, 'zavOn') + sumItemFor(state.currentContracts, person.id, 'zavOnKles') + sumItemFor(state.currentContracts, person.id, 'zavOnMuzZena');
                const newZ = sumItemFor(state.proposedContracts, person.id, 'zavOn') + sumItemFor(state.proposedContracts, person.id, 'zavOnKles') + sumItemFor(state.proposedContracts, person.id, 'zavOnMuzZena');
                const curT = sumItemFor(state.currentContracts, person.id, 'tnUraz') + sumItemFor(state.currentContracts, person.id, 'tnUraz10');
                const newT = sumItemFor(state.proposedContracts, person.id, 'tnUraz') + sumItemFor(state.proposedContracts, person.id, 'tnUraz10');
                const curP = sumItemFor(state.currentContracts, person.id, 'pn15') + sumItemFor(state.currentContracts, person.id, 'pn28') + sumItemFor(state.currentContracts, person.id, 'pn61');
                const newP = sumItemFor(state.proposedContracts, person.id, 'pn15') + sumItemFor(state.proposedContracts, person.id, 'pn28') + sumItemFor(state.proposedContracts, person.id, 'pn61');

                const items = [
                    { label: 'Smrt (zajištění úvěrů a rodiny)', rec: recSmrt, cur: curS, nw: newS, fmt: FMT_CZK, note: `Úvěry (${fmtCZK(personLoans)}) + 3 roky čistého příjmu − rezerva` },
                    { label: 'Invalidita III. stupně', rec: recInv3, cur: curI, nw: newI, fmt: FMT_CZK, note: `Měsíční propad příjmu ${fmtCZK(gapInv3)}/měs × 10 let + 50 % úvěrů` },
                    { label: 'Závažná onemocnění (ZO)', rec: recZO, cur: curZ, nw: newZ, fmt: FMT_CZK, note: `24× čistý měsíční příjem (${fmtCZK(netInc)}) na léčbu a rekonvalescenci` },
                    { label: 'Trvalé následky úrazu (základ)', rec: recTN, cur: curT, nw: newT, fmt: FMT_CZK, note: 'Základní PČ před započtením progrese až 800–1000 %' },
                    { label: 'Pracovní neschopnost (Kč/den)', rec: recPN, cur: curP, nw: newP, fmt: FMT_DAILY, note: `Denní propad příjmu v PN (čistý příjem − nemocenská ${fmtCZK(sick.monthlyAvg)})` }
                ];

                items.forEach(it => {
                    const gapCur = Math.max(0, it.rec - it.cur);
                    const okNew = it.nw >= it.rec * 0.85;
                    const r = ws5.addRow([
                        person.name, it.label, it.rec, it.cur, it.nw, -gapCur,
                        okNew ? '✓ Kryto v návrhu' : 'Částečné krytí',
                        it.note
                    ]);
                    styleDataRow(r, 8, nRowIdx++ % 2 === 1, { 3: 'right', 4: 'right', 5: 'right', 6: 'right', 7: 'center' });
                    r.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                    [3, 4, 5, 6].forEach(col => { r.getCell(col).numFmt = it.fmt; });
                    r.getCell(5).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
                    if (gapCur > 0) applyDeltaStyle(r.getCell(6), -gapCur, false);
                    applyDeltaStyle(r.getCell(7), okNew ? 1 : -1, false);
                });
            });

            ws5.addRow([]).height = 10;

            /* Sekce 5B: Simulátor progrese TN */
            addSectionBar(ws5, '2. SIMULÁTOR PROGRESE TRVALÝCH NÁSLEDKŮ ÚRAZU (SROVNÁNÍ VÝPLATY PLNĚNÍ)', 8, 'FF0369A1');
            const tnHead = ws5.addRow([
                'Pojištěná osoba', 'Varianta a progrese', 'Základní PČ TN',
                'Při 10 % poškození', 'Při 25 % poškození', 'Při 50 % poškození', 'Při 75 % poškození', 'Při 100 % poškození (max.)'
            ]);
            styleTableHeader(tnHead, 8, { 3: 'right', 4: 'right', 5: 'right', 6: 'right', 7: 'right', 8: 'right' });

            let tnIdx = 0;
            (state.clients || []).forEach(person => {
                const curBase = sumItemFor(state.currentContracts, person.id, 'tnUraz') + sumItemFor(state.currentContracts, person.id, 'tnUraz10');
                const newBase = sumItemFor(state.proposedContracts, person.id, 'tnUraz') + sumItemFor(state.proposedContracts, person.id, 'tnUraz10');
                const pCurC = (state.currentContracts || []).filter(c => c.clientId === person.id);
                const pNewC = (state.proposedContracts || []).filter(c => c.clientId === person.id);
                const curProg = pCurC.length ? Math.max(...pCurC.map(c => num(c.conditions && c.conditions.tnProgression) || 400)) : 400;
                const newProg = pNewC.length ? Math.max(...pNewC.map(c => num(c.conditions && c.conditions.tnProgression) || 800)) : 800;

                const pcts = [10, 25, 50, 75, 100];
                const rC = ws5.addRow([
                    person.name, `Stávající (${curProg} %)`, curBase,
                    ...pcts.map(p => Math.round(curBase * D.computeTnProgressionMultiplier(p, curProg)))
                ]);
                styleDataRow(rC, 8, tnIdx++ % 2 === 1, { 3: 'right', 4: 'right', 5: 'right', 6: 'right', 7: 'right', 8: 'right' });
                [3, 4, 5, 6, 7, 8].forEach(col => { rC.getCell(col).numFmt = FMT_CZK; });

                const rN = ws5.addRow([
                    person.name, `Návrh poradce (${newProg} %)`, newBase,
                    ...pcts.map(p => Math.round(newBase * D.computeTnProgressionMultiplier(p, newProg)))
                ]);
                styleDataRow(rN, 8, tnIdx++ % 2 === 1, { 3: 'right', 4: 'right', 5: 'right', 6: 'right', 7: 'right', 8: 'right' });
                rN.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
                rN.getCell(2).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF075985' } };
                [3, 4, 5, 6, 7, 8].forEach(col => {
                    rN.getCell(col).numFmt = FMT_CZK;
                    rN.getCell(col).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
                });
            });

            /* ════════════════════════════════════════════════════════════════
               LIST 6: 6. Závazky & Úvěry
               ════════════════════════════════════════════════════════════════ */
            const ws6 = wb.addWorksheet('6. Závazky & Úvěry', {
                properties: { tabColor: { argb: 'FF0D9488' } },
                views: [{ state: 'frozen', ySplit: 4, showGridLines: true }],
                pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
            });
            ws6.columns = [
                { width: 32 }, { width: 22 }, { width: 20 }, { width: 18 },
                { width: 14 }, { width: 16 }, { width: 20 }, { width: 34 }
            ];
            addSheetBanner(ws6, 'PŘEHLED ÚVĚRŮ, HYPOTÉK A JEJICH ZAJIŠTĚNÍ ŽIVOTNÍM POJIŠTĚNÍM', 'Audit finančních závazků rodiny a kontrola dostatečnosti pojistných částek na smrt a invaliditu', 8);

            const lHead = ws6.addRow([
                'Název závazku / úvěru', 'Dlužník / Osoba', 'Nesplacená jistina',
                'Měsíční splátka', 'Úrok (% p.a.)', 'Zbývá splácet (let)', 'Celkem k doplacení', 'Zajištění v návrhu poradce'
            ]);
            styleTableHeader(lHead, 8, { 3: 'right', 4: 'right', 5: 'right', 6: 'center', 7: 'right' });

            const firstLoanRow = ws6.rowCount + 1;
            (state.loans || []).forEach((l, idx) => {
                const totalPay = num(l.monthlyPayment) * 12 * num(l.remainingYears);
                const r = ws6.addRow([
                    l.name || 'Úvěr',
                    l.linkedClientId ? clientName(l.linkedClientId) : 'Společný závazek rodiny',
                    num(l.amount),
                    num(l.monthlyPayment),
                    num(l.interestRate) / 100,
                    num(l.remainingYears),
                    totalPay || num(l.amount),
                    newSmrt >= loansTotal ? '✓ Plně kryto v návrhu poradce' : '⚠ Částečně kryto'
                ]);
                styleDataRow(r, 8, idx % 2 === 1, { 3: 'right', 4: 'right', 5: 'right', 6: 'center', 7: 'right' });
                r.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                r.getCell(3).numFmt = FMT_CZK;
                r.getCell(4).numFmt = FMT_CZK;
                r.getCell(5).numFmt = '0.00 %';
                r.getCell(7).numFmt = FMT_CZK;
                applyDeltaStyle(r.getCell(8), newSmrt >= loansTotal ? 1 : -1, false);
            });

            const lastLoanRow = ws6.rowCount;
            const totMonthlyLoans = (state.loans || []).reduce((s, l) => s + num(l.monthlyPayment), 0);
            const totLoanRow = ws6.addRow([
                'CELKEM ZÁVAZKY RODINY', `${(state.loans || []).length} úvěrů`,
                lastLoanRow >= firstLoanRow ? { formula: `SUM(C${firstLoanRow}:C${lastLoanRow})`, result: loansTotal } : loansTotal,
                lastLoanRow >= firstLoanRow ? { formula: `SUM(D${firstLoanRow}:D${lastLoanRow})`, result: totMonthlyLoans } : totMonthlyLoans,
                '', '',
                lastLoanRow >= firstLoanRow ? { formula: `SUM(G${firstLoanRow}:G${lastLoanRow})`, result: 0 } : 0,
                `Smrt Stávající: ${fmtCZK(curSmrt)} → Návrh: ${fmtCZK(newSmrt)}`
            ]);
            styleTotalRow(totLoanRow, 8, { 3: 'right', 4: 'right', 5: 'right', 6: 'center', 7: 'right' });
            totLoanRow.getCell(3).numFmt = FMT_CZK;
            totLoanRow.getCell(4).numFmt = FMT_CZK;
            totLoanRow.getCell(7).numFmt = FMT_CZK;

            /* ── Zápis do binárního bufferu a stažení .xlsx ── */
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = buildExportFilename('xlsx');
            a.click();
            URL.revokeObjectURL(url);
            toast('Excel (.xlsx) se 6 listy byl úspěšně vygenerován', 'success');
        } catch (err) {
            console.error('XLSX export error:', err);
            toast('Chyba při exportu do Excelu: ' + err.message, 'error');
        }
    }
    function importData(ev) {
        const file = ev.target.files[0];
        if (!file) return;
        const r = new FileReader();
        r.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.clients) throw new Error('Soubor neobsahuje platná data.');
                if (!confirm('Importovat data ze souboru? Aktuální stav bude přepsán.')) return;
                normalizeLoadedState(data);
                save();
                renderAll();
                toast('Import úspěšný', 'success');
            } catch (e) { toast('Chyba importu: ' + e.message, 'error'); }
        };
        r.readAsText(file);
        ev.target.value = '';
    }
    function resetData() {
        if (!confirm('Opravdu smazat VŠECHNA data a začít s čistým štítem?')) return;
        state = defaultState();
        save();
        renderAll();
        toast('Data vymazána', 'info');
    }
    function saveAdviserBrief() {
        const b = document.getElementById('adviserBrief');
        const r = document.getElementById('advisorRecommendation');
        if (b) state.adviserBrief = b.value;
        if (r) state.advisorRecommendation = r.value;
        save();
    }
    function refreshClientSelectors() {
        renderContractsGroup('current');
        renderContractsGroup('proposed');
        renderLoans();
    }
    function openPrint() {
        save();
        window.open('soubory/tisk.html', '_blank');
    }

    /* ════════════ MASTER RENDER & INIT ════════════ */
    function renderAll() {
        renderKPIs();
        renderClients();
        renderContractsGroup('current');
        renderContractsGroup('proposed');
        renderLoans();
        refreshScenarioPersons();
        refreshCompareFilter();
        refreshNeedsPersonSelect();
        const b = document.getElementById('adviserBrief');
        const r = document.getElementById('advisorRecommendation');
        if (b) b.value = state.adviserBrief || '';
        if (r) r.value = state.advisorRecommendation || '';
        if (window.lucide) lucide.createIcons();
    }

    function init() {
        applyStoredTheme();
        load();
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.addEventListener('click', () => switchTab(b.dataset.tab));
        });
        const aiType = document.getElementById('aiTaskType');
        if (aiType) {
            aiType.addEventListener('change', function () {
                document.getElementById('aiCustomQuestion').classList.toggle('hidden', this.value !== 'custom');
            });
        }
        if (state.scenario) {
            const s = state.scenario;
            const setIf = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
            const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
            setIf('scenarioPnDays', s.pnDays);
            setIf('scenarioHospDays', s.hospDays);
            setIf('scenarioOcrDays', s.ocrDays);
            setIf('scenarioInjury', s.injury);
            setIf('scenarioTnPct', s.tnDamagePct);
            setChk('scenarioRetroactive', s.retroactive);
            setChk('scenarioCriticalIllness', s.includeCriticalIllness);
            setChk('scenarioDisability3', s.includeDisability3);
        }
        renderAll();
        renderLegal();
        renderSettings();
        /* Drag & Drop podpora pro nahrání smlouvy */
        const dz = document.getElementById('docDropZone');
        if (dz) {
            ['dragenter', 'dragover'].forEach(evName => {
                dz.addEventListener(evName, e => { e.preventDefault(); e.stopPropagation(); dz.classList.add('border-emerald-400'); });
            });
            ['dragleave', 'drop'].forEach(evName => {
                dz.addEventListener(evName, e => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('border-emerald-400'); });
            });
            dz.addEventListener('drop', e => {
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
                    handleContractFileSelect({ dataTransfer: e.dataTransfer });
                }
            });
        }
        if (window.lucide) lucide.createIcons();
    }

    /* ════════════ EXPOSE ════════════ */
    window.app = {
        addClient, updateClient, removeClient,
        setTableColMode,
        addContract, removeContract, duplicateContract, copyFromCurrent, copyKeptFromCurrent, updateContractAction,
        editContract, closeContractModal, saveContractModal, applyInsurerDefaults, copyInv3ToAll,
        recalcModalItemPremiums, syncTotalPremiumFromItems, distributeTotalPremiumToItems,
        openDocUploadModal, closeDocUploadModal, handleContractFileSelect, handleInlineModalFileUpload,
        reparseDocRawText, refineDocWithAi, applyExtractedContractToForm, updateExtractedClient, parseCzechPolicyText,
        updateExtractedRowVal, updateExtractedRowCategory, removeExtractedRow, addExtractedRowManual,
        syncExtractedTotalFromItems, syncExtractedRowsToParsed,
        updateModalInsurerBadges, applyMortgageComboInModal, setPnModalUnit,
        renderNeedsAnalysis, applyNeedsToProposal, updateTaxSim,
        addLoan, updateLoan, removeLoan,
        applyScenarioPreset, renderScenario, renderTnProgressionSim,
        renderComparison,
        bulkImport, closeBulkModal, runBulkParse,
        runAiAnalysis, openAiPanel,
        loadSampleData, exportData, exportXlsx, importData, resetData,
        openPrint, saveAdviserBrief, saveSettings, savePrintBranding, setTheme
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
