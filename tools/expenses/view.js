// Expenses screens: month strip / picker, Summary / Transactions / Installments / Budget / Reports,
// and the «سجّل صرف» / «أضف قسط» / «مصروف ثابت» sheets. On a phone one tab shows at a time; on a PC
// (see `wide`) the first three are one board and Budget / Reports open on their own.
// Reads through monthSummary (pure); every write goes through the model functions, then
// ctx.save(state), then a re-render. Deletes offer «تراجع».
import { formatAmount, parseAmount } from '../../core/money.js';
import { monthName } from '../../core/i18n.js';
import { addCategory, deleteCategory, addTx, deleteTx, liveCats, getCategory, catLabel, restoreRecord, suggestSplit, setCategoryColor, CAT_COLORS } from '../../core/model.js';
import {
  addMonth, todayLocal, ensureMonth, setIncome, setBudget, periodOf, periodBounds, periodProgress,
  monthStartOf, setMonthStart, txMonth, daysBetween, startOk,
} from '../../core/months.js';
import { addPlan, schedule, dueIn, setPaid, deletePlan, remaining, paymentAmount, nextPayment, overduePayments, markPaidBefore } from './installments.js';
import { monthSummary, projectedState } from './calc.js';
import { addFixed, setFixedActive, deleteFixed, liveFixed, applyFixed } from './fixed.js';
import { history as monthHistory, historyStats, exportCsv, categoryAverages } from './reports.js';
import { toast, openSheet, closeSheet, fieldError, clearFieldError } from '../../core/ui.js';

export { projectedState };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const latin = (v) => String(v ?? '').trim().replace(/[٠-٩]/g, (d) => DIGITS[d]).replace(/٫/g, '.');
const TABS = [['sum', 'tab.summary'], ['tx', 'tab.tx'], ['ins', 'tab.installments'], ['bud', 'tab.budget'], ['rep', 'tab.reports']];
const ALONE = new Set(['bud', 'rep']); // PC: shown on their own instead of the board
const PROVS = ['tabby', 'tamara', 'other'];
const N_CHIPS = [3, 4, 6, 12, 24, 36, 48];
const PROV_ALIASES = { tabby: ['تابي', 'tabby'], tamara: ['تمارا', 'tamara'] };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAYDAY = 27; // offered first when switching to «يوم الراتب» (most salaries in KSA land on the 27th)

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

export function projectedSummary(state, month) {
  return monthSummary(projectedState(state, month), month);
}

function provKey(name) {
  const n = String(name).trim().toLowerCase();
  for (const [k, list] of Object.entries(PROV_ALIASES)) if (list.includes(n)) return k;
  return null;
}

// Arabic count wording: 1, 2, 3–10, 11+ (English uses the same keys).
export function countKey(prefix, n) {
  if (n === 1) return `${prefix}.1`;
  if (n === 2) return `${prefix}.2`;
  return n <= 10 ? `${prefix}.few` : `${prefix}.many`;
}

