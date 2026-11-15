// Expenses screens: month strip, Summary / Transactions / Installments / Budget tabs,
// and the «سجّل صرف» / «أضف قسط» sheets. Reads through monthSummary (pure); every write goes
// through the model/months/installments functions, then ctx.save(state), then a re-render.
import { formatAmount, parseAmount } from '../../core/money.js';
import { monthName } from '../../core/i18n.js';
import { addCategory, deleteCategory, addTx, deleteTx, liveCats, getCategory, catLabel } from '../../core/model.js';
import { monthOf, addMonth, todayLocal, ensureMonth, setIncome, setBudget } from '../../core/months.js';
import { addPlan, schedule, dueIn, setPaid, deletePlan, remaining, paymentAmount } from './installments.js';
import { monthSummary } from './calc.js';
import { toast, openSheet, closeSheet } from '../../core/ui.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const latin = (v) => String(v ?? '').trim().replace(/[٠-٩]/g, (d) => DIGITS[d]).replace(/٫/g, '.');
const TABS = [['sum', 'tab.summary'], ['tx', 'tab.tx'], ['ins', 'tab.installments'], ['bud', 'tab.budget']];
const PROVS = ['tabby', 'tamara', 'other'];
const N_CHIPS = [3, 4, 6, 12, 24, 36, 48];
const PROV_ALIASES = { tabby: ['تابي', 'tabby'], tamara: ['تمارا', 'tamara'] };

// Amount fields that may legitimately be zero (income, budgets): '' or 0 → 0, else parseAmount.
function parseAmount0(v) {
  const s = latin(v);
  if (s === '' || /^0+(\.0*)?$/.test(s)) return 0;
  return parseAmount(v);
}

// Plain editable form of halalas: 656019 → "6560.19", 100000 → "1000".
const plain = (h) => (h % 100 ? (h / 100).toFixed(2) : String(h / 100));

function latestBefore(state, month) {
  let src = null;
  for (const k of Object.keys(state.months)) if (k < month && (src === null || k > src)) src = k;
  return src;
}

// What a month will look like: a month with no record shows the auto-copy it would get on first
// write, computed on a shallow copy so browsing never creates records.
export function projectedState(state, month) {
  if (state.months[month]) return state;
  const copy = { ...state, months: { ...state.months } };
  ensureMonth(copy, month);
  return copy;
}

export function projectedSummary(state, month) {
  return monthSummary(projectedState(state, month), month);
}

function provKey(name) {
  const n = String(name).trim().toLowerCase();
  for (const [k, list] of Object.entries(PROV_ALIASES)) if (list.includes(n)) return k;
  return null;
}

