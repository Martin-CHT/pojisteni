/* ════════════════════════════════════════════════════════════════════
   insurance-app.js
   Hlavní logika aplikace „Srovnání pojištění".

   Datový model (localStorage klíč: 'insurance_compare_data'):
   {
     clients:           [ { id, name, incomeGross, isEntrepreneur, birthYear } ],
     currentContracts:  [ Contract ],
     proposedContracts: [ Contract ],
     loans:             [ { id, name, amount, linkedClientId } ],
     scenario:          { person, pnDays, hospDays, injury, retroactive },
     adviserBrief:      string
   }
   Contract = {
     id, clientId, insurer, contractNo, start, end, premium,
     items: { smrt, smrtUraz, invalidita, zavOn, tnUraz, tnUraz10,
              uraz, urazVelky, hosp, hospUraz, pn28, pn61, chir },
     conditions: { pnWaitingDays, pnRetroactive, hospWaitingDays, ... },
     note
   }
   ════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    const STORAGE_KEY = 'insurance_compare_data';
    const D = window.INSURANCE_DATA;

    /* ════════════ HELPERS ════════════ */
    function uid()        { return 'x' + Math.random().toString(36).slice(2, 10); }
    function clone(o)     { return JSON.parse(JSON.stringify(o)); }
    function num(v)       { v = parseFloat(v); return isNaN(v) ? 0 : v; }
    function fmtCZK(n) {
        n = num(n);
        return n.toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
    }
    function fmtCZKShort(n) {
        n = num(n);
        if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(2).replace(/\.?0+$/, '') + ' mil. Kč';
        if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(0) + ' tis. Kč';
        return n.toFixed(0) + ' Kč';
    }
    function fmtPct(n) { return (n*100).toFixed(0) + ' %'; }
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g,
            c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function toast(msg, type) {
        const div = document.createElement('div');
        div.className = 'toast toast-' + (type || 'info');
        div.textContent = msg;
        document.getElementById('toastContainer').appendChild(div);
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

    /* ════════════ DATA STORE ════════════ */
    const emptyContract = (clientId) => ({
        id: uid(), clientId: clientId || '', insurer: '', contractNo: '',
        start: null, end: null, premium: 0,
        items: Object.fromEntries(D.CATEGORIES.map(c => [c.key, 0])),
        conditions: {
            pnWaitingDays: 29, pnRetroactive: false, pnFromDay: 29,
            hospWaitingDays: 0, criticalIllnessWaitingMonths: 3,
            occupationCategory: '', paymentFrequency: 'monthly'
        },
        note: ''
    });
    const DEFAULT_LOGO_URL = 'https://martin-cht.github.io/pojisteni/soubory/logo.png';
    function defaultState() {
        return { clients: [], currentContracts: [], proposedContracts: [],
                 loans: [], scenario: { person: '', pnDays: 90, hospDays: 5, injury: 'minor', retroactive: false },
                 adviserBrief: '',
                 advisorName: getCookie('insurance_advisor_name') || '',
                 logoUrl: getCookie('insurance_logo_url') || DEFAULT_LOGO_URL };
    }

    let state = defaultState();

    function load() {
        try {
            const raw = lsGet(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                /* Doplnění chybějících klíčů */
                state = Object.assign(defaultState(), parsed);
                state.scenario = Object.assign({ person: '', pnDays: 90, hospDays: 5, injury: 'minor', retroactive: false }, parsed.scenario || {});
                /* Pokud stará data nemají logoUrl, nastavíme default. */
                if (!state.logoUrl || !state.logoUrl.trim()) {
                    state.logoUrl = getCookie('insurance_logo_url') || DEFAULT_LOGO_URL;
                }
                /* Pokud stará data nemají advisorName, ale je v cookies, načteme. */
                if (!state.advisorName || !state.advisorName.trim()) {
                    state.advisorName = getCookie('insurance_advisor_name') || '';
                }
                /* Doplnění items pro starší smlouvy */
                ['currentContracts','proposedContracts'].forEach(k => {
                    (state[k] || []).forEach(c => {
                        c.items = c.items || {};
                        D.CATEGORIES.forEach(cat => { if (c.items[cat.key] == null) c.items[cat.key] = 0; });
                        c.conditions = c.conditions || { pnWaitingDays: 29, pnRetroactive: false };
                    });
                });
            } else {
                /* První spuštění — předvyplníme ukázkou z Excelu */
                if (confirm('Načíst ukázková data z Vzor-2024.xlsm (rodina Hozna/Martina/Vilém/Tobiáš)? Můžete je následně přepsat či smazat.')) {
                    state = clone(D.SAMPLE_DATA);
                }
            }
        } catch (e) {
            console.warn('Load error:', e);
            state = defaultState();
        }
    }
    function save() {
        try { lsSet(STORAGE_KEY, JSON.stringify(state)); } catch (e) { toast('Chyba ukládání: ' + e.message, 'error'); }
        updateStoragePreview();
    }

    /* ════════════ TABS ════════════ */
    function switchTab(name) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('tab-active', b.dataset.tab === name));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('hidden', p.id !== 'pane-' + name));
        if (name === 'srovnani')  renderComparison();
        if (name === 'scenar')    renderScenario();
        if (name === 'pravo')     renderLegal();
        if (name === 'nastaveni') renderSettings();
        if (name === 'ai')        renderAiPanel();
    }

    /* ════════════ KPI ════════════ */
    function totalPremiumMonthly(list) {
        let total = 0;
        (list || []).forEach(c => {
            const p = num(c.premium);
            const f = c.conditions && c.conditions.paymentFrequency;
            if (f === 'yearly') total += p / 12;
            else if (f === 'quarterly') total += p / 3;
            else if (f === 'singlepay') total += 0;
            else total += p; /* monthly */
        });
        return total;
    }
    function totalPremiumYearly(list) { return totalPremiumMonthly(list) * 12; }

    function sumItem(list, key) {
        return (list || []).reduce((s, c) => s + num(c.items && c.items[key]), 0);
    }
    function sumItemFor(list, clientId, key) {
        return (list || []).filter(c => c.clientId === clientId).reduce((s, c) => s + num(c.items && c.items[key]), 0);
    }
    function sumLoans() { return state.loans.reduce((s, l) => s + num(l.amount), 0); }

    function renderKPIs() {
        const curM = totalPremiumMonthly(state.currentContracts);
        const newM = totalPremiumMonthly(state.proposedContracts);
        document.getElementById('kpiCurrentYearly').textContent  = fmtCZK(curM * 12);
        document.getElementById('kpiCurrentMonthly').textContent = fmtCZK(curM) + ' / měs';
        document.getElementById('kpiProposedYearly').textContent  = fmtCZK(newM * 12);
        document.getElementById('kpiProposedMonthly').textContent = fmtCZK(newM) + ' / měs';
        const diff = newM - curM;
        const diffEl = document.getElementById('kpiDiffMonthly');
        diffEl.textContent = (diff >= 0 ? '+' : '') + fmtCZK(diff);
        diffEl.className = 'stat-value ' + (diff > 0 ? 'text-rose-300' : diff < 0 ? 'text-emerald-300' : 'text-slate-300');
        const pct = curM > 0 ? (diff / curM * 100) : (newM > 0 ? 100 : 0);
        document.getElementById('kpiDiffPct').textContent = (pct >= 0 ? '+' : '') + pct.toFixed(0) + ' %';

        /* Podpojištění (smrt vs. závazky pro hlavního klienta = první, nebo specifikovaný) */
        const loanTotal = sumLoans();
        const newSmrt = sumItem(state.proposedContracts, 'smrt');
        const under = Math.max(0, loanTotal - newSmrt);
        document.getElementById('kpiUnderinsured').textContent = fmtCZKShort(under);
        document.getElementById('kpiUnderinsuredLabel').textContent =
            under > 0 ? 'Chybí krytí závazků' : (loanTotal > 0 ? 'Plně kryto návrhem' : 'Nezadané závazky');

        /* Pokryté kategorie */
        const covCurr = D.CATEGORIES.filter(c => sumItem(state.currentContracts, c.key) > 0).length;
        const covNew  = D.CATEGORIES.filter(c => sumItem(state.proposedContracts, c.key) > 0).length;
        document.getElementById('kpiCategoriesCovered').textContent = covCurr + ' → ' + covNew + ' / ' + D.CATEGORIES.length;
        document.getElementById('kpiCategoriesCoveredLabel').textContent = 'stáv. → návrh';

        /* Klienti / smlouvy */
        document.getElementById('kpiClientCount').textContent = state.clients.length;
        document.getElementById('kpiContractCount').textContent =
            (state.currentContracts.length + state.proposedContracts.length) + ' smluv (stáv.+ návrh)';

        /* Top nav stats */
        document.getElementById('navClients').textContent = state.clients.length;
        document.getElementById('navCurrentCount').textContent = state.currentContracts.length;
        document.getElementById('navProposedCount').textContent = state.proposedContracts.length;
        document.getElementById('navDiff').textContent = (diff >= 0 ? '+' : '') + fmtCZK(diff);
    }

    /* ════════════ CLIENTS ════════════ */
    function renderClients() {
        const container = document.getElementById('clientsList');
        if (!state.clients.length) {
            container.innerHTML = `<div class="text-xs text-slate-500 italic text-center py-8 border border-dashed border-slate-800 rounded">
                Žádní klienti — přidejte první osobu tlačítkem nahoře.
            </div>`;
            return;
        }
        container.innerHTML = state.clients.map(c => `
            <div class="client-card">
                <div class="grid grid-cols-1 lg:grid-cols-5 gap-3 items-end">
                    <label class="block lg:col-span-2">
                        <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Jméno</span>
                        <input type="text" class="pro-input" value="${escapeHtml(c.name)}"
                            onchange="app.updateClient('${c.id}', 'name', this.value)">
                    </label>
                    <label class="block">
                        <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Rok narození</span>
                        <input type="number" class="pro-input" value="${c.birthYear || ''}" min="1900" max="2100"
                            onchange="app.updateClient('${c.id}', 'birthYear', this.value)">
                    </label>
                    <label class="block">
                        <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Hrubý příjem / měs (Kč)</span>
                        <input type="number" class="pro-input" value="${c.incomeGross || 0}" min="0" step="1000"
                            onchange="app.updateClient('${c.id}', 'incomeGross', this.value)">
                    </label>
                    <div class="flex items-end gap-2">
                        <label class="flex items-center gap-2 text-xs text-slate-300 grow">
                            <input type="checkbox" class="pro-input" ${c.isEntrepreneur ? 'checked' : ''}
                                onchange="app.updateClient('${c.id}', 'isEntrepreneur', this.checked)">
                            <span>OSVČ / podnikatel</span>
                        </label>
                        <button onclick="app.removeClient('${c.id}')" class="btn-danger" title="Smazat osobu">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </div>
                <div class="text-[11px] text-slate-500 mt-2 flex flex-wrap gap-3">
                    <span>Stáv. smluv: <strong class="text-slate-300">${state.currentContracts.filter(s => s.clientId === c.id).length}</strong></span>
                    <span>Návrh: <strong class="text-slate-300">${state.proposedContracts.filter(s => s.clientId === c.id).length}</strong></span>
                    <span>Sazba NČSSZ: <strong class="text-slate-300">${(D.sickLeaveRate(c.incomeGross) * 100).toFixed(0)} %</strong></span>
                </div>
            </div>
        `).join('');
        if (window.lucide) lucide.createIcons();
    }
    function addClient() {
        const c = { id: uid(), name: 'Nová osoba ' + (state.clients.length + 1), incomeGross: 0, isEntrepreneur: false, birthYear: null };
        state.clients.push(c);
        save(); renderAll();
        toast('Osoba přidána', 'success');
    }
    function updateClient(id, field, value) {
        const c = state.clients.find(c => c.id === id);
        if (!c) return;
        if (field === 'incomeGross' || field === 'birthYear') value = num(value);
        c[field] = value;
        save();
        renderKPIs(); refreshScenarioPersons(); refreshCompareFilter(); refreshClientSelectors();
    }
    function removeClient(id) {
        if (!confirm('Smazat tuto osobu a všechny její smlouvy?')) return;
        state.clients = state.clients.filter(c => c.id !== id);
        state.currentContracts  = state.currentContracts.filter(s => s.clientId !== id);
        state.proposedContracts = state.proposedContracts.filter(s => s.clientId !== id);
        state.loans = state.loans.filter(l => l.linkedClientId !== id);
        save(); renderAll();
    }

    /* ════════════ CONTRACTS (rendering as grouped by client) ════════════ */
    function clientName(id) {
        const c = state.clients.find(c => c.id === id);
        return c ? c.name : '(bez klienta)';
    }
    function renderContractsGroup(which) {
        const container = document.getElementById(which === 'current' ? 'currentContractsContainer' : 'proposedContractsContainer');
        const list = which === 'current' ? state.currentContracts : state.proposedContracts;
        const accent = which === 'current' ? 'emerald' : 'sky';

        if (!state.clients.length) {
            container.innerHTML = `<div class="text-xs text-slate-500 italic text-center py-8 border border-dashed border-slate-800 rounded">
                Nejprve přidejte alespoň jednu osobu v záložce <strong>Klient & Rodina</strong>.
            </div>`;
            return;
        }

        const groups = {};
        state.clients.forEach(c => groups[c.id] = []);
        groups['_none'] = [];
        list.forEach(c => { (groups[c.clientId] || groups['_none']).push(c); });

        const blocks = state.clients.map(person => {
            const items = groups[person.id] || [];
            const sums = D.CATEGORIES.map(cat => sumItemFor(list, person.id, cat.key));
            const personPremium = items.reduce((s, c) => {
                const f = c.conditions && c.conditions.paymentFrequency;
                const p = num(c.premium);
                if (f === 'yearly') return s + p / 12;
                if (f === 'quarterly') return s + p / 3;
                if (f === 'singlepay') return s;
                return s + p;
            }, 0);
            return `
                <div class="contract-block">
                    <div class="contract-block-header">
                        <div class="flex items-center gap-2">
                            <span class="badge badge-${accent}">${escapeHtml(person.name)}</span>
                            <span class="text-[10px] text-slate-500 font-mono">${items.length} sml.</span>
                        </div>
                        <div class="text-[11px] text-slate-300 font-mono">
                            Σ měs: <strong class="text-${accent}-300">${fmtCZK(personPremium)}</strong>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Smlouva</th>
                                    ${D.CATEGORIES.map(c => `<th title="${escapeHtml(c.label)} — ${escapeHtml(c.help)}" class="num">${escapeHtml(c.mini)}</th>`).join('')}
                                    <th class="num">Pl./měs</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${items.map(c => renderContractRow(c, which)).join('')}
                                ${!items.length ? `<tr><td colspan="${D.CATEGORIES.length + 3}" class="text-center text-[10px] text-slate-500 italic py-2">Žádné smlouvy.</td></tr>` : ''}
                            </tbody>
                            ${items.length ? `<tfoot>
                                <tr>
                                    <td>Σ</td>
                                    ${sums.map((v, i) => `<td class="${v ? '' : 'dash'}">${v ? fmtCZKShort(v) : '·'}</td>`).join('')}
                                    <td>${fmtCZK(personPremium)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>` : ''}
                        </table>
                    </div>
                </div>`;
        });

        if (groups['_none'].length) {
            blocks.push(`
                <div class="contract-block">
                    <div class="contract-block-header">
                        <span class="badge badge-slate">Nepřiřazené smlouvy</span>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Smlouva</th>
                                    ${D.CATEGORIES.map(c => `<th title="${escapeHtml(c.label)}" class="num">${escapeHtml(c.mini)}</th>`).join('')}
                                    <th class="num">Pl./měs</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>${groups['_none'].map(c => renderContractRow(c, which)).join('')}</tbody>
                        </table>
                    </div>
                </div>`);
        }

        container.innerHTML = blocks.join('');
        if (window.lucide) lucide.createIcons();
    }

    function renderContractRow(c, which) {
        return `<tr>
            <td>
                <div class="flex flex-col leading-tight">
                    <span class="text-[10.5px] font-semibold text-slate-200">${escapeHtml(c.insurer || '—')}</span>
                    <span class="text-[9px] text-slate-500 font-mono">${escapeHtml(c.contractNo || '—')}${c.start || c.end ? ` · ${c.start || '?'}–${c.end || '?'}` : ''}</span>
                    ${c.note ? `<span class="text-[9px] text-amber-400/80 italic">${escapeHtml(c.note)}</span>` : ''}
                </div>
            </td>
            ${D.CATEGORIES.map(cat => {
                const v = num(c.items && c.items[cat.key]);
                if (!v) return `<td class="dash">·</td>`;
                return `<td class="num">${cat.kind === 'daily' ? v + '/d' : fmtCZKShort(v)}</td>`;
            }).join('')}
            <td class="num">${fmtCZK(c.premium || 0)}</td>
            <td>
                <div class="flex gap-0.5">
                    <button onclick="app.editContract('${which}','${c.id}')" class="btn-secondary" title="Upravit">
                        <i data-lucide="edit-2" class="w-3 h-3"></i>
                    </button>
                    <button onclick="app.duplicateContract('${which}','${c.id}')" class="btn-secondary" title="Duplikovat">
                        <i data-lucide="copy" class="w-3 h-3"></i>
                    </button>
                    <button onclick="app.removeContract('${which}','${c.id}')" class="btn-danger" title="Smazat">
                        <i data-lucide="trash-2" class="w-3 h-3"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }

    function addContract(which) {
        if (!state.clients.length) { toast('Nejprve přidejte osobu', 'error'); switchTab('klient'); return; }
        const c = emptyContract(state.clients[0].id);
        (which === 'current' ? state.currentContracts : state.proposedContracts).push(c);
        save();
        editContract(which, c.id);
        renderContractsGroup(which);
        renderKPIs();
    }
    function removeContract(which, id) {
        if (!confirm('Smazat smlouvu?')) return;
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
        const copy = clone(c); copy.id = uid(); copy.contractNo = (copy.contractNo || '') + ' (kopie)';
        list.push(copy);
        save(); renderContractsGroup(which); renderKPIs();
    }
    function copyFromCurrent() {
        if (!confirm('Zkopírovat všechny stávající smlouvy do návrhu? Stávající návrh bude přepsán.')) return;
        state.proposedContracts = state.currentContracts.map(c => {
            const copy = clone(c); copy.id = uid(); return copy;
        });
        save(); renderContractsGroup('proposed'); renderKPIs();
        toast('Stávající portfolio zkopírováno do návrhu', 'success');
    }

    /* ════════════ EDIT CONTRACT MODAL ════════════ */
    let editingCtx = null;

    function editContract(which, id) {
        const list = which === 'current' ? state.currentContracts : state.proposedContracts;
        const c = list.find(c => c.id === id);
        if (!c) return;
        editingCtx = { which, id };
        document.getElementById('contractModalTitle').textContent =
            (which === 'current' ? 'Stávající smlouva — ' : 'Návrh smlouvy — ') + (c.insurer || 'Nová');

        const body = document.getElementById('contractModalBody');
        const insurerOptions = D.INSURER_NAMES.map(n =>
            `<option value="${escapeHtml(n)}" ${c.insurer === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
        const clientOptions = state.clients.map(cl =>
            `<option value="${cl.id}" ${c.clientId === cl.id ? 'selected' : ''}>${escapeHtml(cl.name)}</option>`).join('');

        body.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Osoba</span>
                    <select class="pro-input" id="mod_client">${clientOptions}</select>
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Pojišťovna</span>
                    <select class="pro-input" id="mod_insurer">
                        <option value="">-- vyberte --</option>
                        ${insurerOptions}
                        <option value="OTHER" ${c.insurer && !D.INSURER_NAMES.includes(c.insurer) ? 'selected' : ''}>Jiná…</option>
                    </select>
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Číslo smlouvy</span>
                    <input type="text" class="pro-input" id="mod_contractNo" value="${escapeHtml(c.contractNo || '')}">
                </label>
                <label class="block" id="mod_otherInsurerWrap" style="display:${(c.insurer && !D.INSURER_NAMES.includes(c.insurer)) ? 'block' : 'none'}">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Jiná pojišťovna — název</span>
                    <input type="text" class="pro-input" id="mod_otherInsurer" value="${escapeHtml(c.insurer && !D.INSURER_NAMES.includes(c.insurer) ? c.insurer : '')}">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Počátek (rok)</span>
                    <input type="number" class="pro-input" id="mod_start" min="1900" max="2100" value="${c.start || ''}">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Konec (rok)</span>
                    <input type="number" class="pro-input" id="mod_end" min="1900" max="2100" value="${c.end || ''}">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Platba</span>
                    <input type="number" class="pro-input" id="mod_premium" min="0" step="1" value="${c.premium || 0}">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Frekvence</span>
                    <select class="pro-input" id="mod_freq">
                        <option value="monthly"   ${(c.conditions && c.conditions.paymentFrequency) === 'monthly' || !(c.conditions && c.conditions.paymentFrequency) ? 'selected' : ''}>Měsíčně</option>
                        <option value="quarterly" ${(c.conditions && c.conditions.paymentFrequency) === 'quarterly' ? 'selected' : ''}>Čtvrtletně</option>
                        <option value="yearly"    ${(c.conditions && c.conditions.paymentFrequency) === 'yearly' ? 'selected' : ''}>Ročně</option>
                        <option value="singlepay" ${(c.conditions && c.conditions.paymentFrequency) === 'singlepay' ? 'selected' : ''}>Jednorázově</option>
                    </select>
                </label>
            </div>

            <h4 class="text-xs font-bold uppercase text-slate-400 mb-2 flex items-center gap-2">
                <i data-lucide="layers" class="w-3.5 h-3.5"></i>Pojistné krytí
            </h4>
            <div class="ins-grid mb-4">
                ${D.CATEGORIES.map(cat => `
                    <label title="${escapeHtml(cat.help)}">
                        <span>${escapeHtml(cat.label)} ${cat.kind === 'daily' ? '(Kč/den)' : '(Kč)'}</span>
                        <input type="number" class="pro-input" min="0" step="${cat.kind === 'daily' ? 10 : 1000}"
                            id="mod_item_${cat.key}" value="${num(c.items && c.items[cat.key])}">
                    </label>
                `).join('')}
            </div>

            <h4 class="text-xs font-bold uppercase text-slate-400 mb-2 flex items-center gap-2">
                <i data-lucide="settings-2" class="w-3.5 h-3.5"></i>Podmínky a klauzule
            </h4>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">PN — plnění od (den)</span>
                    <select class="pro-input" id="mod_pnFromDay">
                        <option value="1"  ${(c.conditions && c.conditions.pnFromDay) === 1 ? 'selected' : ''}>Od 1. dne</option>
                        <option value="15" ${(c.conditions && c.conditions.pnFromDay) === 15 ? 'selected' : ''}>Od 15. dne</option>
                        <option value="22" ${(c.conditions && c.conditions.pnFromDay) === 22 ? 'selected' : ''}>Od 22. dne</option>
                        <option value="29" ${(c.conditions && c.conditions.pnFromDay) === 29 || !(c.conditions && c.conditions.pnFromDay) ? 'selected' : ''}>Od 29. dne</option>
                        <option value="61" ${(c.conditions && c.conditions.pnFromDay) === 61 ? 'selected' : ''}>Od 61. dne</option>
                    </select>
                </label>
                <label class="flex items-center gap-2 text-xs text-slate-300 mt-5">
                    <input type="checkbox" class="pro-input" id="mod_pnRetroactive" ${(c.conditions && c.conditions.pnRetroactive) ? 'checked' : ''}>
                    <span>PN <strong>zpětně</strong> od 1. dne (při delším trvání)</span>
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Hospitalizace — čekací (dny)</span>
                    <input type="number" class="pro-input" id="mod_hospWaiting" min="0" max="60" value="${(c.conditions && c.conditions.hospWaitingDays) || 0}">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">ZO — čekací doba (měsíce)</span>
                    <input type="number" class="pro-input" id="mod_zoWaiting" min="0" max="12" value="${(c.conditions && c.conditions.criticalIllnessWaitingMonths) || 3}">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Riziková skupina (povolání)</span>
                    <input type="text" class="pro-input" id="mod_occCat" placeholder="např. 1, 2, 3, 4"
                        value="${escapeHtml((c.conditions && c.conditions.occupationCategory) || '')}">
                </label>
                <label class="block md:col-span-3">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Poznámka</span>
                    <textarea class="pro-input" id="mod_note" rows="2"
                        placeholder="Zvláštnosti smlouvy, výluky, čekací doby specifické…">${escapeHtml(c.note || '')}</textarea>
                </label>
            </div>

            <div class="flex justify-between items-center gap-2 mt-4">
                <button onclick="app.applyInsurerDefaults()" class="btn-secondary" title="Předvyplnit výchozí podmínky podle pojišťovny">
                    <i data-lucide="zap" class="w-3.5 h-3.5"></i>Předvyplnit dle pojišťovny
                </button>
                <div class="flex gap-2">
                    <button onclick="app.closeContractModal()" class="btn-secondary">Zrušit</button>
                    <button onclick="app.saveContractModal()" class="btn-primary">
                        <i data-lucide="save" class="w-3.5 h-3.5"></i>Uložit
                    </button>
                </div>
            </div>
        `;
        document.getElementById('contractModal').classList.remove('hidden');
        document.getElementById('contractModal').classList.add('flex');
        document.getElementById('mod_insurer').addEventListener('change', function () {
            document.getElementById('mod_otherInsurerWrap').style.display = this.value === 'OTHER' ? 'block' : 'none';
        });
        if (window.lucide) lucide.createIcons();
    }
    function closeContractModal() {
        document.getElementById('contractModal').classList.add('hidden');
        document.getElementById('contractModal').classList.remove('flex');
        editingCtx = null;
    }
    function applyInsurerDefaults() {
        const insurerName = document.getElementById('mod_insurer').value;
        const ins = D.INSURERS.find(i => i.name === insurerName);
        if (!ins) { toast('Vyberte pojišťovnu', 'info'); return; }
        const d = ins.defaultConditions;
        if (d.pnWaitingDays) document.getElementById('mod_pnFromDay').value = String(d.pnWaitingDays);
        document.getElementById('mod_pnRetroactive').checked = !!d.pnRetroactive;
        document.getElementById('mod_hospWaiting').value = d.hospWaitingDays || 0;
        document.getElementById('mod_zoWaiting').value = d.criticalIllnessWaitingMonths || 3;
        document.getElementById('mod_occCat').value = d.occupationCategories || '';
        toast('Výchozí podmínky předvyplněny', 'success');
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
        c.note = document.getElementById('mod_note').value.trim();
        c.conditions = c.conditions || {};
        c.conditions.paymentFrequency = document.getElementById('mod_freq').value;
        c.conditions.pnFromDay = num(document.getElementById('mod_pnFromDay').value) || 29;
        c.conditions.pnWaitingDays = c.conditions.pnFromDay;
        c.conditions.pnRetroactive = document.getElementById('mod_pnRetroactive').checked;
        c.conditions.hospWaitingDays = num(document.getElementById('mod_hospWaiting').value);
        c.conditions.criticalIllnessWaitingMonths = num(document.getElementById('mod_zoWaiting').value);
        c.conditions.occupationCategory = document.getElementById('mod_occCat').value.trim();

        c.items = c.items || {};
        D.CATEGORIES.forEach(cat => {
            c.items[cat.key] = num(document.getElementById('mod_item_' + cat.key).value);
        });
        save();
        closeContractModal();
        renderContractsGroup(which);
        renderKPIs();
        toast('Uloženo', 'success');
    }

    /* ════════════ LOANS ════════════ */
    function renderLoans() {
        const container = document.getElementById('loansList');
        if (!state.loans.length) {
            container.innerHTML = `<div class="text-xs text-slate-500 italic text-center py-6 border border-dashed border-slate-800 rounded">
                Žádné úvěry. Přidejte hypotéku, půjčku od rodičů, spotřebitelský úvěr…
            </div>`;
            updateLoansTotals();
            return;
        }
        const clientOpts = state.clients.map(c =>
            `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        container.innerHTML = state.loans.map(l => `
            <div class="grid grid-cols-1 lg:grid-cols-4 gap-2 items-end p-3 bg-slate-950/40 border border-slate-800 rounded">
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Název / popis</span>
                    <input type="text" class="pro-input" value="${escapeHtml(l.name)}"
                        onchange="app.updateLoan('${l.id}', 'name', this.value)">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Výše (Kč)</span>
                    <input type="number" class="pro-input" min="0" step="10000" value="${l.amount || 0}"
                        onchange="app.updateLoan('${l.id}', 'amount', this.value)">
                </label>
                <label class="block">
                    <span class="block text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Hlavní dlužník</span>
                    <select class="pro-input" onchange="app.updateLoan('${l.id}', 'linkedClientId', this.value)">
                        <option value="">-- vyberte --</option>
                        ${state.clients.map(c => `<option value="${c.id}" ${l.linkedClientId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                    </select>
                </label>
                <div class="flex items-end justify-end">
                    <button onclick="app.removeLoan('${l.id}')" class="btn-danger">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>Smazat
                    </button>
                </div>
            </div>
        `).join('');
        updateLoansTotals();
        if (window.lucide) lucide.createIcons();
    }
    function updateLoansTotals() {
        const total = sumLoans();
        document.getElementById('loansTotal').textContent = fmtCZK(total);
        document.getElementById('loansRecommended').textContent = fmtCZK(Math.round(total * 1.15));
    }
    function addLoan() {
        state.loans.push({ id: uid(), name: 'Nový úvěr', amount: 0, linkedClientId: state.clients[0] ? state.clients[0].id : '' });
        save(); renderLoans(); renderKPIs();
    }
    function updateLoan(id, field, value) {
        const l = state.loans.find(l => l.id === id);
        if (!l) return;
        if (field === 'amount') value = num(value);
        l[field] = value;
        save(); updateLoansTotals(); renderKPIs();
    }
    function removeLoan(id) {
        state.loans = state.loans.filter(l => l.id !== id);
        save(); renderLoans(); renderKPIs();
    }

    /* ════════════ SCENARIO ════════════ */
    function refreshScenarioPersons() {
        const sel = document.getElementById('scenarioPerson');
        const cur = sel.value;
        sel.innerHTML = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        if (cur && state.clients.find(c => c.id === cur)) sel.value = cur;
        else if (state.clients[0]) sel.value = state.clients[0].id;
    }
    function readScenarioInputs() {
        return {
            person: document.getElementById('scenarioPerson').value,
            pnDays: num(document.getElementById('scenarioPnDays').value) || 0,
            hospDays: num(document.getElementById('scenarioHospDays').value) || 0,
            injury: document.getElementById('scenarioInjury').value,
            retroactive: document.getElementById('scenarioRetroactive').checked
        };
    }
    function persistScenario(s) { state.scenario = s; save(); }

    function computeScenarioForList(list, person, sc) {
        const personId = person.id;
        const items = list.filter(c => c.clientId === personId);
        const sums = {};
        D.CATEGORIES.forEach(cat => { sums[cat.key] = items.reduce((s, c) => s + num(c.items && c.items[cat.key]), 0); });

        const pnDays = sc.pnDays;
        const hospDays = sc.hospDays;

        let urazPay = 0, urazVelkyPay = 0;
        if (sc.injury === 'minor' || sc.injury === 'both') urazPay = sums.uraz * pnDays;
        if (sc.injury === 'major' || sc.injury === 'both') urazVelkyPay = sums.urazVelky * Math.max(0, pnDays - 30);

        const hospPay = sums.hosp * hospDays;
        const hospUrazPay = sums.hospUraz * hospDays;

        let pn28Pay, pn61Pay;
        if (sc.retroactive) {
            pn28Pay = pnDays >= 29 ? sums.pn28 * pnDays : 0;
            pn61Pay = pnDays >= 61 ? sums.pn61 * pnDays : 0;
        } else {
            pn28Pay = sums.pn28 * Math.max(0, pnDays - 28);
            pn61Pay = sums.pn61 * Math.max(0, pnDays - 60);
        }
        const chirPay = sums.chir; /* zjednodušeně 1 zákrok */

        const lines = [
            { label: 'Drobný úraz (denní)', rate: `${sums.uraz} Kč/d × ${pnDays} dní`,             amount: urazPay,      include: sc.injury !== 'major' && sums.uraz > 0 },
            { label: 'Vážný úraz (denní)',  rate: `${sums.urazVelky} Kč/d × ${Math.max(0, pnDays - 30)} dní (od 30.dne)`, amount: urazVelkyPay, include: (sc.injury === 'major' || sc.injury === 'both') && sums.urazVelky > 0 },
            { label: 'Hospitalizace',       rate: `${sums.hosp} Kč/d × ${hospDays} dní`,           amount: hospPay,      include: sums.hosp > 0 },
            { label: 'Hosp. úraz',          rate: `${sums.hospUraz} Kč/d × ${hospDays} dní`,       amount: hospUrazPay,  include: sums.hospUraz > 0 },
            { label: sc.retroactive && pnDays >= 29 ? 'PN 28. den (od 1.dne zpětně)' : 'PN 28. den',
              rate:  sc.retroactive ? `${sums.pn28} Kč/d × ${pnDays} dní` : `${sums.pn28} Kč/d × ${Math.max(0, pnDays - 28)} dní`,
              amount: pn28Pay,  include: sums.pn28 > 0 },
            { label: sc.retroactive && pnDays >= 61 ? 'PN 61. den (od 1.dne zpětně)' : 'PN 61. den',
              rate:  sc.retroactive ? `${sums.pn61} Kč/d × ${pnDays} dní` : `${sums.pn61} Kč/d × ${Math.max(0, pnDays - 60)} dní`,
              amount: pn61Pay,  include: sums.pn61 > 0 },
            { label: 'Chirurgický zákrok',  rate: `1× max ${fmtCZKShort(sums.chir)}`, amount: chirPay, include: sums.chir > 0 }
        ];
        const total = lines.filter(l => l.include).reduce((s, l) => s + l.amount, 0);
        return { lines, total };
    }

    function renderScenario() {
        if (!state.clients.length) {
            document.getElementById('scenarioResult').innerHTML = '<div class="text-xs text-slate-500 italic">Nejprve přidejte osoby a smlouvy.</div>';
            document.getElementById('incomeCoverage').innerHTML = '';
            return;
        }
        refreshScenarioPersons();
        const sc = readScenarioInputs();
        persistScenario(sc);
        const person = state.clients.find(c => c.id === sc.person);
        if (!person) return;

        const curR = computeScenarioForList(state.currentContracts, person, sc);
        const newR = computeScenarioForList(state.proposedContracts, person, sc);

        const linesHtml = curR.lines.map((cl, i) => {
            const nl = newR.lines[i];
            if (!cl.include && !nl.include) return '';
            return `<div class="sc-line">
                <div>${escapeHtml(cl.label)}</div>
                <div class="sc-amount">${cl.include ? fmtCZK(cl.amount) : '<span class="text-slate-700">—</span>'}</div>
                <div class="sc-rate">${cl.include ? escapeHtml(cl.rate) : ''}</div>
                <div class="sc-amount">${nl.include ? fmtCZK(nl.amount) : '<span class="text-slate-700">—</span>'}</div>
                <div class="sc-rate">${nl.include ? escapeHtml(nl.rate) : ''}</div>
            </div>`;
        }).join('');

        const diff = newR.total - curR.total;
        const diffClass = diff > 0 ? 'text-emerald-300' : diff < 0 ? 'text-rose-300' : 'text-slate-300';

        document.getElementById('scenarioResult').innerHTML = `
            <div class="border border-slate-800 rounded overflow-hidden">
                <div class="sc-line sc-line-header">
                    <div>Položka</div>
                    <div class="sc-amount">Stáv. Σ</div>
                    <div class="sc-rate">Stáv. výpočet</div>
                    <div class="sc-amount">Návrh Σ</div>
                    <div class="sc-rate">Návrh výpočet</div>
                </div>
                ${linesHtml || `<div class="text-xs text-slate-500 italic p-4">Tato osoba nemá pojištění s plněním pro tento scénář.</div>`}
                <div class="sc-line sc-line-total">
                    <div>Celkové plnění ze scénáře</div>
                    <div class="sc-amount">${fmtCZK(curR.total)}</div>
                    <div></div>
                    <div class="sc-amount">${fmtCZK(newR.total)}</div>
                    <div class="${diffClass} sc-rate">Δ ${(diff >= 0 ? '+' : '')}${fmtCZK(diff)}</div>
                </div>
            </div>
        `;

        /* Income coverage */
        renderIncomeCoverage(person, sc);
    }

    function computeMonthlyIncomeCoverage(list, person, sc) {
        const personId = person.id;
        const items = list.filter(c => c.clientId === personId);
        const sumPn28 = items.reduce((s, c) => s + num(c.items && c.items.pn28), 0);
        const sumPn61 = items.reduce((s, c) => s + num(c.items && c.items.pn61), 0);
        const sumHosp = items.reduce((s, c) => s + num(c.items && c.items.hosp), 0);
        const sumUraz = items.reduce((s, c) => s + num(c.items && c.items.uraz), 0);

        const dailyFromInsurance = sumPn28 + sumPn61 + sumHosp + sumUraz;
        const monthlyFromInsurance = dailyFromInsurance * 30;

        let stateBenefit = 0;
        if (!person.isEntrepreneur) {
            const gross = num(person.incomeGross);
            const rate = D.sickLeaveRate(gross);
            stateBenefit = Math.min(gross * rate, D.SICKLEAVE_CAP);
        }
        return { stateBenefit, insurance: monthlyFromInsurance, total: stateBenefit + monthlyFromInsurance };
    }

    function renderIncomeCoverage(person, sc) {
        const cur = computeMonthlyIncomeCoverage(state.currentContracts, person, sc);
        const nw  = computeMonthlyIncomeCoverage(state.proposedContracts, person, sc);
        const gross = num(person.incomeGross);
        const targetNet = gross * 0.75; /* hrubý odhad čistého */
        const curPct = targetNet > 0 ? Math.min(150, cur.total / targetNet * 100) : 0;
        const newPct = targetNet > 0 ? Math.min(150, nw.total / targetNet * 100) : 0;
        const meter = (pct) => `<div class="meter mt-1"><div class="fill ${pct >= 100 ? 'fill-good' : pct >= 60 ? 'fill-warn' : 'fill-danger'}" style="width:${Math.min(100, pct)}%"></div></div>`;
        document.getElementById('incomeCoverage').innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="kpi-card">
                    <div class="text-[10px] uppercase text-slate-500 font-bold mb-2">Stávající portfolio</div>
                    <div class="space-y-1 text-xs text-slate-300">
                        <div class="flex justify-between"><span>Nemocenská ČSSZ:</span><span class="font-mono">${fmtCZK(cur.stateBenefit)}</span></div>
                        <div class="flex justify-between"><span>Z pojistek (30 dní):</span><span class="font-mono">${fmtCZK(cur.insurance)}</span></div>
                        <div class="flex justify-between border-t border-slate-800 pt-1 mt-1 font-bold"><span>Celkem / měs:</span><span class="font-mono text-emerald-300">${fmtCZK(cur.total)}</span></div>
                        <div class="text-[10px] text-slate-500">Cílový čistý příjem (≈75 % hrubého): ${fmtCZK(targetNet)} → pokrytí <strong>${curPct.toFixed(0)} %</strong></div>
                        ${meter(curPct)}
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="text-[10px] uppercase text-slate-500 font-bold mb-2">Navrhované portfolio</div>
                    <div class="space-y-1 text-xs text-slate-300">
                        <div class="flex justify-between"><span>Nemocenská ČSSZ:</span><span class="font-mono">${fmtCZK(nw.stateBenefit)}</span></div>
                        <div class="flex justify-between"><span>Z pojistek (30 dní):</span><span class="font-mono">${fmtCZK(nw.insurance)}</span></div>
                        <div class="flex justify-between border-t border-slate-800 pt-1 mt-1 font-bold"><span>Celkem / měs:</span><span class="font-mono text-sky-300">${fmtCZK(nw.total)}</span></div>
                        <div class="text-[10px] text-slate-500">Cílový čistý příjem (≈75 % hrubého): ${fmtCZK(targetNet)} → pokrytí <strong>${newPct.toFixed(0)} %</strong></div>
                        ${meter(newPct)}
                    </div>
                </div>
            </div>
        `;
    }

    /* ════════════ COMPARISON ════════════ */
    let chartInstance = null;
    function refreshCompareFilter() {
        const sel = document.getElementById('compareFilter');
        const cur = sel.value || 'ALL';
        sel.innerHTML = '<option value="ALL">Souhrn – všichni</option>' +
            state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        sel.value = cur;
    }
    function renderComparison() {
        refreshCompareFilter();
        const filter = document.getElementById('compareFilter').value || 'ALL';
        const filterList = (list) => filter === 'ALL' ? list : list.filter(c => c.clientId === filter);
        const cur = filterList(state.currentContracts);
        const nw  = filterList(state.proposedContracts);

        const rows = D.CATEGORIES.map(cat => {
            const cv = cur.reduce((s, c) => s + num(c.items && c.items[cat.key]), 0);
            const nv = nw.reduce((s, c) => s + num(c.items && c.items[cat.key]), 0);
            const diff = nv - cv;
            const cls = diff > 0 ? 'v-diff-pos' : diff < 0 ? 'v-diff-neg' : 'v-diff-zero';
            const fmt = (v) => v ? (cat.kind === 'daily' ? v + ' Kč/d' : fmtCZK(v)) : '—';
            return `<div class="cmp-row">
                <div>
                    <div class="text-xs font-semibold text-slate-200">${escapeHtml(cat.label)}</div>
                    <div class="text-[10px] text-slate-500">${cat.kind === 'daily' ? 'denní dávka' : 'pojistná částka'}</div>
                </div>
                <div class="v v-curr">${fmt(cv)}</div>
                <div class="v v-new">${fmt(nv)}</div>
                <div class="v ${cls}">${diff === 0 ? '±0' : (diff > 0 ? '+' : '') + fmt(diff)}</div>
            </div>`;
        }).join('');

        const curM = totalPremiumMonthly(cur);
        const newM = totalPremiumMonthly(nw);
        const diffPrem = newM - curM;
        const premCls = diffPrem > 0 ? 'v-diff-neg' : diffPrem < 0 ? 'v-diff-pos' : 'v-diff-zero';

        document.getElementById('comparisonContent').innerHTML = `
            <div class="cmp-row cmp-row-header">
                <div>Kategorie</div>
                <div class="text-right">Stávající</div>
                <div class="text-right">Návrh</div>
                <div class="text-right">Rozdíl</div>
            </div>
            ${rows}
            <div class="cmp-row" style="background:#131e34 !important; border-top:2px solid #334155;">
                <div class="text-xs font-bold text-slate-100">Měsíční pojistné</div>
                <div class="v v-curr font-bold">${fmtCZK(curM)}</div>
                <div class="v v-new font-bold">${fmtCZK(newM)}</div>
                <div class="v ${premCls} font-bold">${diffPrem === 0 ? '±0' : (diffPrem > 0 ? '+' : '') + fmtCZK(diffPrem)}</div>
            </div>
            <div class="cmp-row" style="background:#131e34 !important;">
                <div class="text-xs font-bold text-slate-100">Roční pojistné</div>
                <div class="v v-curr font-bold">${fmtCZK(curM*12)}</div>
                <div class="v v-new font-bold">${fmtCZK(newM*12)}</div>
                <div class="v ${premCls} font-bold">${diffPrem === 0 ? '±0' : (diffPrem*12 > 0 ? '+' : '') + fmtCZK(diffPrem*12)}</div>
            </div>
        `;

        renderRecommendations(cur, nw, filter);
        renderCategoryChart(cur, nw);
    }

    function renderRecommendations(cur, nw, filter) {
        const recos = [];
        const personLabel = filter === 'ALL' ? 'všichni dohromady' : 'pro ' + clientName(filter);

        /* Podpojištění úvěry */
        const loans = filter === 'ALL' ? sumLoans() : state.loans.filter(l => l.linkedClientId === filter).reduce((s, l) => s + num(l.amount), 0);
        const smrtCur = cur.reduce((s, c) => s + num(c.items && c.items.smrt), 0);
        const smrtNw  = nw.reduce((s, c) => s + num(c.items && c.items.smrt), 0);
        if (loans > 0) {
            if (smrtCur < loans) recos.push({ type: 'danger', icon: 'alert-triangle',
                text: `<strong>Podpojištění (stávající):</strong> krytí smrti ${fmtCZK(smrtCur)} je <strong>${fmtCZK(loans - smrtCur)} pod závazky</strong> ${escapeHtml(personLabel)} (${fmtCZK(loans)}). Pozůstalí by museli závazky řešit z jiných zdrojů.` });
            if (smrtNw >= loans) recos.push({ type: 'success', icon: 'check-circle',
                text: `<strong>Návrh řeší krytí smrti:</strong> ${fmtCZK(smrtNw)} ≥ závazky ${fmtCZK(loans)}.` });
            else if (smrtNw < loans) recos.push({ type: 'warning', icon: 'alert-circle',
                text: `<strong>Návrh stále nepokrývá:</strong> chybí ${fmtCZK(loans - smrtNw)} k pokrytí závazků.` });
        }

        /* Chybí invalidita */
        const invCur = cur.reduce((s, c) => s + num(c.items && c.items.invalidita), 0);
        const invNw  = nw.reduce((s, c) => s + num(c.items && c.items.invalidita), 0);
        if (loans > 0 && invNw < loans * 0.5) {
            recos.push({ type: 'warning', icon: 'shield-alert',
                text: `<strong>Slabé krytí invalidity:</strong> ${fmtCZK(invNw)} (návrh) je málo vzhledem k závazkům ${fmtCZK(loans)}. Doporučuji minimum 50–80 % výše úvěrů (alespoň ${fmtCZK(loans * 0.5)}).` });
        }

        /* Žádné PN nebo žádná hospitalizace */
        const pnAny = nw.reduce((s, c) => s + num(c.items && c.items.pn28) + num(c.items && c.items.pn61), 0);
        if (pnAny === 0 && (filter === 'ALL' || state.clients.find(c => c.id === filter)?.incomeGross > 0)) {
            recos.push({ type: 'info', icon: 'briefcase',
                text: `<strong>Návrh neobsahuje pojištění pracovní neschopnosti.</strong> Při příjmu z práce je dobré ho mít, zejména u OSVČ, kde stát neplatí nemocenskou.` });
        }

        /* Duplicity */
        const duplicates = findDuplicates(filter === 'ALL' ? state.proposedContracts : nw);
        duplicates.forEach(d => recos.push({ type: 'info', icon: 'copy', text: d }));

        /* Změna ceny */
        const curM = totalPremiumMonthly(cur);
        const newM = totalPremiumMonthly(nw);
        const diff = newM - curM;
        if (Math.abs(diff) > 100) {
            const pct = curM > 0 ? (diff / curM * 100) : 100;
            recos.push({ type: diff > 0 ? 'warning' : 'success', icon: diff > 0 ? 'trending-up' : 'trending-down',
                text: `<strong>Změna měsíční ceny:</strong> ${diff > 0 ? '+' : ''}${fmtCZK(diff)} (${diff > 0 ? '+' : ''}${pct.toFixed(0)} %). ${escapeHtml(personLabel)}.` });
        }

        /* Kategorie kde návrh úplně chybí */
        D.CATEGORIES.forEach(cat => {
            const c = cur.reduce((s, x) => s + num(x.items && x.items[cat.key]), 0);
            const n = nw.reduce((s, x) => s + num(x.items && x.items[cat.key]), 0);
            if (c > 0 && n === 0) {
                recos.push({ type: 'warning', icon: 'minus-circle',
                    text: `<strong>Návrh ztrácí krytí kategorie „${escapeHtml(cat.label)}".</strong> Ve stávajícím portfoliu jste měli ${fmt(c, cat)}. Ověřte, zda je vypuštění záměrné.` });
            }
        });

        /* Klauzule od 1. dne */
        const hasRetro = nw.some(c => c.conditions && c.conditions.pnRetroactive);
        if (!hasRetro && nw.some(c => num(c.items && c.items.pn28) > 0 || num(c.items && c.items.pn61) > 0)) {
            recos.push({ type: 'info', icon: 'clock',
                text: `<strong>Tip:</strong> Pro PN zvažte rozšíření „<strong>od 1. dne zpětně</strong>" (typicky +15–30 % k pojistnému za PN). Při delší PN vrátí všechny dny zpětně.` });
        }

        function fmt(v, cat) { return cat.kind === 'daily' ? v + ' Kč/d' : fmtCZK(v); }

        if (!recos.length) {
            recos.push({ type: 'success', icon: 'check-circle', text: 'Portfolio vypadá vyrovnaně. Pro detailní vyhodnocení použijte AI analýzu.' });
        }

        document.getElementById('recommendationsList').innerHTML = recos.map(r =>
            `<div class="reco reco-${r.type}">
                <span class="reco-icon"><i data-lucide="${r.icon}" class="w-4 h-4"></i></span>
                <div>${r.text}</div>
            </div>`).join('');
        if (window.lucide) lucide.createIcons();
    }

    function findDuplicates(list) {
        const out = [];
        /* Stejná pojišťovna + osoba + kategorie s velmi blízkou hodnotou = duplicita? */
        const byClient = {};
        list.forEach(c => { (byClient[c.clientId] = byClient[c.clientId] || []).push(c); });
        for (const cid in byClient) {
            const arr = byClient[cid];
            if (arr.length < 2) continue;
            const insurers = new Set(arr.map(a => a.insurer || ''));
            if (insurers.size === 1 && arr.length >= 3) {
                out.push(`Osoba <strong>${escapeHtml(clientName(cid))}</strong> má <strong>${arr.length} smluv u jediné pojišťovny (${escapeHtml([...insurers][0] || 'neuvedeno')})</strong> — zvažte konsolidaci.`);
            }
        }
        return out;
    }

    function renderCategoryChart(cur, nw) {
        const ctx = document.getElementById('categoryChart');
        if (!ctx) return;
        const labels = D.CATEGORIES.map(c => c.short);
        const dataCur = D.CATEGORIES.map(c => cur.reduce((s, x) => s + num(x.items && x.items[c.key]), 0));
        const dataNw  = D.CATEGORIES.map(c => nw.reduce((s, x) => s + num(x.items && x.items[c.key]), 0));

        if (chartInstance) chartInstance.destroy();
        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Stávající', data: dataCur, backgroundColor: 'rgba(16,185,129,0.7)', borderColor: 'rgba(16,185,129,1)', borderWidth: 1 },
                    { label: 'Návrh',     data: dataNw,  backgroundColor: 'rgba(14,165,233,0.7)', borderColor: 'rgba(14,165,233,1)', borderWidth: 1 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#cbd5e1', font: { size: 11 } } },
                    tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + fmtCZK(ctx.parsed.y) } }
                },
                scales: {
                    x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(30,41,59,0.5)' } },
                    y: { ticks: { color: '#64748b', font: { size: 10 }, callback: (v) => v >= 1e6 ? (v/1e6)+'M' : v >= 1e3 ? (v/1e3)+'k' : v }, grid: { color: 'rgba(30,41,59,0.5)' } }
                }
            }
        });
    }

    /* ════════════ AI / GROQ ════════════ */
    function getApiKey() { return lsGet('groq_api_key') || getCookie('groq_api_key') || ''; }
    function getModel()  { return lsGet('groq_model') || 'llama-3.3-70b-versatile'; }

    function buildPortfolioContext() {
        const totalCurMonthly = totalPremiumMonthly(state.currentContracts);
        const totalNewMonthly = totalPremiumMonthly(state.proposedContracts);
        const summary = {
            klienti: state.clients.map(c => ({
                jmeno: c.name, rok_narozeni: c.birthYear, hruby_prijem_mesicni_kc: c.incomeGross,
                OSVC: c.isEntrepreneur,
                pocet_stavajicich_smluv: state.currentContracts.filter(s => s.clientId === c.id).length,
                pocet_navrh_smluv: state.proposedContracts.filter(s => s.clientId === c.id).length
            })),
            uvery_celkem_kc: sumLoans(),
            uvery_polozky: state.loans.map(l => ({ nazev: l.name, vyse_kc: l.amount, klient: clientName(l.linkedClientId) })),
            stavajici_smlouvy: state.currentContracts.map(c => ({
                klient: clientName(c.clientId), pojistovna: c.insurer, cislo: c.contractNo,
                pocatek: c.start, konec: c.end, platba_mesicni_kc: c.premium,
                kryti: Object.fromEntries(D.CATEGORIES.map(cat => [cat.short, c.items && c.items[cat.key] || 0]).filter(([_, v]) => v > 0)),
                podminky: c.conditions, poznamka: c.note
            })),
            navrhovane_smlouvy: state.proposedContracts.map(c => ({
                klient: clientName(c.clientId), pojistovna: c.insurer, cislo: c.contractNo,
                pocatek: c.start, konec: c.end, platba_mesicni_kc: c.premium,
                kryti: Object.fromEntries(D.CATEGORIES.map(cat => [cat.short, c.items && c.items[cat.key] || 0]).filter(([_, v]) => v > 0)),
                podminky: c.conditions, poznamka: c.note
            })),
            celkove_mesicni_platby: { stavajici: totalCurMonthly, navrh: totalNewMonthly, rozdil: totalNewMonthly - totalCurMonthly },
            zadani_poradce: state.adviserBrief
        };
        return summary;
    }

    function aiPrompt(taskType, customQ) {
        const portfolio = buildPortfolioContext();
        const portfolioJson = JSON.stringify(portfolio, null, 2);

        const sys = `Jsi zkušený český investiční poradce a expert na životní a úrazové pojištění. Mluvíš česky, věcně, bez marketingových frází. Odpovídáš v Markdown. Kde uvádíš čísla, používej český formát s mezerou jako oddělovačem tisíců a "Kč" jako symbol.

Znáš relevantní legislativu (zákon č. 277/2009 Sb., zákon č. 170/2018 Sb., občanský zákoník §§ 2756–2872, doporučení ČNB) a obchodní podmínky velkých českých pojišťoven (Kooperativa, Allianz, Generali ČP, ČSOB Pojišťovna, NN, Uniqa, Komerční pojišťovna, Simplea).

Tvým úkolem je posuzovat portfolio pojištění pro investičního poradce, který připravuje konzultaci pro klienta.`;

        const tasks = {
            overall: `### ÚKOL: Celkové vyhodnocení portfolia

Projdi předložené portfolio (stávající i navrhované) a vyhodnoť:
1. **Vhodnost návrhu vs. cíl/zadání poradce** — jak moc návrh odpovídá zadání.
2. **Klíčové slabiny stávajícího stavu** (max 5 bodů).
3. **Co konkrétně návrh zlepšuje** (max 5 bodů).
4. **Co návrh řeší hůře nebo zhoršuje** (pokud něco).
5. **Konkrétní doporučení k úpravě návrhu** (max 5 bodů).
6. **Cost/benefit shrnutí** — vyplatí se změna?

Vyjadřuj se konkrétně, odkazuj na čísla z portfolia.`,
            underinsurance: `### ÚKOL: Analýza podpojištění / přepojištění

Pro každou osobu posuzuj:
- Vztah krytí smrti k závazkům (úvěry).
- Vztah krytí invalidity k závazkům a měsíčnímu příjmu.
- Závažné onemocnění — má klient dostatek?
- PN — pokrývá výpadek příjmů?
- Hospitalizace / chirurgie — dostatečně?

Najdi konkrétní mezery a uvádej **konkrétní doporučené částky** (s odůvodněním).`,
            conditions: `### ÚKOL: Detailní analýza podmínek smluv

Projdi pole \`podminky\` u každé smlouvy a vyhodnoť:
- Klauzule PN (od kterého dne, zpětně?) — vyhovuje povolání a OSVČ statusu klienta?
- Čekací doby (hospitalizace, závažné onemocnění) — odpovídají běžné praxi?
- Riziková kategorie povolání — je správná?
- Frekvence placení — optimální?

Označ smlouvy, kde podmínky <strong>nevyhovují cíli klienta</strong> a navrhni úpravu.`,
            cost: `### ÚKOL: Cost-benefit analýza

Detailně rozeber:
1. **Cenu stávajícího × návrh** (měsíční, roční, rozdíl).
2. **Co návrh přidává nad rámec stávajícího** (nové kategorie, vyšší limity).
3. **Co návrh ubírá** (vypuštěné kategorie / smlouvy).
4. **Cenu za jednotku krytí** — který produkt je „levnější" za Kč krytí?
5. **Návratnost při scénářích** — kdy se vyšší cena vyplatí?

Buduj argumentaci pro klienta proč ANO / NE změnu provést.`,
            legal: `### ÚKOL: Soulad se zákonem o pojišťovnictví a doporučeními ČNB

Vyhodnoť:
1. Není v návrhu „churning" (nevýhodná výměna smlouvy bez prokazatelného benefitu)?
2. Odpovídá návrh testu vhodnosti (věk, příjem, závazky, závislé osoby)?
3. Jsou splněny daňové podmínky pro odečet do 48 000 Kč ročně (pokud relevantní)?
4. Není klient přepojištěn / podpojištěn dle ČNB best-practice?
5. Co bys měl jako poradce zaznamenat do **Záznamu z jednání** (§ 79 zákona 170/2018)?

Konkrétně cituj relevantní paragrafy a doporučení.`,
            custom: `### ÚKOL: Vlastní dotaz

${customQ || '(uživatel nezadal dotaz)'}`
        };

        const user = `${tasks[taskType] || tasks.overall}

---

### DATA O PORTFOLIU (JSON, česky)

\`\`\`json
${portfolioJson}
\`\`\`

---

Odpověz v Markdownu. Buď konkrétní, věcný, odkazuj na čísla. Nezačínej zdvořilostmi typu „Děkuji za data".`;
        return [
            { role: 'system', content: sys },
            { role: 'user',   content: user }
        ];
    }

    async function callGroq(messages) {
        const apiKey = getApiKey();
        if (!apiKey) throw new Error('Není nastaven Groq API klíč (záložka Nastavení).');
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
        /* Velmi jednoduchý MD→HTML převod (žádné DOMPurify, ale escapujeme přede a renderujeme jen bezpečné tagy) */
        let s = escapeHtml(md);
        s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
        s = s.replace(/^---$/gm, '<hr>');
        /* lists */
        s = s.replace(/(^|\n)([-*]) (.+(?:\n[-*] .+)*)/g, (m, pre, _, items) => {
            const li = items.split(/\n[-*] /).map(t => '<li>' + t.replace(/^[-*] /, '') + '</li>').join('');
            return pre + '<ul>' + li + '</ul>';
        });
        s = s.replace(/(^|\n)(\d+\.) (.+(?:\n\d+\. .+)*)/g, (m, pre, _, items) => {
            const li = items.split(/\n\d+\. /).map(t => '<li>' + t.replace(/^\d+\. /, '') + '</li>').join('');
            return pre + '<ol>' + li + '</ol>';
        });
        /* paragraphs */
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
                <div><strong>Chyba volání AI:</strong> ${escapeHtml(e.message || String(e))}<br>
                <span class="text-[11px] text-slate-500">Zkontrolujte API klíč v záložce Nastavení. Klíč získáte zdarma na console.groq.com/keys.</span></div>
            </div>`;
            if (window.lucide) lucide.createIcons();
        } finally {
            btn.disabled = false;
        }
    }
    function renderAiPanel() {
        const sel = document.getElementById('aiTaskType');
        const custom = document.getElementById('aiCustomQuestion');
        sel.addEventListener('change', () => {
            custom.classList.toggle('hidden', sel.value !== 'custom');
        }, { once: true });
        custom.classList.toggle('hidden', sel.value !== 'custom');
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
                { role: 'system', content: `Jsi parser pojistných smluv. Z volně zadaného textu vytvoříš strukturované JSON. Mluvíš česky a striktně vracíš jen platný JSON, nic víc.` },
                { role: 'user',   content: `Pojistné kategorie (klíče): ${categoryList}.
Dostupné pojišťovny: ${insurerList}.
Dostupní klienti (id = jméno): ${clientList}.

Vrať POUZE pole objektů (JSON array), kde každý objekt má:
{ "clientName": "...", "insurer": "...", "contractNo": "...", "start": rok_nebo_null, "end": rok_nebo_null, "premium": cislo_mesicne, "items": { "smrt": 0, ... }, "note": "..." }

clientName přiřaď podle existujících klientů, pokud poznáš, jinak zachovej z textu.
items: vyplň pouze klíče, které jsou v textu zmíněny, ostatní nech 0.

TEXT KE ZPRACOVÁNÍ:
${input}` }
            ];
            const text = await callGroq(messages);
            const match = text.match(/\[[\s\S]*\]/);
            if (!match) throw new Error('AI nevrátila JSON pole.');
            const parsed = JSON.parse(match[0]);
            if (!Array.isArray(parsed)) throw new Error('JSON není pole.');

            let added = 0;
            parsed.forEach(item => {
                const target = bulkTarget === 'current' ? state.currentContracts : state.proposedContracts;
                /* Najdi clienta */
                let clientId = '';
                if (item.clientName) {
                    const found = state.clients.find(c => c.name.toLowerCase() === String(item.clientName).toLowerCase());
                    if (found) clientId = found.id;
                    else {
                        /* Vytvoř nového klienta */
                        const c = { id: uid(), name: item.clientName, incomeGross: 0, isEntrepreneur: false };
                        state.clients.push(c); clientId = c.id;
                    }
                } else if (state.clients[0]) clientId = state.clients[0].id;

                const newC = emptyContract(clientId);
                newC.insurer = item.insurer || '';
                newC.contractNo = item.contractNo || '';
                newC.start = item.start || null;
                newC.end   = item.end   || null;
                newC.premium = num(item.premium);
                newC.note = item.note || '';
                if (item.items) {
                    D.CATEGORIES.forEach(cat => {
                        if (item.items[cat.key] != null) newC.items[cat.key] = num(item.items[cat.key]);
                    });
                }
                target.push(newC);
                added++;
            });
            save();
            closeBulkModal();
            renderAll();
            toast(`AI naimportovala ${added} smluv`, 'success');
        } catch (e) {
            toast('Chyba parsování: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    /* ════════════ LEGAL ════════════ */
    function renderLegal() {
        document.getElementById('legalContent').innerHTML = D.LEGAL_FRAMEWORK.map(b =>
            `<div class="legal-block"><h3>${escapeHtml(b.title)}</h3>${b.body}</div>`).join('');
    }

    /* ════════════ SETTINGS ════════════ */
    function renderSettings() {
        document.getElementById('setGroqKey').value = getApiKey();
        document.getElementById('setGroqModel').value = getModel();
        const an = document.getElementById('setAdvisorName');
        const lu = document.getElementById('setLogoUrl');
        if (an) an.value = state.advisorName || '';
        if (lu) lu.value = state.logoUrl || '';
        refreshLogoPreview();
        updateStoragePreview();
    }
    function saveSettings() {
        const key = document.getElementById('setGroqKey').value.trim();
        const model = document.getElementById('setGroqModel').value;
        lsSet('groq_api_key', key);
        setCookie('groq_api_key', key, 365);
        lsSet('groq_model', model);
        toast('Nastavení uloženo (sdíleno s Finance Terminalem)', 'success');
    }
    function savePrintBranding() {
        const an = document.getElementById('setAdvisorName');
        const lu = document.getElementById('setLogoUrl');
        state.advisorName = an ? an.value.trim() : '';
        // Pokud user vymaže URL, vrátíme se k defaultu; jinak respektujeme jeho hodnotu.
        const luVal = lu ? lu.value.trim() : '';
        state.logoUrl = luVal || DEFAULT_LOGO_URL;
        // Cookie zálohy (pojistka proti smazání localStorage)
        setCookie('insurance_logo_url', state.logoUrl, 365);
        setCookie('insurance_advisor_name', state.advisorName, 365);
        save();
        refreshLogoPreview();
        // Pokud uživatel vymazal pole, hned mu tam ukážeme default zpátky
        if (lu && !luVal) lu.value = state.logoUrl;
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
        if (el) el.textContent = JSON.stringify(state, null, 2).slice(0, 4000) + (JSON.stringify(state).length > 4000 ? '\n…(zkráceno)' : '');
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

    /* ════════════ EXPORT / IMPORT / RESET ════════════ */
    function exportData() {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = buildExportFilename();
        a.click();
        URL.revokeObjectURL(url);
        toast('Export hotov', 'success');
    }

    /* Jméno souboru ve formátu „YYYY-MM-DD Jméno.json".
       Jméno = hlavní klient (první v seznamu). Sanitizujeme znaky nepřípustné
       ve Windows / macOS / Linux souborových názvech. */
    function buildExportFilename() {
        const date = new Date().toISOString().slice(0,10);
        let name = '';
        if (Array.isArray(state.clients) && state.clients.length > 0) {
            name = (state.clients[0].name || '').trim();
        }
        // Sanitize — zakázané znaky ve filenamu: \ / : * ? " < > |
        name = name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
        if (!name) return date + ' Portfolio.json';
        return date + ' ' + name + '.json';
    }
    function importData(ev) {
        const file = ev.target.files[0];
        if (!file) return;
        const r = new FileReader();
        r.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.clients) throw new Error('Soubor neobsahuje platná data.');
                if (!confirm('Importovat data? Aktuální stav bude přepsán.')) return;
                state = Object.assign(defaultState(), data);
                save(); renderAll();
                toast('Import úspěšný', 'success');
            } catch (e) { toast('Chyba importu: ' + e.message, 'error'); }
        };
        r.readAsText(file);
        ev.target.value = '';
    }
    function resetData() {
        if (!confirm('Opravdu smazat VŠECHNA data? Tuto operaci nelze vrátit zpět.')) return;
        if (!confirm('Poslední potvrzení — smazat vše?')) return;
        state = defaultState();
        save(); renderAll();
        toast('Data smazána', 'info');
    }
    function saveAdviserBrief() {
        state.adviserBrief = document.getElementById('adviserBrief').value;
        save();
    }
    function refreshClientSelectors() {
        renderContractsGroup('current');
        renderContractsGroup('proposed');
        renderLoans();
    }

    /* ════════════ PRINT ════════════ */
    function openPrint() {
        save();
        window.open('soubory/tisk.html', '_blank');
    }

    /* ════════════ MASTER RENDER ════════════ */
    function renderAll() {
        renderKPIs();
        renderClients();
        renderContractsGroup('current');
        renderContractsGroup('proposed');
        renderLoans();
        refreshScenarioPersons();
        refreshCompareFilter();
        document.getElementById('adviserBrief').value = state.adviserBrief || '';
        if (window.lucide) lucide.createIcons();
    }

    /* ════════════ INIT ════════════ */
    function init() {
        applyStoredTheme();
        load();
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.addEventListener('click', () => switchTab(b.dataset.tab));
        });
        document.getElementById('aiTaskType').addEventListener('change', function () {
            document.getElementById('aiCustomQuestion').classList.toggle('hidden', this.value !== 'custom');
        });
        if (state.scenario) {
            const s = state.scenario;
            const setIf = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
            const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
            setIf('scenarioPnDays', s.pnDays);
            setIf('scenarioHospDays', s.hospDays);
            setIf('scenarioInjury', s.injury);
            setChk('scenarioRetroactive', s.retroactive);
        }
        renderAll();
        renderLegal();
        renderSettings();
        if (window.lucide) lucide.createIcons();
    }

    /* ════════════ EXPOSE ════════════ */
    window.app = {
        addClient, updateClient, removeClient,
        addContract, removeContract, duplicateContract, copyFromCurrent,
        editContract, closeContractModal, saveContractModal, applyInsurerDefaults,
        addLoan, updateLoan, removeLoan,
        renderScenario, renderComparison,
        bulkImport, closeBulkModal, runBulkParse,
        runAiAnalysis, openAiPanel,
        exportData, importData, resetData,
        openPrint, saveAdviserBrief, saveSettings, savePrintBranding, setTheme
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