export function mountExpenses(el, ctx) {
  const { state, save } = ctx;
  let t = ctx.t;
  let lang = ctx.lang;
  const start = () => monthStartOf(state);
  const nowMonth = () => periodOf(todayLocal(), start());
  let cur = monthFromHash() || nowMonth();
  let tab = 'sum';
  // PC (wider than a phone): no tabs, one board. Must match the 821px breakpoint in core/theme.css.
  const wide = matchMedia('(min-width: 821px)');
  let pick = null; // last chosen category in the log sheet
  let fxPick = null; // category in the fixed-expense sheet
  let prov = 'tabby';
  let txFilter = 'all'; // 'all' | category id | 'ins'
  let txQuery = '';
  let colorFor = null; // budget: the category whose colour picker is open
  let txAll = false; // «عرض كل الحركات»: else the board shows the latest TX_LIMIT
  const TX_LIMIT = 10;
  const SETUP_LATER = 'toolbox.setupLater'; // «أكمل لاحقاً» on this device (a convenience, not data)
  const setupLater = () => { try { return localStorage.getItem(SETUP_LATER) === '1'; } catch { return false; } };
  let repTable = false;
  let pickYear = null; // month picker open → the year it shows
  const expanded = new Set();
  el.dataset.mounted = '1';

  const money = (h) => formatAmount(h, lang);
  const loc = () => (lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-US');
  const asDate = (d) => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  const monthShort = (m) => {
    const [y, mo] = m.split('-').map(Number);
    return new Intl.DateTimeFormat(loc(), { month: lang === 'ar' ? 'long' : 'short' }).format(new Date(y, mo - 1, 1));
  };
  const dayMonth = (d) => new Intl.DateTimeFormat(loc(), { day: 'numeric', month: 'long' }).format(asDate(d));
  // «اليوم، الخميس 19 نوفمبر» / «أمس، …» / «الخميس 19 نوفمبر» (+ year when not this year).
  function dateLabel(d, { prefix = true } = {}) {
    const today = todayLocal();
    const opts = { day: 'numeric', month: 'long' };
    if (d.slice(0, 4) !== today.slice(0, 4)) opts.year = 'numeric';
    const wd = new Intl.DateTimeFormat(loc(), { weekday: 'long' }).format(asDate(d));
    const s = `${wd} ${new Intl.DateTimeFormat(loc(), opts).format(asDate(d))}`;
    if (!prefix) return s;
    const diff = daysBetween(d, today);
    const sep = lang === 'ar' ? '، ' : ', ';
    if (diff === 0) return `${t('day.today')}${sep}${s}`;
    if (diff === 1) return `${t('day.yesterday')}${sep}${s}`;
    return s;
  }
  const daysText = (n) => (n === 1 ? t('days.last') : n === 2 ? t('days.two') : t(n <= 10 ? 'days.few' : 'days.many', { n }));
  const soonText = (n) => (n === 0 ? t('soon.today') : t(countKey('soon', n), { n }));
  const provLabel = (name) => { const k = provKey(name); return k ? t(`prov.${k}`) : name; };
  const provClass = (name) => provKey(name) || '';
  const errMsg = (e, vars) => {
    const key = `err.${e && e.message}`;
    const s = t(key, vars);
    return s === key ? t('err.generic') : s;
  };
  // A date inside the shown month for new entries: today in the current month, else a day of `cur`.
  const defDate = () => (cur === nowMonth() ? todayLocal() : `${cur}-${start() > 1 ? '01' : '15'}`);

  function monthFromHash() {
    const m = /^#expenses\/(\d{4}-(0[1-9]|1[0-2]))$/.exec(location.hash);
    return m ? m[1] : null;
  }

  // Put the shared state object back to a snapshot (it is owned by app.js, so mutate in place).
  function restore(snap) {
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, snap);
  }

  // One write: fn() mutates state and returns the success toast. A thrown validation error or a
  // failed save rolls the in-memory state back to the snapshot, toasts, and leaves any sheet open.
  // undo: a function that reverses the write; the toast then offers «تراجع».
  async function mutate(fn, { sheet = false, errVars, keepBud = false, onDone, undo } = {}) {
    const snap = structuredClone(state);
    let msg;
    try { msg = fn(); } catch (err) { restore(snap); toast(errMsg(err, errVars)); return false; }
    try { await save(state); } catch { restore(snap); toast(t('err.save')); render(); return false; }
    if (sheet) closeSheet();
    if (onDone) onDone();
    render({ keepBud });
    if (msg && undo) toast(msg, { action: { label: t('toast.undo'), run: () => mutate(() => { undo(); return t('toast.undone'); }) } });
    else if (msg) toast(msg);
    return true;
  }

  // ---------- static skeleton ----------
  function skeleton() {
    const rtl = lang === 'ar';
    el.innerHTML = `
<div class="row ex-head"><h1>${esc(t('nav.expenses'))}</h1>
<div class="mstrip"><button class="icon-btn" type="button" id="mPrev" aria-label="${esc(t('month.prev'))}">${rtl ? '›' : '‹'}</button><div class="mscroll" id="mscroll" role="tablist" aria-label="${esc(t('month.list'))}"></div><button class="icon-btn" type="button" id="mNext" aria-label="${esc(t('month.next'))}">${rtl ? '‹' : '›'}</button>
<div class="mpick gl" id="mPick" role="dialog" aria-label="${esc(t('month.pick'))}" hidden></div></div>
<span class="sp"></span><button class="btn sec" type="button" id="mToday">${esc(t('month.current'))}</button><button class="btn sec ex-pc" type="button" id="exRepBtn" aria-pressed="false"></button><button class="btn sec ex-pc" type="button" id="exBudBtn" aria-pressed="false"></button><button class="btn ex-log ex-pc" type="button" id="exLog">${icon('plus')}<span>${esc(t('sheet.log.title'))}</span><kbd class="ex-kbd" aria-hidden="true">N</kbd></button></div>
<div class="tabs" role="tablist" aria-label="${esc(t('tab.list'))}">${TABS.map(([k, key]) => `<button type="button" role="tab" id="tab-${k}" aria-controls="t-${k}" data-tab="${k}">${esc(t(key))}</button>`).join('')}</div>
<p class="note ex-new" id="exNew" hidden></p>
<div class="ex-board">
<div id="t-sum" class="grid2" role="tabpanel" aria-labelledby="tab-sum">
 <div class="card hero" id="exHero">
  <div class="lbl">${esc(t('sum.remainingNow'))}<button type="button" class="info-btn" popovertarget="exInfo" aria-label="${esc(t('sum.info'))}">${icon('info')}</button></div>
  <div class="big" id="exLeft"></div>
  <div class="ex-meter" id="exMeterW"><div class="bar"><i id="exMeter"></i></div><span class="ex-now" id="exNow"></span></div>
  <p class="ex-pace" id="exPace"></p>
  <div class="ex-daily" id="exDaily" hidden>${icon('cal')}<div><b id="exDailyAmt"></b> <span id="exDailyLbl"></span><small id="exDailySub"></small></div></div>
  <div class="ex-top" id="exTop" hidden></div>
  <div class="figs">
   <div><small>${esc(t('sum.income'))}</small><b id="fInc"></b></div>
   <div><small>${esc(t('sum.spent'))}</small><b id="fSpent"></b></div>
   <div><small>${esc(t('sum.budgetTotal'))}</small><b id="fBud"></b></div>
   <div><small>${esc(t('sum.remainingActual'))}</small><b id="fAct"></b></div>
  </div>
 </div>
 <div class="card ex-setup" id="exSetup" hidden></div>
 <div class="card ex-cats"><div class="row ex-card-head"><h2>${esc(t('sum.cats'))}</h2><span class="sp"></span><span class="ex-legend" id="exLegend"></span></div><div id="exCats"></div></div>
</div>
<div id="exInfo" class="pop gl" popover><h2>${esc(t('sum.infoTitle'))}</h2><dl>
 <dt>${esc(t('sum.remainingNow'))}</dt><dd>${esc(t('sum.infoNow'))}</dd>
 <dt>${esc(t('sum.spent'))}</dt><dd>${esc(t('sum.infoSpent'))}</dd>
 <dt>${esc(t('sum.budgetTotal'))}</dt><dd>${esc(t('sum.infoPlanned'))}</dd>
 <dt>${esc(t('sum.remainingActual'))}</dt><dd>${esc(t('sum.infoAfter'))}</dd></dl>
 <button type="button" class="btn sec" popovertarget="exInfo" popovertargetaction="hide">${esc(t('sheet.close'))}</button></div>
<div id="t-tx" class="card" role="tabpanel" aria-labelledby="tab-tx">
 <div class="row ex-card-head"><h2>${esc(t('tx.title'))}</h2><span class="sp"></span><label class="ex-search">${icon('search')}<input type="search" id="txQ" placeholder="${esc(t('tx.searchPh'))}" aria-label="${esc(t('tx.search'))}" autocomplete="off"></label></div>
 <select class="ex-tfilter" id="txF" aria-label="${esc(t('tx.filter'))}"></select>
 <div id="exTxs"></div>
 <button type="button" class="btn sec ex-more" id="txMore" hidden></button>
</div>
<div id="t-ins" class="grid2" role="tabpanel" aria-labelledby="tab-ins">
 <div class="card ex-next" id="exNextCard" hidden><h2>${esc(t('ins.next'))}</h2><div id="exNext"></div></div>
 <div class="card"><h2 id="exDueTitle"></h2><div id="exDues"></div></div>
 <div class="card"><div class="row ex-plans-head"><h2>${esc(t('ins.plans'))}</h2><span class="sp"></span><button class="btn ex-small" type="button" id="exNewPlan">${esc(t('ins.add'))}</button></div><div id="exPlans"></div></div>
</div>
<div id="t-bud" class="card" role="tabpanel" aria-labelledby="tab-bud">
 <h2>${esc(t('bud.title'))}</h2>
 <div class="ex-suggest" id="budSuggest" hidden>${icon('chart')}<div><b>${esc(t('bud.suggestTitle'))}</b><small id="budSuggestSub"></small></div><button type="button" class="btn ex-small" id="useAll">${esc(t('bud.useAll'))}</button></div>
 <label class="brow"><span><b>${esc(t('bud.income'))}</b></span><input type="text" inputmode="decimal" id="incIn" autocomplete="off"></label>
 <div id="exBuds"></div>
 <p class="ex-budtotal" id="budTotal"></p>
 <div class="addcat"><input type="text" id="catName" placeholder="${esc(t('bud.newCat'))}" aria-label="${esc(t('bud.newCat'))}" autocomplete="off"><button class="btn" type="button" id="addCat">${esc(t('bud.addCat'))}</button></div>
 <p class="note">${esc(t('bud.note'))}</p>
 <div class="row ex-copy"><button class="btn sec" type="button" id="copyPrev">${esc(t('bud.copyPrev'))}</button></div>
 <div class="ex-mscard" id="msCard"><h3>${esc(t('ms.title'))}</h3><p class="note ex-sub">${esc(t('ms.sub'))}</p>
  <div class="seg" role="radiogroup" aria-label="${esc(t('ms.title'))}"><button type="button" role="radio" data-ms="first">${esc(t('ms.first'))}</button><button type="button" role="radio" data-ms="payday">${esc(t('ms.payday'))}</button></div>
  <label class="brow ex-msday" id="msDayW"><span>${esc(t('ms.day'))}</span><select id="msDay">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}<option value="31">${esc(t('wel.payLast'))}</option></select></label>
  <p class="ex-msrange" id="msRange"></p></div>
</div>
<div id="t-rep" class="ex-rep" role="tabpanel" aria-labelledby="tab-rep">
 <div class="row ex-rep-head"><h2>${esc(t('tab.reports'))}</h2><span class="sp"></span><button class="btn sec ex-icon-btn" type="button" id="exExport">${icon('dl')}<span>${esc(t('rep.export'))}</span></button></div>
 <div class="ex-rep-grid">
  <div class="card ex-chart-card"><div class="row ex-card-head"><h2>${esc(t('rep.chart'))}</h2><span class="sp"></span><button class="ex-link" type="button" id="repView" aria-pressed="false"></button></div><p class="note ex-rep-stats" id="repStats"></p><div id="repChart"></div></div>
  <div class="ex-rep-side">
   <div class="card" id="fxCard"><div class="row ex-plans-head"><h2>${esc(t('fx.title'))}</h2><span class="sp"></span><button class="btn ex-small" type="button" id="fxAdd">${esc(t('fx.add'))}</button></div><p class="note ex-sub">${esc(t('fx.sub'))}</p><div id="fxList"></div></div>
  </div>
 </div>
</div>
</div>`;
    sheets();
  }

  let logSheet = document.getElementById('logSheet');
  let planSheet = document.getElementById('planSheet');
  let fxSheet = document.getElementById('fxSheet');
  const dfield = (id, label) => `<label class="dfield">${icon('cal')}<span id="${id}Txt" aria-hidden="true"></span><input type="date" id="${id}" aria-label="${esc(label)}"></label>`;
  function sheets() {
    if (!logSheet) {
      const mk = (id) => {
        const f = document.createElement('form');
        f.className = 'sheet'; f.id = id; f.noValidate = true;
        document.body.appendChild(f);
        return f;
      };
      logSheet = mk('logSheet'); planSheet = mk('planSheet'); fxSheet = mk('fxSheet');
      wireSheets();
    }
    const close = `<button type="button" class="icon-btn" data-close aria-label="${esc(t('sheet.close'))}">✕</button>`;
    logSheet.setAttribute('aria-label', t('sheet.log.title'));
    logSheet.innerHTML = `
<div class="row"><h2 class="sheet-h">${esc(t('sheet.log.title'))}</h2><span class="sp"></span>${close}</div>
<div class="amt"><input id="logAmt" type="text" inputmode="decimal" placeholder="0" aria-label="${esc(t('sheet.log.amount'))}" autocomplete="off"><span>${esc(t('currency'))}</span></div>
<div class="ex-fullw"><button type="button" id="logFull" class="ex-full" hidden></button></div>
<div class="chips" id="logChips" role="group" aria-label="${esc(t('sheet.log.cat'))}"></div>
<div class="row ex-logrow"><div class="ex-date">${dfield('logDate', t('sheet.log.date'))}</div><div class="ex-note"><input type="text" id="logNote" placeholder="${esc(t('sheet.log.notePh'))}" aria-label="${esc(t('sheet.log.note'))}" autocomplete="off"></div></div>
<button class="btn ex-wide" type="submit">${esc(t('sheet.log.submit'))}<kbd class="ex-kbd" aria-hidden="true">Enter</kbd></button>
<p class="ex-keys" aria-hidden="true">${esc(t('sheet.log.keys'))}</p>`;
    planSheet.setAttribute('aria-label', t('sheet.plan.title'));
    planSheet.innerHTML = `
<div class="row"><h2 class="sheet-h">${esc(t('sheet.plan.title'))}</h2><span class="sp"></span>${close}</div>
<div class="fld"><span id="provL">${esc(t('plan.provider'))}</span><div class="chips ex-provs" id="provs" role="group" aria-labelledby="provL"></div></div>
<label class="fld" id="provOtherW" hidden>${esc(t('plan.providerName'))}<input type="text" id="provOther" placeholder="${esc(t('plan.providerHint'))}" autocomplete="off"></label>
<label class="fld">${esc(t('plan.item'))}<input type="text" id="pItem" placeholder="${esc(t('plan.itemHint'))}" autocomplete="off"></label>
<div class="two"><label class="fld" id="pMonthlyW">${esc(t('plan.monthly'))}<input type="text" inputmode="decimal" id="pMonthly" placeholder="0" autocomplete="off"></label>
<label class="fld" id="pNW">${esc(t('plan.months'))}<input type="text" inputmode="numeric" id="pN" value="4" autocomplete="off"></label></div>
<div class="chips ex-nchips" id="nChips"></div>
<div class="fld">${esc(t('plan.start'))}${dfield('pStart', t('plan.start'))}</div>
<label class="due ex-first" id="pFirstW"><input type="checkbox" id="pFirst" checked><span class="m">${esc(t('plan.firstPaid'))}</span></label>
<fieldset class="ex-past" id="pPast" hidden><legend id="pPastL"></legend><p class="note" id="pPastQ"></p>
<label class="ex-popt"><input type="radio" name="pPast" value="all" checked><span><b>${esc(t('plan.pastAll'))}</b><small id="pPastAll"></small></span></label>
<label class="ex-popt"><input type="radio" name="pPast" value="some"><span><b>${esc(t('plan.pastSome'))}</b><small>${esc(t('plan.pastSomeSub'))}</small>
<span class="ex-stepper" id="pSome" hidden><button type="button" class="icon-btn" id="pPaidLess" aria-label="${esc(t('plan.less'))}">−</button><b id="pPaidN" aria-live="polite"></b><button type="button" class="icon-btn" id="pPaidMore" aria-label="${esc(t('plan.more'))}">+</button><small id="pSomeTxt"></small></span></span></label>
</fieldset>
<p class="note ex-prev" id="pPrev" aria-live="polite"></p>
<button class="btn ex-wide" type="submit">${esc(t('sheet.plan.submit'))}</button>`;
    fxSheet.setAttribute('aria-label', t('sheet.fx.title'));
    fxSheet.innerHTML = `
<div class="row"><h2 class="sheet-h">${esc(t('sheet.fx.title'))}</h2><span class="sp"></span>${close}</div>
<div class="amt"><input id="fxAmt" type="text" inputmode="decimal" placeholder="0" aria-label="${esc(t('sheet.log.amount'))}" autocomplete="off"><span>${esc(t('currency'))}</span></div>
<div class="chips" id="fxChips" role="group" aria-label="${esc(t('sheet.log.cat'))}"></div>
<div class="two"><label class="fld" id="fxDayW">${esc(t('fx.day'))}<input type="text" inputmode="numeric" id="fxDay" autocomplete="off"></label>
<label class="fld">${esc(t('sheet.log.note'))}<input type="text" id="fxNote" placeholder="${esc(t('sheet.log.notePh'))}" autocomplete="off"></label></div>
<button class="btn ex-wide" type="submit">${esc(t('sheet.fx.submit'))}</button>`;
  }

  const $ = (sel) => document.querySelector(sel);
  const setDateText = (id) => { const v = $(`#${id}`).value; $(`#${id}Txt`).textContent = DATE_RE.test(v) ? dateLabel(v) : ''; };

  // ---------- render ----------
  const hasData = (m) => !!state.months[m] || dueIn(state, m).length > 0 || state.tx.some((x) => !x.deleted && txMonth(state, x) === m);

  function renderStrip() {
    const now = nowMonth();
    const s = start();
    const plans = state.plans.filter((p) => !p.deleted);
    const firsts = [...Object.keys(state.months), ...plans.map((p) => schedule(p, s)[0].month), cur, now].sort();
    const lasts = [addMonth(now, 12), cur, ...plans.map((p) => schedule(p, s)[p.n - 1].month)].sort();
    const end = lasts[lasts.length - 1];
    const out = [];
    const board = wide.matches;
    for (let m = addMonth(firsts[0], -1); m <= end; m = addMonth(m, 1)) {
      const has = !!state.months[m] || dueIn(state, m).length > 0;
      const cls = [m === cur && 'on', has && 'has', m === now && 'today'].filter(Boolean).join(' ');
      const y = m.slice(0, 4);
      // PC: the chosen month is the button that opens the month picker.
      const pop = board && m === cur ? ` aria-haspopup="dialog" aria-expanded="${pickYear !== null}" aria-controls="mPick"` : '';
      out.push(`<button type="button" role="tab" data-m="${m}" class="${cls}" aria-selected="${m === cur}" aria-label="${esc(monthName(m, lang))}"${pop}>${esc(monthShort(m))}<small>${m.endsWith('-01') || m === cur ? y : '&nbsp;'}</small>${pop ? icon('down') : ''}</button>`);
    }
    $('#mscroll').innerHTML = out.join('');
    centerStrip();
  }

  function centerStrip() {
    const sc = $('#mscroll');
    const on = sc && sc.querySelector('.on');
    if (!on || wide.matches) return;
    const r = on.getBoundingClientRect(); const q = sc.getBoundingClientRect();
    if (!q.width) return;
    sc.scrollBy({ left: (r.left + r.width / 2) - (q.left + q.width / 2), behavior: 'auto' });
  }

  // Month picker (PC): a year of months, the chosen one marked, months with entries dotted.
  function renderPicker() {
    const p = $('#mPick');
    if (pickYear === null) { p.hidden = true; return; }
    const rtl = lang === 'ar';
    const months = Array.from({ length: 12 }, (_, i) => `${pickYear}-${String(i + 1).padStart(2, '0')}`);
    p.innerHTML = `<div class="row mp-head"><button type="button" class="icon-btn" data-py="-1" aria-label="${esc(t('month.prevYear'))}">${rtl ? '›' : '‹'}</button><b>${pickYear}</b><button type="button" class="icon-btn" data-py="1" aria-label="${esc(t('month.nextYear'))}">${rtl ? '‹' : '›'}</button></div>`
      + `<div class="mp-grid">${months.map((m) => {
        const has = hasData(m);
        return `<button type="button" data-pm="${m}" class="${[m === cur && 'on', has && 'has', m === nowMonth() && 'today'].filter(Boolean).join(' ')}" aria-pressed="${m === cur}" aria-label="${esc(monthName(m, lang))}${has ? ` · ${esc(t('month.hasData'))}` : ''}">${esc(monthShort(m))}</button>`;
      }).join('')}</div><p class="mp-key"><i aria-hidden="true"></i>${esc(t('month.hasData'))}</p>`;
    p.hidden = false;
  }
  function openPicker() { pickYear = Number(cur.slice(0, 4)); renderStrip(); renderPicker(); ($('#mPick [data-pm].on') || $('#mPick [data-pm]'))?.focus(); }
  function closePicker(focusBack = true) {
    if (pickYear === null) return;
    pickYear = null; renderPicker(); renderStrip();
    if (focusBack) $('#mscroll button.on')?.focus();
  }

  // PC hero: share of income spent, how much of the month has passed, and the daily allowance.
  function renderMeter(sum) {
    const w = $('#exMeterW');
    const pace = $('#exPace');
    const daily = $('#exDaily');
    const prog = periodProgress(cur, todayLocal(), start());
    daily.hidden = !(sum.income > 0 && prog);
    $('#exHero').classList.toggle('neg', sum.remainingNow < 0);
    if (!daily.hidden) {
      const rem = sum.remainingNow;
      daily.classList.toggle('bad', rem <= 0);
      if (rem > 0) {
        $('#exDailyAmt').textContent = `${money(Math.floor(rem / prog.left / 100) * 100)} ${t('currency')}`;
        $('#exDailyLbl').textContent = t('sum.daily');
        $('#exDailySub').textContent = t('sum.dailyUntil', { date: dayMonth(periodBounds(cur, start()).to), left: daysText(prog.left) });
      } else {
        $('#exDailyAmt').textContent = '';
        $('#exDailyLbl').textContent = rem < 0 ? t('sum.overIncome', { amount: money(-rem) }) : t('sum.dailyNone');
        $('#exDailySub').textContent = '';
      }
    }
    w.hidden = pace.hidden = !(sum.income > 0);
    if (!(sum.income > 0)) return;
    const pct = Math.round((sum.spent / sum.income) * 100);
    const bar = $('#exMeter');
    bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    bar.classList.toggle('over', pct > 100);
    const marker = $('#exNow');
    marker.hidden = !prog;
    if (prog) {
      const days = Math.round((prog.passed / prog.length) * 100);
      marker.style.insetInlineStart = `${days}%`;
      pace.textContent = t('sum.pace', { spent: pct, days });
    } else {
      pace.textContent = t('sum.paceMonth', { spent: pct });
    }
  }

  function renderSummary(view, sum) {
    const cur$ = esc(t('currency'));
    $('#exLeft').innerHTML = `${esc(money(sum.remainingNow))} <span>${cur$}</span>`;
    $('#fInc').textContent = money(sum.income);
    $('#fSpent').textContent = money(sum.spent);
    $('#fBud').textContent = money(sum.budgetTotal);
    $('#fAct').textContent = money(sum.remainingActual);
    renderMeter(sum);
    renderSetup(view, sum);
    renderTop(view, sum);
    const rows = sum.rows.map((r) => { const c = getCategory(view, r.catId); return { label: catLabel(c, t), s: r.spent, b: r.budget, color: c.color }; })
      .concat(providerRows(sum.providers))
      .filter((r) => r.s || r.b);
    let near = 0; let over = 0;
    $('#exCats').innerHTML = rows.length ? rows.map(({ label, s, b, color }) => {
      // over: spent more than planned; full: exactly used up; near: 90 % or more used.
      const st = s > b ? 'over' : b && s === b ? 'full' : b && s / b >= 0.9 ? 'near' : '';
      if (st === 'over') over++;
      if (st === 'near') near++;
      const w = b ? Math.min(100, (s / b) * 100) : 100;
      const txt = st === 'over' ? t('sum.overBy', { amount: money(s - b) })
        : st === 'full' ? t('sum.full') : t('sum.left', { left: money(b - s), budget: money(b) });
      return `<div class="cat ${st}"><div class="t"><span>${color ? `<i class="cdot c-${color}" aria-hidden="true"></i>` : ''}${esc(label)}</span><span class="st">${esc(txt)}</span></div>`
        + `<div class="bar"><i class="${st === 'over' || st === 'near' ? st : ''}" style="width:${w}%"></i></div></div>`;
    }).join('') : liveCats(state).length
      // categories exist but none has a budget or spending yet (a new account)
      ? `<p class="note">${esc(t('sum.noBudget'))}</p><button type="button" class="btn sec ex-small" data-tab="bud">${esc(t('bud.edit'))}</button>`
      : `<p class="note">${esc(t('sum.empty'))}</p>`;
    $('#exLegend').innerHTML = (near ? `<span><i class="near"></i>${esc(t('sum.near'))}</span>` : '')
      + (over ? `<span><i class="over"></i>${esc(t('sum.overL'))}</span>` : '');
  }

  // «ابدأ في 3 خطوات»: a new account's next steps, until income, budgets and a first spend exist.
  function renderSetup(view, sum) {
    const card = $('#exSetup');
    const done = [sum.income > 0, sum.rows.some((r) => r.budget > 0), state.tx.some((x) => !x.deleted)];
    const n = done.filter(Boolean).length;
    const show = n < 3 && !setupLater() && cur === nowMonth();
    card.hidden = !show;
    $('#t-sum').classList.toggle('setup', show);
    if (!show) return;
    const next = done.indexOf(false);
    const cats = liveCats(state).length;
    const step = (i, title, sub, actions) => {
      const st = done[i] ? 'done' : i === next ? 'now' : '';
      return `<div class="su-step ${st}"><span class="su-n" aria-hidden="true">${done[i] ? icon('check') : i + 1}</span><div><b>${esc(title)}</b><small>${esc(sub)}</small>${i === next && actions ? `<div class="row su-act">${actions}</div>` : ''}</div></div>`;
    };
    const btn = (kind, key, primary) => `<button type="button" class="btn ${primary ? '' : 'sec '}ex-small" data-setup="${kind}">${esc(t(key))}</button>`;
    card.innerHTML = `<div class="row ex-card-head"><h2>${esc(t('setup.title'))}</h2><span class="sp"></span><span class="su-prog">${esc(t('setup.progress', { n }))}</span></div>`
      + `<p class="note ex-sub">${esc(t('setup.lead'))}</p><div class="bar su-bar"><i style="width:${(n / 3) * 100}%"></i></div>`
      + step(0, t('setup.income'), done[0] ? t('setup.incomeDone', { amount: money(sum.income) }) : t('setup.incomeSub'), btn('income', 'setup.incomeBtn', true))
      + step(1, t('setup.budget'), done[1] ? t('setup.budgetDone') : t('setup.budgetSub', { n: cats }), (sum.income > 0 ? btn('split', 'setup.split', true) : '') + btn('own', 'setup.own', sum.income <= 0))
      + step(2, t('setup.log'), t(wide.matches ? 'setup.logSub' : 'setup.logSubPhone'), btn('log', 'sheet.log.title', true))
      + `<button type="button" class="ex-link su-later" data-setup="later">${esc(t('setup.later'))}</button>`;
  }

  // Overspent: the three categories furthest over their budget, and a way to the budget.
  function renderTop(view, sum) {
    const box = $('#exTop');
    const over = sum.rows.filter((r) => r.spent > r.budget).sort((a, b) => (b.spent - b.budget) - (a.spent - a.budget)).slice(0, 3);
    box.hidden = !(sum.remainingNow < 0 && over.length);
    if (box.hidden) return;
    box.innerHTML = `<h3>${esc(t('sum.top'))}</h3>${over.map((r) => {
      const c = getCategory(view, r.catId);
      return `<div class="top-row"><span>${esc(catLabel(c, t))}</span><b>\u2066+${esc(money(r.spent - r.budget))}\u2069</b></div>`; // LRI…PDI: keeps the + in front in RTL
    }).join('')}<button type="button" class="btn ex-small" data-tab="bud">${esc(t('sum.review'))}</button>`;
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

  // Transactions grouped by day (newest first) with each day's total; paid installments last.
  // The search box and the category chips filter in place (renderTxList only, so focus stays put).
  let txData = { live: [], ins: [] };
  function renderTx(due) {
    const live = state.tx.filter((x) => !x.deleted && txMonth(state, x) === cur)
      .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
    const ins = due.filter((d) => d.paid);
    txData = { live, ins };
    const used = new Set(live.map((x) => x.catId));
    const opts = [['all', t('tx.all')], ...liveCats(state).filter((c) => used.has(c.id)).map((c) => [c.id, catLabel(c, t)])];
    if (ins.length) opts.push(['ins', t('tx.ins')]);
    if (!opts.some(([k]) => k === txFilter)) txFilter = 'all';
    $('#txF').hidden = opts.length < 3;
    $('#txF').innerHTML = opts.map(([k, label]) => `<option value="${esc(k)}"${k === txFilter ? ' selected' : ''}>${esc(k === 'all' ? t('tx.allN', { n: opts.length - 1 }) : label)}</option>`).join('');
    $('#txQ').closest('.ex-search').hidden = live.length + ins.length < 2;
    renderTxList();
  }

  function renderTxList() {
    const { live, ins } = txData;
    if (!live.length && !ins.length) { $('#exTxs').innerHTML = `<p class="note">${esc(t(wide.matches ? 'tx.emptyPc' : 'tx.empty'))}</p>`; return; }
    const q = txQuery.trim().toLowerCase();
    const label = (x) => { const c = getCategory(state, x.catId); return c ? catLabel(c, t) : ''; };
    const match = (...texts) => !q || texts.some((s) => String(s).toLowerCase().includes(q));
    let rows = txFilter === 'ins' ? [] : live.filter((x) => (txFilter === 'all' || x.catId === txFilter) && match(label(x), x.note));
    let insRows = txFilter === 'all' || txFilter === 'ins'
      ? ins.filter((d) => match(d.plan.item, provLabel(d.plan.provider), t('sum.provider', { provider: provLabel(d.plan.provider) }))) : [];
    // A long month shows its latest TX_LIMIT; a search or a filter always shows every match.
    const count = rows.length + insRows.length;
    const limited = !q && txFilter === 'all' && !txAll && count > TX_LIMIT;
    const more = $('#txMore');
    more.hidden = !(count > TX_LIMIT && !q && txFilter === 'all');
    more.textContent = txAll ? t('tx.less') : t('tx.more', { n: count });
    if (limited) { insRows = insRows.slice(0, Math.max(0, TX_LIMIT - rows.length)); rows = rows.slice(0, TX_LIMIT); }
    const out = [];
    let day = null;
    for (let i = 0; i < rows.length; i++) {
      const x = rows[i];
      if (x.date !== day) {
        day = x.date;
        const total = rows.filter((r) => r.date === day).reduce((a, r) => a + r.amount, 0);
        out.push(`<div class="tx-day"><b>${esc(dateLabel(day))}</b><span>${esc(money(total))} ${esc(t('currency'))}</span></div>`);
      }
      const cc = getCategory(state, x.catId)?.color;
      out.push(`<div class="tx"><span class="ic${cc ? ` cc c-${cc}` : ''}">${icon(x.fixed ? 'repeat' : 'tag')}</span><div class="m">${esc(label(x))}${x.note ? `<small>${esc(x.note)}</small>` : ''}</div>`
        + `<span class="a">${esc(money(x.amount))}</span><button type="button" class="icon-btn" data-del="${esc(x.id)}" aria-label="${esc(t('tx.delete'))}">${icon('trash')}</button></div>`);
    }
    if (insRows.length) {
      out.push(`<div class="tx-day"><b>${esc(t('tx.insGroup'))}</b><span>${esc(money(insRows.reduce((a, d) => a + d.amount, 0)))} ${esc(t('currency'))}</span></div>`);
      for (const d of insRows) {
        out.push(`<div class="tx"><span class="ic">${icon('clock')}</span><div class="m">${esc(t('sum.provider', { provider: provLabel(d.plan.provider) }))} · ${esc(d.plan.item)}<small>${esc(t('tx.installment', { k: d.k + 1, n: d.plan.n }))}</small></div><span class="a">${esc(money(d.amount))}</span><span class="ex-gap"></span></div>`);
      }
    }
    $('#exTxs').innerHTML = out.length ? out.join('') : `<p class="note">${esc(t('tx.noMatch'))}</p>`;
  }

  function schedHtml(plan) {
    const rows = schedule(plan, start());
    const chip = (r) => `<span class="${[r.paid && 'paid', r.month === cur && 'now'].filter(Boolean).join(' ')}">${esc(monthShort(r.month))} ${r.month.slice(2, 4)} · ${esc(money(r.amount))}</span>`;
    if (plan.n <= 8) return rows.map(chip).join('');
    if (expanded.has(plan.id)) return rows.map(chip).join('') + `<button type="button" class="more" data-less="${esc(plan.id)}">${esc(t('ins.hide'))}</button>`;
    let c = rows.findIndex((r) => !r.paid);
    if (c < 0) c = plan.n - 1;
    const a = Math.max(0, Math.min(c - 1, plan.n - 6));
    return rows.slice(a, a + 6).map(chip).join('') + `<button type="button" class="more" data-more="${esc(plan.id)}">${esc(t('ins.showAll', { n: plan.n }))}</button>`;
  }

  function renderNext() {
    const n = nextPayment(state, todayLocal());
    const late = overduePayments(state, todayLocal()).length;
    $('#exNextCard').hidden = !n && !late;
    const lateHtml = late ? `<div class="nx-late"><span>${esc(t(countKey('overdue', late), { n: late }))}</span><button type="button" class="btn sec ex-small" data-latepaid>${esc(t('ins.markLate'))}</button></div>` : '';
    if (!n) { $('#exNext').innerHTML = lateHtml; return; }
    const d = new Date(Number(n.date.slice(0, 4)), Number(n.date.slice(5, 7)) - 1, Number(n.date.slice(8, 10)));
    const mon = new Intl.DateTimeFormat(loc(), { month: 'long' }).format(d);
    $('#exNext').innerHTML = `<div class="nx"><div class="nx-d"><b>${d.getDate()}</b><small>${esc(mon)}</small></div>`
      + `<div class="m">${esc(n.plan.item)} <span class="prov ${provClass(n.plan.provider)}">${esc(provLabel(n.plan.provider))}</span>`
      + `<small>${esc(t('ins.payment', { k: n.k + 1, n: n.plan.n }))} · ${esc(soonText(n.inDays))}</small></div><b class="nx-a">${esc(money(n.amount))}</b></div>`
      + `<label class="due nx-pay"><input type="checkbox" data-pay="${esc(n.plan.id)}:${n.k}"><span class="m">${esc(t('ins.markPaid'))}</span></label>${lateHtml}`;
  }

  function renderIns(due) {
    renderNext();
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

  // A suggestion rounds the average to whole riyals.
  const suggestion = (avg, id) => Math.round((avg.by[id] || 0) / 100) * 100;

  function renderBud(view) {
    const rec = view.months[cur] || { income: 0, budget: {} };
    const avg = categoryAverages(state, cur);
    $('#incIn').value = plain(rec.income);
    $('#incIn').setAttribute('aria-label', t('bud.income'));
    $('#budSuggest').hidden = !avg.months;
    $('#budSuggestSub').textContent = t(avg.months === 1 ? 'bud.suggestSub1' : 'bud.suggestSub', { n: avg.months });
    $('#exBuds').innerHTML = liveCats(state).map((c) => {
      const label = catLabel(c, t);
      const sug = suggestion(avg, c.id);
      const avgHtml = !avg.months ? '' : `<span class="b-avg">${esc(sug ? t('bud.avg', { amount: money(sug) }) : t('bud.avgNone'))}`
        + `${sug && sug !== (rec.budget[c.id] || 0) ? `<button type="button" class="ex-link" data-use="${esc(c.id)}" aria-label="${esc(t('bud.useFor', { cat: label }))}">${esc(t('bud.use'))}</button>` : ''}</span>`;
      const picker = colorFor !== c.id ? '' : `<div class="b-colors" id="colorPick" role="group" aria-label="${esc(t('bud.colorTitle', { cat: label }))}"><b>${esc(t('bud.colorTitle', { cat: label }))}</b>`
        + CAT_COLORS.map((k) => `<button type="button" class="b-sw c-${k}" data-pick="${k}" aria-pressed="${c.color === k}" aria-label="${esc(t(`color.${k}`))}"></button>`).join('')
        + `<button type="button" class="ex-link" data-pick="none">${esc(t('bud.noColor'))}</button></div>`;
      return `<div class="brow"><span class="b-name"><button type="button" class="b-sw ${c.color ? `c-${c.color}` : 'none'}" data-color="${esc(c.id)}" aria-expanded="${colorFor === c.id}" aria-label="${esc(t('bud.color', { cat: label }))}"></button>${esc(label)}</span>`
        + `<input type="text" inputmode="decimal" autocomplete="off" id="bud-${esc(c.id)}" data-b="${esc(c.id)}" value="${esc(plain(rec.budget[c.id] || 0))}" aria-label="${esc(t('bud.budgetFor', { cat: label }))}">${avgHtml}`
        + `<button type="button" class="icon-btn" data-cdel="${esc(c.id)}" aria-label="${esc(t('bud.deleteCat', { cat: label }))}">${icon('trash')}</button></div>${picker}`;
    }).join('');
  }

  // «وزّعت … من دخلك …»: the category budgets against the income (kept fresh while typing in them).
  function renderBudTotal(view) {
    const rec = view.months[cur] || { income: 0, budget: {} };
    const placed = liveCats(state).reduce((a, c) => a + (rec.budget[c.id] || 0), 0);
    const left = rec.income - placed;
    $('#budTotal').hidden = !(rec.income > 0);
    $('#budTotal').innerHTML = `<span>${esc(t('bud.total', { spent: money(placed), income: money(rec.income) }))}</span>`
      + `<b class="${left < 0 ? 'bad' : 'ok'}">${esc(left < 0 ? t('bud.overIncome', { amount: money(-left) }) : t('bud.left', { amount: money(left) }))}</b>`;
  }

  // ---------- reports ----------
  // A step that gives 3–5 gridlines: 1, 2 or 5 × a power of ten (halalas).
  function niceStep(max) {
    const raw = max / 4;
    const p = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
  }

  function renderRep() {
    const rows = monthHistory(state, cur, todayLocal());
    const st = historyStats(rows);
    const any = rows.some((r) => r.spent || r.income);
    $('#repView').hidden = !any;
    $('#repView').textContent = t(repTable ? 'rep.chartView' : 'rep.table');
    $('#repView').setAttribute('aria-pressed', String(repTable));
    $('#repStats').textContent = st.months ? `${t('rep.avg', { avg: money(st.avg) })} ${t(st.over === 0 ? 'rep.over0' : st.over === 1 ? 'rep.over1' : 'rep.overN', { k: st.over })}` : '';
    $('#repStats').hidden = !st.months;
    const name = (m) => monthShort(m);
    if (!any) { $('#repChart').innerHTML = `<p class="note">${esc(t('rep.empty'))}</p>`; }
    else if (repTable) {
      $('#repChart').innerHTML = `<table class="rc-table"><caption class="sr">${esc(t('rep.chart'))}</caption><thead><tr><th scope="col">${esc(t('rep.month'))}</th><th scope="col">${esc(t('rep.spent'))}</th><th scope="col">${esc(t('rep.income'))}</th></tr></thead><tbody>`
        + rows.map((r) => `<tr><th scope="row">${esc(monthName(r.month, lang))}</th><td>${esc(money(r.spent))}</td><td>${esc(money(r.income))}</td></tr>`).join('') + '</tbody></table>';
    } else {
      const top = Math.max(...rows.map((r) => Math.max(r.spent, r.income)), 1);
      const step = niceStep(top);
      const max = Math.ceil((top * 1.08) / step) * step;
      const pct = (v) => `${(v / max) * 100}%`;
      const grid = [];
      for (let v = step; v < max; v += step) grid.push(`<i class="rc-g" style="bottom:${pct(v)}"><span>${esc(money(v))}</span></i>`);
      const list = rows.map((r) => `${monthName(r.month, lang)} ${money(r.spent)} / ${money(r.income)}`).join('، ');
      $('#repChart').innerHTML = `<div class="rc" role="img" aria-label="${esc(t('rep.chartLabel', { list }))}">`
        + `<div class="rc-key" aria-hidden="true"><span><i class="k-bar"></i>${esc(t('rep.spent'))}</span><span><i class="k-inc"></i>${esc(t('rep.income'))}</span></div>`
        + `<div class="rc-plot" aria-hidden="true"><i class="rc-g rc-0" style="bottom:0"><span>0</span></i>${grid.join('')}<div class="rc-cols">`
        + rows.map((r) => {
          const over = r.income > 0 && r.spent > r.income;
          const lbl = over ? t('rep.overBy', { amount: money(r.spent - r.income) }) : r.partial ? t('rep.soFar', { amount: money(r.spent) }) : '';
          const tip = `${monthName(r.month, lang)} · ${t('rep.spent')} ${money(r.spent)} · ${t('rep.income')} ${money(r.income)}`;
          return `<div class="rc-col" tabindex="0"><span class="rc-tip">${esc(tip)}</span>${lbl ? `<span class="rc-lbl ${over ? 'over' : ''}" style="bottom:calc(${pct(Math.max(r.spent, r.income))} + 6px)">${esc(lbl)}</span>` : ''}`
            + `<i class="rc-bar ${over ? 'over' : ''} ${r.partial ? 'part' : ''}" style="height:${pct(r.spent)}"></i>`
            + `${r.income ? `<i class="rc-inc" style="bottom:${pct(r.income)}"></i>` : ''}</div>`;
        }).join('')
        + `</div></div><div class="rc-x" aria-hidden="true">${rows.map((r) => `<span>${esc(name(r.month))}</span>`).join('')}</div></div>`;
    }
    // fixed expenses
    const fx = liveFixed(state);
    $('#fxList').innerHTML = fx.length ? fx.map((f) => {
      const c = getCategory(state, f.catId);
      const nm = (c ? catLabel(c, t) : '') + (f.note ? ` · ${f.note}` : '');
      return `<div class="fx-row ${f.active ? '' : 'off'}"><span class="ic">${icon('repeat')}</span><div class="m">${esc(nm)}<small>${esc(t('fx.when', { day: f.day }))}${f.active ? '' : ` · ${esc(t('fx.paused'))}`}</small></div>`
        + `<b class="ex-nowrap">${esc(money(f.amount))}</b><input type="checkbox" role="switch" data-fxon="${esc(f.id)}" ${f.active ? 'checked' : ''} aria-label="${esc(t('fx.toggle', { name: nm }))}">`
        + `<button type="button" class="icon-btn" data-fxdel="${esc(f.id)}" aria-label="${esc(t('fx.delete', { name: nm }))}">${icon('trash')}</button></div>`;
    }).join('') : `<p class="note">${esc(t('fx.empty'))}</p>`;
    // month start
    const s = start();
    el.querySelectorAll('[data-ms]').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.ms === 'payday') === (s > 1))));
    $('#msDayW').hidden = s === 1;
    $('#msDay').value = String(s > 1 ? s : PAYDAY);
    const b = periodBounds(cur, s);
    $('#msRange').hidden = s === 1;
    $('#msRange').textContent = t('ms.range', { month: monthShort(cur), from: dayMonth(b.from), to: dayMonth(b.to) });
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
    const m = DATE_RE.test(d) ? periodOf(d, start()) : cur;
    const row = projectedSummary(state, m).rows.find((r) => r.catId === pick);
    return row ? row.left : 0;
  }

  function renderFull() {
    const b = $('#logFull');
    const left = fullLeft();
    b.hidden = !(left > 0);
    if (left > 0) b.textContent = t('sheet.log.full', { amount: money(left) });
  }

  // The address shows the month (#expenses/2026-12) unless it is the current one, so a reload or a
  // shared link opens the same month.
  function syncHash() {
    if (!isOn()) return;
    const want = cur === nowMonth() ? '#expenses' : `#expenses/${cur}`;
    if (location.hash !== want) history.replaceState(null, '', want);
  }

  function render({ keepBud = false } = {}) {
    const view = projectedState(state, cur);
    const sum = monthSummary(view, cur);
    const due = dueIn(state, cur);
    renderStrip();
    renderPicker();
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
    renderBudTotal(view);
    renderRep();
    const board = wide.matches;
    for (const [k] of TABS) el.querySelector(`#t-${k}`).hidden = board ? (ALONE.has(tab) ? k !== tab : ALONE.has(k)) : k !== tab;
    for (const [id, k, on, off] of [['#exBudBtn', 'bud', 'bud.back', 'bud.edit'], ['#exRepBtn', 'rep', 'bud.back', 'tab.reports']]) {
      $(id).textContent = t(tab === k ? on : off);
      $(id).setAttribute('aria-pressed', String(tab === k));
    }
    el.querySelectorAll('.tabs button').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    renderChips();
    document.body.dataset.extab = tab; // the phone bar marks «التقارير» while it is open
    syncHash();
    dispatchEvent(new CustomEvent('toolbox:expenses-changed'));
  }

  function go(k) { cur = addMonth(cur, k); render(); }
  const isOn = () => el.classList.contains('on');
  const sheetOpen = () => !!document.querySelector('.sheet.on');

  // ---------- view events ----------
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !el.contains(b)) return;
    if (b.id === 'mPrev') { closePicker(false); return go(-1); }
    if (b.id === 'mNext') { closePicker(false); return go(1); }
    if (b.id === 'mToday') { closePicker(false); cur = nowMonth(); render(); toast(t('month.back', { month: monthName(cur, lang) })); return; }
    if (b.dataset.m) {
      if (wide.matches && b.dataset.m === cur) { if (pickYear === null) openPicker(); else closePicker(); return; }
      cur = b.dataset.m; render(); return;
    }
    if (b.dataset.py) { pickYear += Number(b.dataset.py); renderPicker(); $(`#mPick [data-py="${b.dataset.py}"]`)?.focus(); return; }
    if (b.dataset.pm) { cur = b.dataset.pm; pickYear = null; render(); $('#mscroll button.on')?.focus(); return; }
    if (b.dataset.tab) { tab = b.dataset.tab; render(); return; }
    if (b.id === 'txMore') { txAll = !txAll; renderTxList(); return; }
    if (b.dataset.color) { colorFor = colorFor === b.dataset.color ? null : b.dataset.color; renderBud(projectedState(state, cur)); $(colorFor ? '#colorPick [data-pick]' : `[data-color="${b.dataset.color}"]`)?.focus(); return; }
    if (b.dataset.pick) {
      const id = colorFor; colorFor = null;
      await mutate(() => { setCategoryColor(state, id, b.dataset.pick === 'none' ? null : b.dataset.pick); return ''; });
      $(`[data-color="${id}"]`)?.focus();
      return;
    }
    if (b.dataset.use || b.id === 'useAll') {
      const avg = categoryAverages(state, cur);
      const ids = b.dataset.use ? [b.dataset.use] : liveCats(state).map((c) => c.id).filter((id) => suggestion(avg, id));
      await mutate(() => { for (const id of ids) setBudget(state, cur, id, suggestion(avg, id)); return b.dataset.use ? '' : t('toast.suggested'); });
      return;
    }
    if (b.dataset.setup) { await setupAction(b.dataset.setup); return; }
    if (b.id === 'exNewPlan') { openPlan(); return; }
    if (b.id === 'exLog') { openLog(); return; }
    if (b.id === 'exBudBtn') { tab = tab === 'bud' ? 'sum' : 'bud'; render(); return; }
    if (b.id === 'exRepBtn') { tab = tab === 'rep' ? 'sum' : 'rep'; render(); return; }
    if (b.id === 'repView') { repTable = !repTable; renderRep(); $('#repView').focus(); return; }
    if (b.id === 'exExport') { exportFile(); return; }
    if (b.id === 'fxAdd') { openFixed(); return; }
    if (b.dataset.ms) { await setStart(b.dataset.ms === 'payday' ? (start() > 1 ? start() : PAYDAY) : 1); return; }
    if (b.dataset.more) { expanded.add(b.dataset.more); render(); return; }
    if (b.dataset.less) { expanded.delete(b.dataset.less); render(); return; }
    if (b.dataset.del) {
      const id = b.dataset.del;
      await mutate(() => { deleteTx(state, id); return t('toast.txDeleted'); }, { undo: () => restoreRecord(state.tx, id) });
      return;
    }
    if (b.hasAttribute('data-latepaid')) {
      let done = [];
      await mutate(() => { done = markPaidBefore(state, todayLocal()); return t('toast.latePaid', { n: done.length }); },
        { undo: () => { for (const { id, k } of done) setPaid(state, id, k, false); } });
      return;
    }
    if (b.dataset.pdel) {
      const id = b.dataset.pdel;
      await mutate(() => { deletePlan(state, id); return t('toast.planDeleted'); }, { undo: () => restoreRecord(state.plans, id) });
      return;
    }
    if (b.dataset.fxdel) {
      const id = b.dataset.fxdel;
      await mutate(() => { deleteFixed(state, id); return t('toast.fxDeleted'); }, { undo: () => restoreRecord(state.fixed, id) });
      return;
    }
    if (b.dataset.cdel) {
      const id = b.dataset.cdel;
      const label = catLabel(getCategory(state, id), t);
      await mutate(() => { deleteCategory(state, id); return t('toast.catDeleted', { cat: label }); }, { errVars: { cat: label }, undo: () => restoreRecord(state.cats, id) });
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

  // Close the month picker on Escape or a click outside it.
  document.addEventListener('click', (e) => {
    // A target no longer in the page was just re-rendered by this view's own handler (e.g. the click that opened it).
    if (pickYear === null || !document.contains(e.target)) return;
    if (!e.target.closest('#mPick, #mscroll button.on')) closePicker(false);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pickYear !== null) { e.stopPropagation(); closePicker(); }
  });

  async function setStart(day) {
    const input = $('#msDay');
    if (!startOk(day)) { fieldError(input, t('err.invalid-day'), $('#msDayW')); return; }
    if (day === start()) return;
    const wasNow = cur === nowMonth();
    await mutate(() => {
      setMonthStart(state, day);
      applyFixed(state, todayLocal());
      return day > 1 ? t('toast.msSet', { day }) : t('toast.msCal');
    }, { onDone: () => { if (wasNow) cur = nowMonth(); } });
  }

  function exportFile() {
    const d = todayLocal();
    const url = URL.createObjectURL(new Blob([exportCsv(state, t)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `toolbox-transactions-${d}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('toast.exported'));
  }

  async function addCat() {
    const input = $('#catName');
    if (!input.value.trim()) { fieldError(input, t('err.invalid-name'), $('.addcat')); return; }
    const ok = await mutate(() => {
      const id = addCategory(state, input.value);
      return t('toast.catAdded', { cat: catLabel(getCategory(state, id), t) });
    }, { onDone: () => { input.value = ''; } });
    if (!ok) input.focus();
  }

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'catName') { e.preventDefault(); addCat(); }
  });

  el.addEventListener('change', (e) => { if (e.target.id === 'txF') { txFilter = e.target.value; renderTxList(); } });

  async function setupAction(kind) {
    if (kind === 'later') { try { localStorage.setItem(SETUP_LATER, '1'); } catch { /* private mode: hidden until reload */ } $('#exSetup').hidden = true; $('#t-sum').classList.remove('setup'); return; }
    if (kind === 'income' || kind === 'own') { tab = 'bud'; render(); $(kind === 'income' ? '#incIn' : '#exBuds input')?.focus(); return; }
    if (kind === 'log') { openLog(); return; }
    if (kind === 'split') {
      const income = monthSummary(projectedState(state, cur), cur).income;
      await mutate(() => {
        for (const [id, v] of Object.entries(suggestSplit(state, income))) setBudget(state, cur, id, v);
        return t('toast.split');
      });
    }
  }

  el.addEventListener('input', (e) => {
    if (e.target.id === 'txQ') { txQuery = e.target.value; renderTxList(); }
  });

  el.addEventListener('change', async (e) => {
    const x = e.target;
    if (x.dataset.pay) {
      const [pid, k] = x.dataset.pay.split(':');
      const paid = x.checked;
      await mutate(() => { setPaid(state, pid, Number(k), paid); return t(paid ? 'toast.paid' : 'toast.unpaid'); });
      return;
    }
    if (x.dataset.fxon) {
      const f = (state.fixed || []).find((r) => r.id === x.dataset.fxon);
      const c = f && getCategory(state, f.catId);
      const name = c ? catLabel(c, t) : '';
      const on = x.checked;
      await mutate(() => { setFixedActive(state, x.dataset.fxon, on, todayLocal()); applyFixed(state, todayLocal()); return t(on ? 'toast.fxOn' : 'toast.fxOff', { name }); });
      return;
    }
    if (x.id === 'msDay') {
      const s = latin(x.value);
      await setStart(/^\d+$/.test(s) ? Number(s) : NaN);
      return;
    }
    if (x.id !== 'incIn' && !x.dataset.b) return;
    let h;
    try { h = parseAmount0(x.value); } catch (err) { fieldError(x, errMsg(err), x.closest('.brow')); return; }
    clearFieldError(x);
    const ok = await mutate(() => {
      if (x.id === 'incIn') setIncome(state, cur, h); else setBudget(state, cur, x.dataset.b, h);
      x.value = plain(h);
      return '';
    }, { keepBud: true });
    if (!ok) render(); // put the stored value back into the input
  });

  // Swipe between months: RTL finger → right = next; LTR mirrored.
  let x0 = null; let y0 = 0;
  el.addEventListener('touchstart', (e) => {
    if (e.target.closest('.mscroll,input,.tabs,.rc') || e.touches.length !== 1) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 45) go((dx > 0) === (lang === 'ar') ? 1 : -1);
  }, { passive: true });

  addEventListener('keydown', (e) => {
    if (!isOn() || sheetOpen() || pickYear !== null || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest && e.target.closest('input,select,textarea,[contenteditable],[popover]')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = lang === 'ar' ? 'ArrowLeft' : 'ArrowRight';
    go(e.key === next ? 1 : -1);
  });

  addEventListener('toolbox:route', (e) => {
    if (!e.detail || e.detail.view !== 'expenses') { closePicker(false); return; }
    const m = monthFromHash();
    if (m && m !== cur) { cur = m; render(); } else syncHash();
    requestAnimationFrame(centerStrip); // after the shell is visible: a hidden strip has no width to centre in
  });

  // ---------- sheets ----------
  function openLog() {
    for (const id of ['#logAmt', '#logNote']) { $(id).value = ''; clearFieldError($(id)); }
    $('#logDate').value = defDate();
    setDateText('logDate');
    renderChips();
    openSheet(logSheet);
    $('#logAmt').focus();
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
    const startDate = $('#pStart').value || `${cur}-01`;
    const last = schedule({ start: startDate, n, total: n, paid: [] }, start())[n - 1].month;
    out.dataset.last = last;
    out.textContent = monthly > 0
      ? t('plan.preview', { n, amount: money(monthly), total: money(monthly * n), last: monthName(last, lang) })
      : t('plan.previewEmpty');
  }

  // A first payment before today: how many payments were already due, and the answer to «هل دفعتها؟».
  let pastN = 0; // «دفعت بعضها فقط»: how many
  function pastDue() {
    const n = readN();
    const startDate = $('#pStart').value;
    if (!(n >= 1 && n <= 48) || !DATE_RE.test(startDate) || startDate >= todayLocal()) return null;
    const rows = schedule({ start: startDate, n, total: n, paid: [] }).filter((r) => r.date <= todayLocal());
    const ago = (Number(todayLocal().slice(0, 4)) * 12 + Number(todayLocal().slice(5, 7))) - (Number(startDate.slice(0, 4)) * 12 + Number(startDate.slice(5, 7)));
    return { count: rows.length, n, ago, rows };
  }

  function renderPast({ reset = false } = {}) {
    const p = pastDue();
    $('#pPast').hidden = !p;
    $('#pFirstW').hidden = !!p;
    if (!p) return;
    if (reset || pastN > p.count) pastN = p.count;
    const mname = (r) => monthShort(r.month);
    $('#pPastL').textContent = p.ago < 1 ? t('plan.pastRecent') : t(countKey('plan.past', p.ago), { n: p.ago });
    $('#pPastQ').textContent = p.count === 1 ? t('plan.pastQ1', { from: mname(p.rows[0]) }) : t('plan.pastQ', { from: mname(p.rows[0]), to: mname(p.rows[p.count - 1]) });
    let monthly = 0;
    try { monthly = parseAmount($('#pMonthly').value); } catch { monthly = 0; }
    $('#pPastAll').textContent = t(monthly > 0 ? 'plan.pastAllSub' : 'plan.pastAllSubN', { n: p.count, amount: money(monthly * p.count), left: p.n - p.count });
    const some = planSheet.querySelector('input[name=pPast]:checked').value === 'some';
    $('#pSome').hidden = !some;
    $('#pPaidN').textContent = String(pastN);
    $('#pSomeTxt').textContent = pastN ? t('plan.pastOf', { n: p.count, from: mname(p.rows[0]), to: mname(p.rows[pastN - 1]) }) : t('plan.pastNone', { n: p.count });
  }

  function openPlan() {
    for (const id of ['#pItem', '#pMonthly', '#provOther', '#pN']) clearFieldError($(id));
    for (const id of ['#pItem', '#pMonthly', '#provOther']) $(id).value = '';
    $('#pStart').value = defDate();
    setDateText('pStart');
    $('#pFirst').checked = true;
    $('#pN').value = '4';
    planSheet.querySelector('input[name=pPast][value=all]').checked = true;
    prov = 'tabby';
    renderProvs();
    preview();
    renderPast({ reset: true });
    openSheet(planSheet);
  }

  function renderFxChips() {
    const cats = liveCats(state);
    if (!cats.some((c) => c.id === fxPick)) fxPick = (cats.find((c) => c.nameKey === 'cat.housing') || cats[0] || {}).id || null;
    $('#fxChips').innerHTML = cats.map((c) => `<button type="button" data-fc="${esc(c.id)}" class="${c.id === fxPick ? 'on' : ''}" aria-pressed="${c.id === fxPick}">${esc(catLabel(c, t))}</button>`).join('');
  }

  function openFixed() {
    for (const id of ['#fxAmt', '#fxDay', '#fxNote']) { $(id).value = ''; clearFieldError($(id)); }
    $('#fxDay').value = String(Math.min(28, Number(todayLocal().slice(8, 10))));
    renderFxChips();
    openSheet(fxSheet);
    $('#fxAmt').focus();
  }

  function wireSheets() {
    for (const s of [logSheet, planSheet, fxSheet]) {
      s.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
      // The date fields show a written date; the native input sits on top (invisible) and opens the picker.
      s.addEventListener('click', (e) => {
        const i = e.target.closest('.dfield input');
        if (i && typeof i.showPicker === 'function') { try { i.showPicker(); } catch { /* not allowed here */ } }
      });
      s.addEventListener('input', (e) => { if (e.target.matches('.dfield input')) setDateText(e.target.id); });
      s.addEventListener('change', (e) => { if (e.target.matches('.dfield input')) setDateText(e.target.id); });
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
      if (left > 0) { $('#logAmt').value = formatAmount(left, 'en'); clearFieldError($('#logAmt')); $('#logAmt').focus(); }
    });
    logSheet.addEventListener('change', (e) => { if (e.target.id === 'logDate') renderFull(); });
    logSheet.addEventListener('submit', async (e) => {
      e.preventDefault();
      // Validate everything before touching the month, so a rejected entry leaves no month record.
      let amount;
      try { amount = parseAmount($('#logAmt').value); } catch (err) { fieldError($('#logAmt'), errMsg(err), logSheet.querySelector('.amt')); return; }
      const date = $('#logDate').value || defDate();
      const cat = getCategory(state, pick);
      if (!cat || cat.deleted || !DATE_RE.test(date)) { toast(errMsg(new Error('invalid-tx'))); return; }
      const note = $('#logNote').value.trim();
      const month = periodOf(date, start());
      await mutate(() => {
        ensureMonth(state, month); // first write to a month creates it (auto-copy)
        addTx(state, { catId: cat.id, amount, date, note });
        return t('toast.logged', { amount: formatAmount(amount, lang), cat: catLabel(cat, t) });
      }, { sheet: true, onDone: () => { cur = month; } });
    });
    planSheet.addEventListener('click', (e) => {
      const p = e.target.closest('[data-p]');
      if (p) { prov = p.dataset.p; renderProvs(); return; }
      const n = e.target.closest('[data-n]');
      if (n) { $('#pN').value = n.dataset.n; clearFieldError($('#pN')); preview(); }
    });
    planSheet.addEventListener('input', (e) => { if (['pMonthly', 'pN', 'pStart'].includes(e.target.id)) { preview(); renderPast({ reset: e.target.id !== 'pMonthly' }); } });
    planSheet.addEventListener('change', (e) => {
      if (e.target.id === 'pStart') { preview(); renderPast({ reset: true }); }
      if (e.target.name === 'pPast') renderPast();
    });
    planSheet.addEventListener('click', (e) => {
      const b = e.target.closest('#pPaidLess, #pPaidMore');
      if (!b) return;
      e.preventDefault(); // inside a label: do not toggle the radio
      const p = pastDue();
      if (!p) return;
      pastN = Math.min(p.count, Math.max(0, pastN + (b.id === 'pPaidMore' ? 1 : -1)));
      renderPast();
    });
    planSheet.addEventListener('submit', async (e) => {
      e.preventDefault();
      // The user enters the monthly payment; the plan stores the total (monthly × n), so every payment is equal.
      let monthly;
      try { monthly = parseAmount($('#pMonthly').value); } catch (err) { fieldError($('#pMonthly'), errMsg(err), $('#pMonthlyW').parentElement); return; }
      const n = readN();
      // Known providers are stored as canonical ids ('tabby' / 'tamara'); a custom name stays as typed.
      const provider = prov === 'other' ? ($('#provOther').value.trim() || t('prov.other')) : prov;
      const item = $('#pItem').value.trim() || t('plan.defaultItem');
      const startDate = $('#pStart').value || `${cur}-01`;
      if (!(n >= 1 && n <= 48)) { fieldError($('#pN'), errMsg(new Error('invalid-months')), $('#pNW').parentElement); return; }
      const firstPaid = $('#pFirst').checked;
      const total = monthly * n;
      const past = pastDue();
      const paidCount = past ? (planSheet.querySelector('input[name=pPast]:checked').value === 'some' ? pastN : past.count) : undefined;
      await mutate(() => {
        addPlan(state, { provider, item, total, n, start: startDate, firstPaid, paidCount });
        return t('toast.planAdded', { provider: provLabel(provider), n, amount: money(paymentAmount({ total, n }, 0)) });
      }, { sheet: true });
    });
    fxSheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fc]');
      if (!b) return;
      fxPick = b.dataset.fc;
      renderFxChips();
    });
    fxSheet.addEventListener('submit', async (e) => {
      e.preventDefault();
      let amount;
      try { amount = parseAmount($('#fxAmt').value); } catch (err) { fieldError($('#fxAmt'), errMsg(err), fxSheet.querySelector('.amt')); return; }
      const ds = latin($('#fxDay').value);
      const day = /^\d+$/.test(ds) ? Number(ds) : NaN;
      if (!(day >= 1 && day <= 28)) { fieldError($('#fxDay'), t('err.invalid-day'), $('#fxDayW').parentElement); return; }
      const cat = getCategory(state, fxPick);
      if (!cat || cat.deleted) { toast(errMsg(new Error('invalid-tx'))); return; }
      const note = $('#fxNote').value.trim();
      const name = catLabel(cat, t) + (note ? ` · ${note}` : '');
      await mutate(() => {
        addFixed(state, { catId: cat.id, amount, day, note }, todayLocal());
        applyFixed(state, todayLocal());
        return t('toast.fxAdded', { name, amount: formatAmount(amount, lang), day });
      }, { sheet: true });
    });
  }

  skeleton();
  render();
  wide.addEventListener('change', () => { closePicker(false); render({ keepBud: true }); });

  return {
    // Re-localise (language change). Keeps the month, tab and open state.
    update(next = {}) {
      if (next.t) t = next.t;
      if (next.lang) lang = next.lang;
      const wasOpen = document.querySelector('.sheet.on');
      if (wasOpen && [logSheet, planSheet, fxSheet].includes(wasOpen)) closeSheet(false);
      pickYear = null;
      skeleton();
      render();
    },
    render,
    showTab(k) { tab = k; render(); scrollTo(0, 0); },
    openLog,
    openPlan,
    // FAB: «أضف قسط» on the installments tab, «سجّل صرف» otherwise.
    fab() { if (tab === 'ins' && isOn()) openPlan(); else openLog(); },
    get month() { return cur; },
  };
}