export function mountExpenses(el, ctx) {
  const { state, save } = ctx;
  let t = ctx.t;
  let lang = ctx.lang;
  const nowMonth = () => monthOf(todayLocal());
  let cur = nowMonth();
  let tab = 'sum';
  let pick = null; // last chosen category in the log sheet
  let prov = 'tabby';
  const expanded = new Set();
  el.dataset.mounted = '1';

  const money = (h) => formatAmount(h, lang);
  const monthShort = (m) => {
    const [y, mo] = m.split('-').map(Number);
    const loc = lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-US';
    return new Intl.DateTimeFormat(loc, { month: lang === 'ar' ? 'long' : 'short' }).format(new Date(y, mo - 1, 1));
  };
  const provLabel = (name) => { const k = provKey(name); return k ? t(`prov.${k}`) : name; };
  const provClass = (name) => provKey(name) || '';
  const errMsg = (e, vars) => {
    const key = `err.${e && e.message}`;
    const s = t(key, vars);
    return s === key ? t('err.generic') : s;
  };
  const defDate = () => (monthOf(todayLocal()) === cur ? todayLocal() : `${cur}-15`);

  // Put the shared state object back to a snapshot (it is owned by app.js, so mutate in place).
  function restore(snap) {
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, snap);
  }

  // One write: fn() mutates state and returns the success toast. A thrown validation error or a
  // failed save rolls the in-memory state back to the snapshot, toasts, and leaves any sheet open.
  async function mutate(fn, { sheet = false, errVars, keepBud = false, onDone } = {}) {
    const snap = structuredClone(state);
    let msg;
    try { msg = fn(); } catch (err) { restore(snap); toast(errMsg(err, errVars)); return false; }
    try { await save(state); } catch { restore(snap); toast(t('err.save')); render(); return false; }
    if (sheet) closeSheet();
    if (onDone) onDone();
    render({ keepBud });
    if (msg) toast(msg);
    return true;
  }

  // ---------- static skeleton ----------
  function skeleton() {
    const rtl = lang === 'ar';
    el.innerHTML = `
<div class="row"><h1>${esc(t('nav.expenses'))}</h1><span class="sp"></span><button class="btn sec" type="button" id="mToday">${esc(t('month.current'))}</button></div>
<div class="mstrip"><button class="icon-btn" type="button" id="mPrev" aria-label="${esc(t('month.prev'))}">${rtl ? '›' : '‹'}</button><div class="mscroll" id="mscroll" role="tablist" aria-label="${esc(t('month.list'))}"></div><button class="icon-btn" type="button" id="mNext" aria-label="${esc(t('month.next'))}">${rtl ? '‹' : '›'}</button></div>
<div class="tabs" role="tablist" aria-label="${esc(t('tab.list'))}">${TABS.map(([k, key]) => `<button type="button" role="tab" data-tab="${k}">${esc(t(key))}</button>`).join('')}</div>
<p class="note ex-new" id="exNew" hidden></p>
<div id="t-sum" class="grid2">
 <div class="card hero" id="exHero">
  <div class="lbl">${esc(t('sum.remainingNow'))}</div>
  <div class="big" id="exLeft"></div>
  <div class="figs">
   <div><small>${esc(t('sum.income'))}</small><b id="fInc"></b></div>
   <div><small>${esc(t('sum.spent'))}</small><b id="fSpent"></b></div>
   <div><small>${esc(t('sum.budgetTotal'))}</small><b id="fBud"></b></div>
   <div><small>${esc(t('sum.remainingActual'))}</small><b id="fAct"></b></div>
  </div>
 </div>
 <div class="card"><h2>${esc(t('sum.cats'))}</h2><div id="exCats"></div></div>
</div>
<div id="t-tx" class="card"><h2>${esc(t('tx.title'))}</h2><div id="exTxs"></div></div>
<div id="t-ins" class="grid2">
 <div class="card"><h2 id="exDueTitle"></h2><div id="exDues"></div></div>
 <div class="card"><div class="row ex-plans-head"><h2>${esc(t('ins.plans'))}</h2><span class="sp"></span><button class="btn ex-small" type="button" id="exNewPlan">${esc(t('ins.add'))}</button></div><div id="exPlans"></div></div>
</div>
<div id="t-bud" class="card">
 <h2>${esc(t('bud.title'))}</h2>
 <label class="brow"><span><b>${esc(t('bud.income'))}</b></span><input type="text" inputmode="decimal" id="incIn" autocomplete="off"></label>
 <div id="exBuds"></div>
 <div class="addcat"><input type="text" id="catName" placeholder="${esc(t('bud.newCat'))}" aria-label="${esc(t('bud.newCat'))}"><button class="btn" type="button" id="addCat">${esc(t('bud.addCat'))}</button></div>
 <p class="note">${esc(t('bud.note'))}</p>
 <div class="row ex-copy"><button class="btn sec" type="button" id="copyPrev">${esc(t('bud.copyPrev'))}</button></div>
</div>`;
    sheets();
  }

  let logSheet = document.getElementById('logSheet');
  let planSheet = document.getElementById('planSheet');
  function sheets() {
    if (!logSheet) {
      logSheet = document.createElement('form');
      logSheet.className = 'sheet'; logSheet.id = 'logSheet'; logSheet.noValidate = true;
      document.body.appendChild(logSheet);
      planSheet = document.createElement('form');
      planSheet.className = 'sheet'; planSheet.id = 'planSheet'; planSheet.noValidate = true;
      document.body.appendChild(planSheet);
      wireSheets();
    }
    const close = `<button type="button" class="icon-btn" data-close aria-label="${esc(t('sheet.close'))}">✕</button>`;
    logSheet.setAttribute('aria-label', t('sheet.log.title'));
    logSheet.innerHTML = `
<div class="row"><h2 class="sheet-h">${esc(t('sheet.log.title'))}</h2><span class="sp"></span>${close}</div>
<div class="amt"><input id="logAmt" type="text" inputmode="decimal" placeholder="0" aria-label="${esc(t('sheet.log.amount'))}" autocomplete="off"><span>${esc(t('currency'))}</span></div>
<div class="ex-fullw"><button type="button" id="logFull" class="ex-full" hidden></button></div>
<div class="chips" id="logChips" role="group" aria-label="${esc(t('sheet.log.cat'))}"></div>
<div class="row ex-logrow"><div class="ex-date"><input type="date" id="logDate" aria-label="${esc(t('sheet.log.date'))}"></div><div class="ex-note"><input type="text" id="logNote" placeholder="${esc(t('sheet.log.note'))}" aria-label="${esc(t('sheet.log.note'))}" autocomplete="off"></div></div>
<button class="btn ex-wide" type="submit">${esc(t('sheet.log.submit'))}</button>`;
    planSheet.setAttribute('aria-label', t('sheet.plan.title'));
    planSheet.innerHTML = `
<div class="row"><h2 class="sheet-h">${esc(t('sheet.plan.title'))}</h2><span class="sp"></span>${close}</div>
<div class="fld"><span id="provL">${esc(t('plan.provider'))}</span><div class="chips ex-provs" id="provs" role="group" aria-labelledby="provL"></div></div>
<label class="fld" id="provOtherW" hidden>${esc(t('plan.providerName'))}<input type="text" id="provOther" placeholder="${esc(t('plan.providerHint'))}" autocomplete="off"></label>
<label class="fld">${esc(t('plan.item'))}<input type="text" id="pItem" placeholder="${esc(t('plan.itemHint'))}" autocomplete="off"></label>
<div class="two"><label class="fld">${esc(t('plan.monthly'))}<input type="text" inputmode="decimal" id="pMonthly" placeholder="0" autocomplete="off"></label>
<label class="fld">${esc(t('plan.months'))}<input type="text" inputmode="numeric" id="pN" value="4" autocomplete="off"></label></div>
<div class="chips ex-nchips" id="nChips"></div>
<label class="fld">${esc(t('plan.start'))}<input type="date" id="pStart"></label>
<label class="due ex-first"><input type="checkbox" id="pFirst" checked><span class="m">${esc(t('plan.firstPaid'))}</span></label>
<p class="note ex-prev" id="pPrev" aria-live="polite"></p>
<button class="btn ex-wide" type="submit">${esc(t('sheet.plan.submit'))}</button>`;
  }

  const $ = (sel) => document.querySelector(sel);

  // ---------- render ----------
  function renderStrip() {
    const now = nowMonth();
    const plans = state.plans.filter((p) => !p.deleted);
    const firsts = [...Object.keys(state.months), ...plans.map((p) => monthOf(p.start)), cur, now].sort();
    const lasts = [addMonth(now, 12), cur, ...plans.map((p) => addMonth(monthOf(p.start), p.n - 1))].sort();
    const end = lasts[lasts.length - 1];
    const out = [];
    for (let m = addMonth(firsts[0], -1); m <= end; m = addMonth(m, 1)) {
      const has = !!state.months[m] || dueIn(state, m).length > 0;
      const cls = [m === cur && 'on', has && 'has', m === now && 'today'].filter(Boolean).join(' ');
      const y = m.slice(0, 4);
      out.push(`<button type="button" role="tab" data-m="${m}" class="${cls}" aria-selected="${m === cur}" aria-label="${esc(monthName(m, lang))}">${esc(monthShort(m))}<small>${m.endsWith('-01') || m === cur ? y : '&nbsp;'}</small></button>`);
    }
    $('#mscroll').innerHTML = out.join('');
    centerStrip();
  }

  function centerStrip() {
    const sc = $('#mscroll');
    const on = sc && sc.querySelector('.on');
    if (!on) return;
    const r = on.getBoundingClientRect(); const q = sc.getBoundingClientRect();
    if (!q.width) return;
    sc.scrollBy({ left: (r.left + r.width / 2) - (q.left + q.width / 2), behavior: 'auto' });
  }

  function renderSummary(view, sum) {
    const cur$ = esc(t('currency'));
    $('#exLeft').innerHTML = `${esc(money(sum.remainingNow))} <span>${cur$}</span>`;
    $('#fInc').textContent = money(sum.income);
    $('#fSpent').textContent = money(sum.spent);
    $('#fBud').textContent = money(sum.budgetTotal);
    $('#fAct').textContent = money(sum.remainingActual);
    const rows = sum.rows.map((r) => ({ label: catLabel(getCategory(view, r.catId), t), s: r.spent, b: r.budget }))
      .concat(providerRows(sum.providers))
      .filter((r) => r.s || r.b);
    $('#exCats').innerHTML = rows.length ? rows.map(({ label, s, b }) => {
      const over = s > b;
      const w = b ? Math.min(100, (s / b) * 100) : 100;
      return `<div class="cat"><div class="t"><span>${esc(label)}</span><span>${esc(t('sum.of', { spent: money(s), budget: money(b) }))}</span></div>`
        + `<div class="bar"><i class="${over ? 'over' : ''}" style="width:${w}%"></i></div>`
        + `${over ? `<div class="over-t">${esc(t('sum.over', { amount: money(s - b) }))}</div>` : ''}</div>`;
    }).join('') : `<p class="note">${esc(t('sum.empty'))}</p>`;
  }

  // Merge provider rows that name the same known provider (canonical 'tabby' and legacy «تابي»).
  function providerRows(providers) {
    const by = new Map();
    for (const p of providers) {
      const key = provKey(p.provider) || p.provider;
      const r = by.get(key) || { label: t('sum.provider', { provider: provLabel(p.provider) }), s: 0, b: 0 };
      r.s += p.paid; r.b += p.due;
      by.set(key, r);
    }
    return [...by.values()];
  }

  function renderTx(due) {
    const live = state.tx.filter((x) => !x.deleted && x.month === cur)
      .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
    const txHtml = live.map((x) => {
      const c = getCategory(state, x.catId);
      const label = c ? catLabel(c, t) : '';
      return `<div class="tx"><span class="ic">${icon('tag')}</span><div class="m">${esc(label)}<small>${esc(x.date)}${x.note ? ` · ${esc(x.note)}` : ''}</small></div>`
        + `<span class="a">${esc(money(x.amount))}</span><button type="button" class="icon-btn" data-del="${esc(x.id)}" aria-label="${esc(t('tx.delete'))}">${icon('trash')}</button></div>`;
    }).join('');
    const insHtml = due.filter((d) => d.paid).map((d) => `<div class="tx"><span class="ic">${icon('clock')}</span><div class="m">${esc(t('sum.provider', { provider: provLabel(d.plan.provider) }))} · ${esc(d.plan.item)}<small>${esc(t('tx.installment', { k: d.k + 1, n: d.plan.n }))}</small></div><span class="a">${esc(money(d.amount))}</span><span class="ex-gap"></span></div>`).join('');
    $('#exTxs').innerHTML = txHtml || insHtml ? txHtml + insHtml : `<p class="note">${esc(t('tx.empty'))}</p>`;
  }

  function schedHtml(plan) {
    const rows = schedule(plan);
    const chip = (r) => `<span class="${[r.paid && 'paid', r.month === cur && 'now'].filter(Boolean).join(' ')}">${esc(monthShort(r.month))} ${r.month.slice(2, 4)} · ${esc(money(r.amount))}</span>`;
    if (plan.n <= 8) return rows.map(chip).join('');
    if (expanded.has(plan.id)) return rows.map(chip).join('') + `<button type="button" class="more" data-less="${esc(plan.id)}">${esc(t('ins.hide'))}</button>`;
    let c = rows.findIndex((r) => !r.paid);
    if (c < 0) c = plan.n - 1;
    const a = Math.max(0, Math.min(c - 1, plan.n - 6));
    return rows.slice(a, a + 6).map(chip).join('') + `<button type="button" class="more" data-more="${esc(plan.id)}">${esc(t('ins.showAll', { n: plan.n }))}</button>`;
  }

  function renderIns(due) {
    $('#exDueTitle').textContent = t('ins.dueIn', { month: monthName(cur, lang) });
    const dueAll = due.reduce((a, d) => a + d.amount, 0);
    const duePaid = due.reduce((a, d) => a + (d.paid ? d.amount : 0), 0);
    $('#exDues').innerHTML = due.length ? due.map((d) => `<label class="due ${d.paid ? 'done' : ''}"><input type="checkbox" data-pay="${esc(d.plan.id)}:${d.k}" ${d.paid ? 'checked' : ''}>`
      + `<span class="m">${esc(d.plan.item)} <span class="prov ${provClass(d.plan.provider)}">${esc(provLabel(d.plan.provider))}</span>`
      + `<small>${esc(t('tx.installment', { k: d.k + 1, n: d.plan.n }))} · ${esc(t(d.paid ? 'ins.paid' : 'ins.unpaid'))}</small></span><b class="ex-nowrap">${esc(money(d.amount))}</b></label>`).join('')
      + `<p class="note">${esc(t('ins.totals', { due: money(dueAll), paid: money(duePaid) }))}</p>`
      : `<p class="note">${esc(t('ins.noneDue'))}</p>`;
    const plans = state.plans.filter((p) => !p.deleted);
    $('#exPlans').innerHTML = plans.length ? plans.map((p) => {
      const paidN = p.paid.filter(Boolean).length;
      const rem = remaining(p);
      return `<div class="plan"><div class="t"><span class="prov ${provClass(p.provider)}">${esc(provLabel(p.provider))}</span><b>${esc(p.item)}</b>`
        + `<button type="button" class="icon-btn" data-pdel="${esc(p.id)}" aria-label="${esc(t('ins.deletePlan'))}">${icon('trash')}</button></div>`
        + `<div class="cat ex-prog"><div class="t"><span>${esc(t('ins.progress', { paid: paidN, n: p.n }))}</span><span>${esc(rem ? t('ins.left', { amount: money(rem) }) : t('ins.done'))}</span></div>`
        + `<div class="bar"><i style="width:${(paidN / p.n) * 100}%"></i></div></div><div class="sched">${schedHtml(p)}</div></div>`;
    }).join('') : `<p class="note">${esc(t('ins.noPlans'))}</p>`;
  }

  function renderBud(view) {
    const rec = view.months[cur] || { income: 0, budget: {} };
    $('#incIn').value = plain(rec.income);
    $('#incIn').setAttribute('aria-label', t('bud.income'));
    $('#exBuds').innerHTML = liveCats(state).map((c) => {
      const label = catLabel(c, t);
      return `<div class="brow"><span>${esc(label)}</span><input type="text" inputmode="decimal" autocomplete="off" data-b="${esc(c.id)}" value="${esc(plain(rec.budget[c.id] || 0))}" aria-label="${esc(t('bud.budgetFor', { cat: label }))}">`
        + `<button type="button" class="icon-btn" data-cdel="${esc(c.id)}" aria-label="${esc(t('bud.deleteCat', { cat: label }))}">${icon('trash')}</button></div>`;
    }).join('');
  }

  function renderChips() {
    const cats = liveCats(state);
    if (!cats.some((c) => c.id === pick)) {
      // Default: the category of the most recently logged spending, else «المصروف», else the first.
      let last = null;
      for (const x of state.tx) if (!x.deleted && (!last || x.updatedAt >= last.updatedAt)) last = x;
      const def = (last && cats.find((c) => c.id === last.catId))
        || cats.find((c) => c.nameKey === 'cat.allowance') || cats[0];
      pick = def ? def.id : null;
    }
    $('#logChips').innerHTML = cats.map((c) => `<button type="button" data-c="${esc(c.id)}" class="${c.id === pick ? 'on' : ''}" aria-pressed="${c.id === pick}">${esc(catLabel(c, t))}</button>`).join('');
    renderFull();
  }

  // What is left of the picked category's budget in the month of the chosen date.
  function fullLeft() {
    const d = $('#logDate').value;
    const m = /^\d{4}-\d{2}-\d{2}$/.test(d) ? monthOf(d) : cur;
    const row = projectedSummary(state, m).rows.find((r) => r.catId === pick);
    return row ? row.left : 0;
  }

  function renderFull() {
    const b = $('#logFull');
    const left = fullLeft();
    b.hidden = !(left > 0);
    if (left > 0) b.textContent = t('sheet.log.full', { amount: money(left) });
  }

  function render({ keepBud = false } = {}) {
    const view = projectedState(state, cur);
    const sum = monthSummary(view, cur);
    const due = dueIn(state, cur);
    renderStrip();
    const newNote = $('#exNew');
    if (state.months[cur]) newNote.hidden = true;
    else {
      const prev = latestBefore(state, cur);
      newNote.textContent = prev ? t('month.newCopy', { prev: monthName(prev, lang) }) : t('month.newEmpty');
      newNote.hidden = false;
    }
    renderSummary(view, sum);
    renderTx(due);
    renderIns(due);
    if (!keepBud) renderBud(view);
    for (const [k] of TABS) el.querySelector(`#t-${k}`).hidden = k !== tab;
    el.querySelectorAll('.tabs button').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    renderChips();
    dispatchEvent(new CustomEvent('toolbox:expenses-changed'));
  }

  function go(k) { cur = addMonth(cur, k); render(); }
  const isOn = () => el.classList.contains('on');
  const sheetOpen = () => !!document.querySelector('.sheet.on');

  // ---------- view events ----------
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !el.contains(b)) return;
    if (b.id === 'mPrev') return go(-1);
    if (b.id === 'mNext') return go(1);
    if (b.id === 'mToday') { cur = nowMonth(); render(); toast(t('month.back', { month: monthName(cur, lang) })); return; }
    if (b.dataset.m) { cur = b.dataset.m; render(); return; }
    if (b.dataset.tab) { tab = b.dataset.tab; render(); return; }
    if (b.id === 'exNewPlan') { openPlan(); return; }
    if (b.dataset.more) { expanded.add(b.dataset.more); render(); return; }
    if (b.dataset.less) { expanded.delete(b.dataset.less); render(); return; }
    if (b.dataset.del) { const id = b.dataset.del; await mutate(() => { deleteTx(state, id); return t('toast.txDeleted'); }); return; }
    if (b.dataset.pdel) { const id = b.dataset.pdel; await mutate(() => { deletePlan(state, id); return t('toast.planDeleted'); }); return; }
    if (b.dataset.cdel) {
      const id = b.dataset.cdel;
      const label = catLabel(getCategory(state, id), t);
      await mutate(() => { deleteCategory(state, id); return t('toast.catDeleted', { cat: label }); }, { errVars: { cat: label } });
      return;
    }
    if (b.id === 'addCat') { await addCat(); return; }
    if (b.id === 'copyPrev') {
      const prev = latestBefore(state, cur);
      if (!prev) { toast(t('toast.noPrev')); return; }
      await mutate(() => {
        const src = state.months[prev].budget;
        ensureMonth(state, cur);
        for (const c of liveCats(state)) setBudget(state, cur, c.id, src[c.id] || 0);
        return t('toast.copied', { month: monthName(prev, lang) });
      });
    }
  });

  async function addCat() {
    const input = $('#catName');
    const ok = await mutate(() => {
      const id = addCategory(state, input.value);
      return t('toast.catAdded', { cat: catLabel(getCategory(state, id), t) });
    }, { onDone: () => { input.value = ''; } });
    if (!ok) input.focus();
  }

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'catName') { e.preventDefault(); addCat(); }
  });

  el.addEventListener('change', async (e) => {
    const x = e.target;
    if (x.dataset.pay) {
      const [pid, k] = x.dataset.pay.split(':');
      const paid = x.checked;
      await mutate(() => { setPaid(state, pid, Number(k), paid); return t(paid ? 'toast.paid' : 'toast.unpaid'); });
      return;
    }
    if (x.id !== 'incIn' && !x.dataset.b) return;
    const ok = await mutate(() => {
      const h = parseAmount0(x.value);
      if (x.id === 'incIn') setIncome(state, cur, h); else setBudget(state, cur, x.dataset.b, h);
      x.value = plain(h);
      return '';
    }, { keepBud: true });
    if (!ok) render(); // put the stored value back into the input
  });

  // Swipe between months: RTL finger → right = next; LTR mirrored.
  let x0 = null; let y0 = 0;
  el.addEventListener('touchstart', (e) => {
    if (e.target.closest('.mscroll,input,.tabs') || e.touches.length !== 1) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 45) go((dx > 0) === (lang === 'ar') ? 1 : -1);
  }, { passive: true });

  addEventListener('keydown', (e) => {
    if (!isOn() || sheetOpen() || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest && e.target.closest('input,select,textarea,[contenteditable]')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = lang === 'ar' ? 'ArrowLeft' : 'ArrowRight';
    go(e.key === next ? 1 : -1);
  });

  addEventListener('toolbox:route', (e) => { if (e.detail && e.detail.view === 'expenses') centerStrip(); });

  // ---------- sheets ----------
  function openLog() {
    $('#logAmt').value = '';
    $('#logNote').value = '';
    $('#logDate').value = defDate();
    renderChips();
    openSheet(logSheet);
    setTimeout(() => { if (logSheet.classList.contains('on')) $('#logAmt').focus(); }, 250);
  }

  function renderProvs() {
    $('#provs').innerHTML = PROVS.map((p) => `<button type="button" data-p="${p}" class="${p === prov ? 'on' : ''}" aria-pressed="${p === prov}">${esc(t(`prov.${p}`))}</button>`).join('');
    $('#provOtherW').hidden = prov !== 'other';
  }

  const readN = () => { const s = latin($('#pN').value); return /^\d+$/.test(s) ? Number(s) : NaN; };

  function preview() {
    const n = readN();
    $('#nChips').innerHTML = N_CHIPS.map((x) => `<button type="button" data-n="${x}" class="${x === n ? 'on' : ''}">${esc(t(x > 10 ? 'plan.monthsMany' : 'plan.monthsFew', { n: x }))}</button>`).join('');
    const out = $('#pPrev');
    out.removeAttribute('data-last');
    if (!(n >= 1 && n <= 48)) { out.textContent = t('err.invalid-months'); return; }
    let monthly = 0;
    try { monthly = parseAmount($('#pMonthly').value); } catch { monthly = 0; }
    const start = $('#pStart').value || `${cur}-01`;
    const last = addMonth(monthOf(start), n - 1);
    out.dataset.last = last;
    out.textContent = monthly > 0
      ? t('plan.preview', { n, amount: money(monthly), total: money(monthly * n), last: monthName(last, lang) })
      : t('plan.previewEmpty');
  }

  function openPlan() {
    for (const id of ['#pItem', '#pMonthly', '#provOther']) $(id).value = '';
    $('#pStart').value = defDate();
    $('#pFirst').checked = true;
    $('#pN').value = '4';
    prov = 'tabby';
    renderProvs();
    preview();
    openSheet(planSheet);
  }

  function wireSheets() {
    for (const s of [logSheet, planSheet]) {
      s.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
    }
    logSheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      pick = b.dataset.c;
      renderChips();
    });
    logSheet.addEventListener('click', (e) => {
      if (!e.target.closest('#logFull')) return;
      const left = fullLeft();
      if (left > 0) { $('#logAmt').value = formatAmount(left, 'en'); $('#logAmt').focus(); }
    });
    logSheet.addEventListener('change', (e) => { if (e.target.id === 'logDate') renderFull(); });
    logSheet.addEventListener('submit', async (e) => {
      e.preventDefault();
      // Validate everything before touching the month, so a rejected entry leaves no month record.
      let amount;
      try { amount = parseAmount($('#logAmt').value); } catch (err) { toast(errMsg(err)); $('#logAmt').focus(); return; }
      const date = $('#logDate').value || defDate();
      const cat = getCategory(state, pick);
      if (!cat || cat.deleted || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast(errMsg(new Error('invalid-tx'))); return; }
      const note = $('#logNote').value.trim();
      await mutate(() => {
        ensureMonth(state, monthOf(date)); // first write to a month creates it (auto-copy)
        addTx(state, { catId: cat.id, amount, date, note });
        return t('toast.logged', { amount: formatAmount(amount, lang), cat: catLabel(cat, t) });
      }, { sheet: true, onDone: () => { cur = monthOf(date); } });
    });
    planSheet.addEventListener('click', (e) => {
      const p = e.target.closest('[data-p]');
      if (p) { prov = p.dataset.p; renderProvs(); return; }
      const n = e.target.closest('[data-n]');
      if (n) { $('#pN').value = n.dataset.n; preview(); }
    });
    planSheet.addEventListener('input', (e) => { if (['pMonthly', 'pN', 'pStart'].includes(e.target.id)) preview(); });
    planSheet.addEventListener('change', (e) => { if (e.target.id === 'pStart') preview(); });
    planSheet.addEventListener('submit', async (e) => {
      e.preventDefault();
      // The user enters the monthly payment; the plan stores the total (monthly × n), so every payment is equal.
      let monthly;
      try { monthly = parseAmount($('#pMonthly').value); } catch (err) { toast(errMsg(err)); $('#pMonthly').focus(); return; }
      const n = readN();
      // Known providers are stored as canonical ids ('tabby' / 'tamara'); a custom name stays as typed.
      const provider = prov === 'other' ? ($('#provOther').value.trim() || t('prov.other')) : prov;
      const item = $('#pItem').value.trim() || t('plan.defaultItem');
      const start = $('#pStart').value || `${cur}-01`;
      if (!(n >= 1 && n <= 48)) { toast(errMsg(new Error('invalid-months'))); $('#pN').focus(); return; }
      const firstPaid = $('#pFirst').checked;
      const total = monthly * n;
      await mutate(() => {
        addPlan(state, { provider, item, total, n, start, firstPaid });
        return t('toast.planAdded', { provider: provLabel(provider), n, amount: money(paymentAmount({ total, n }, 0)) });
      }, { sheet: true });
    });
  }

  skeleton();
  render();

  return {
    // Re-localise (language change). Keeps the month, tab and open state.
    update(next = {}) {
      if (next.t) t = next.t;
      if (next.lang) lang = next.lang;
      const wasOpen = document.querySelector('.sheet.on');
      if (wasOpen && (wasOpen === logSheet || wasOpen === planSheet)) closeSheet(false);
      skeleton();
      render();
    },
    render,
    openLog,
    openPlan,
    // FAB: «أضف قسط» on the installments tab, «سجّل صرف» otherwise.
    fab() { if (tab === 'ins' && isOn()) openPlan(); else openLog(); },
    get month() { return cur; },
  };
}
