// Shell boot: settings → language → palette → service worker → welcome (first run) → hub → routing → sync.
import { detectLang, setLang, getLang, t, dir, loadLocales } from './i18n.js';
import { loadSettings, saveSettings, loadState, saveState, requestPersist, onStateSaved, loadOutbox } from './store.js';
import { createState, uid, DEFAULT_CAT_KEYS } from './model.js';
import { todayLocal, periodOf, monthStartOf, periodProgress, periodBounds } from './months.js';
import { formatAmount } from './money.js';
import { mountExpenses, projectedSummary, countKey } from '../tools/expenses/view.js';
import { upcomingPayments } from '../tools/expenses/installments.js';
import { applyFixed } from '../tools/expenses/fixed.js';
import { getCategory, catLabel } from './model.js';
import { applyPalette } from './theme.js';
import { onRoute } from './router.js';
import { toast } from './ui.js';
import { needsBackupReminder } from './backup.js';
import { syncNow } from './sync.js';
import { mergeStates, mergeForSave } from './merge.js';
import { createSyncScheduler } from './autosync.js';
import { mountSettings } from './settings-view.js';
import { mountWelcome } from '../onboarding/welcome.js';
import { createFeedback } from './feedback-view.js';
import { createWhatsNew } from './whatsnew-view.js';
import { APP_VERSION } from './version.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${esc(name)}"/></svg>`;
const NAV = [['home', 'nav.home', 'home'], ['expenses', 'nav.expenses', 'wallet'], ['prefs', 'nav.settings', 'gear']];

let tools = [];
let current = 'home';
let booted = false;
let state = null;
let expenses = null;
let prefs = null;
let feedback = null; // «راسلنا» sheet, created on first use
let whatsNew = null; // «وش الجديد» sheet
// True when the saved state could not be read: nothing may be written until a retry succeeds,
// otherwise the first save would replace the user's real data with an empty state.
let loadFailed = false;
// True when readState found nothing saved (first run, or data cleared).
let freshStart = false;
// Device settings (IndexedDB 'settings', never synced). settingsOk=false when the read failed:
// then settings are used in memory only and never written (a write would wipe the stored token).
let settings = {};
let settingsOk = true;
let bannerDismissed = false;
let syncInfo = { running: false, error: null };
let installEvt = null;
// Credentials typed in Settings for «مزامنة الآن»: used for that one run and saved only if it succeeds.
let pendingCreds = null;

// Captured early so the welcome install step can offer a real «install» button.
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  dispatchEvent(new CustomEvent('toolbox:installable'));
});

// Fallback for a device that finished the welcome but has no saved state (in memory only;
// written on the first change).
export function initialState() { return createState(DEFAULT_CAT_KEYS); }

async function persistSettings() {
  if (!settingsOk) return;
  try { await saveSettings(settings); } catch { /* device settings are best effort */ }
}

const syncReady = () => !loadFailed && !!state && settings.mode === 'sync' && !!settings.token && !!settings.passphrase;
const credsFor = () => pendingCreds || (syncReady() ? { token: settings.token, passphrase: settings.passphrase } : null);
const emitSync = () => dispatchEvent(new CustomEvent('toolbox:sync', { detail: { ...syncInfo } }));

// One sync: push a snapshot, then fold the result back into the live state (merging again so
// edits made while the request was in flight survive; the debounced follow-up uploads them).
async function runSync() {
  const creds = credsFor();
  if (!creds || loadFailed || !state) return null;
  const trial = creds === pendingCreds;
  syncInfo = { running: true, error: null };
  emitSync();
  try {
    const res = await syncNow({
      state: structuredClone(state), token: creds.token, passphrase: creds.passphrase,
      deviceId: settings.deviceId,
    });
    if (loadFailed || !state) return null;
    // New credentials become the device's settings only now that a sync has succeeded.
    if (trial) Object.assign(settings, { token: creds.token, passphrase: creds.passphrase, mode: 'sync' });
    await replaceState(mergeStates(state, res.state), { fromSync: true });
    settings.lastSyncAt = Date.now();
    await persistSettings();
    syncInfo = { running: false, error: null };
    return res;
  } catch (e) {
    syncInfo = { running: false, error: (e && e.message) || 'sync-failed' };
    throw e;
  } finally {
    if (syncInfo.running) syncInfo = { running: false, error: null };
    emitSync();
  }
}

const scheduler = createSyncScheduler({ run: runSync, delay: 5000 });

function autoSyncSoon() {
  if (syncReady() && navigator.onLine !== false) scheduler.schedule();
}

// Put `src`'s contents into the live state object in place (the expenses view holds it).
function adopt(src) {
  if (!state || !src || src === state) return;
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, src);
}

function rerender() {
  if (expenses) expenses.render({ keepBud: !!document.activeElement?.closest?.('#view-expenses input') });
  updateHomeSub();
}

async function save(s) {
  if (loadFailed) return;
  const merged = await saveState(s);
  // Live side wins: keep edits made while this save was in flight.
  if (s === state) adopt(mergeForSave(merged, state));
  autoSyncSoon();
}

// Another tab saved: fold the stored state into this tab's (never writes) and re-render.
async function onOtherTabSaved() {
  if (loadFailed || !state) return;
  let stored;
  try { stored = await loadState(); } catch { return; }
  if (!stored || loadFailed || !state) return;
  adopt(mergeForSave(stored, state));
  rerender();
}

// Replace the live state's contents in place (the expenses view holds the same object), save,
// and re-render. Rolls back if the save fails. Never runs after a failed read.
async function replaceState(next, { fromSync = false } = {}) {
  if (loadFailed || !state) throw new Error('load-failed');
  const snap = structuredClone(state);
  adopt(next);
  let merged;
  try { merged = await saveState(state); } catch (e) { adopt(snap); throw e; }
  adopt(mergeForSave(merged, state)); // keep edits made during the save
  if (!fromSync) autoSyncSoon();
  rerender();
}

// Hub card line (what is left this month) and, on a PC, the summary above the tools.
function updateHomeSub() {
  const e = document.getElementById('home-sub-expenses');
  if (!e || !state) return;
  const today = todayLocal();
  const s = monthStartOf(state);
  const month = periodOf(today, s);
  const lang = getLang();
  const money = (h) => formatAmount(h, lang);
  const sum = projectedSummary(state, month);
  e.textContent = t('home.left', { amount: money(sum.remainingNow) });
  const box = document.getElementById('homeSum');
  if (!box) return;
  const loc = lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-US';
  const asDate = (d) => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  const dm = (d) => new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long' }).format(asDate(d));
  const mon = (d) => new Intl.DateTimeFormat(loc, { month: 'long' }).format(asDate(d));
  const prog = periodProgress(month, today, s);
  const pct = sum.income > 0 ? Math.round((sum.spent / sum.income) * 100) : null;
  let line = '';
  if (prog && sum.income > 0 && sum.remainingNow > 0) {
    const left = prog.left === 1 ? t('days.last') : prog.left === 2 ? t('days.two') : t(prog.left <= 10 ? 'days.few' : 'days.many', { n: prog.left });
    line = `${money(Math.floor(sum.remainingNow / prog.left / 100) * 100)} ${t('currency')} ${t('sum.daily')} · ${t('sum.dailyUntil', { date: dm(periodBounds(month, s).to), left })}`;
  } else if (prog && sum.income > 0) line = t('sum.dailyNone');
  const meter = pct === null ? '' : `<div class="ex-meter hs-meter"><div class="bar"><i class="${pct > 100 ? 'over' : ''}" style="width:${Math.min(100, Math.max(0, pct))}%"></i></div>`
    + `${prog ? `<span class="ex-now" style="inset-inline-start:${Math.round((prog.passed / prog.length) * 100)}%"></span>` : ''}</div>`;
  const ups = upcomingPayments(state, today, 2);
  const soon = (n) => (n === 0 ? t('soon.today') : t(countKey('soon', n), { n }));
  const live = state.tx.filter((x) => !x.deleted).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt).slice(0, 3);
  const dayWord = (d) => {
    const diff = Math.round((asDate(today) - asDate(d)) / 864e5);
    if (diff === 0) return t('day.today');
    if (diff === 1) return t('day.yesterday');
    return new Intl.DateTimeFormat(loc, diff < 7 ? { weekday: 'long' } : { day: 'numeric', month: 'long' }).format(asDate(d));
  };
  const provName = (p) => { const k = String(p).toLowerCase(); return k === 'tabby' || k === 'tamara' ? t(`prov.${k}`) : p; };
  box.innerHTML = `<div class="card hero hs-main"><div class="lbl">${icon('wallet')}${esc(t('home.sumTitle', { month: mon(`${month}-01`) }))}</div>`
    + `<div class="big">${esc(money(sum.remainingNow))} <span>${esc(t('currency'))}</span></div>${meter}`
    + `${line ? `<p class="hs-line">${esc(line)}</p>` : ''}`
    + `<div class="row hs-act"><button class="btn ex-log" type="button" data-quick="log">${icon('plus')}<span>${esc(t('sheet.log.title'))}</span></button><a class="btn sec" href="#expenses">${esc(t('home.open'))}</a></div></div>`
    + `<div class="card"><h2>${esc(t('home.upcoming'))}</h2>${ups.length ? ups.map((u) => `<div class="hs-row"><div class="nx-d"><b>${asDate(u.date).getDate()}</b><small>${esc(mon(u.date))}</small></div><div class="m">${esc(u.plan.item)}<small>${esc(provName(u.plan.provider))} · ${esc(soon(u.inDays))}</small></div><b>${esc(money(u.amount))}</b></div>`).join('') : `<p class="note">${esc(t('home.noUpcoming'))}</p>`}</div>`
    + `<div class="card"><h2>${esc(t('home.recent'))}</h2>${live.length ? live.map((x) => { const c = getCategory(state, x.catId); return `<div class="hs-row"><div class="m">${esc(c ? catLabel(c, t) : '')}<small>${esc(dayWord(x.date))}${x.note ? ` · ${esc(x.note)}` : ''}</small></div><b>${esc(money(x.amount))}</b></div>`; }).join('') : `<p class="note">${esc(t('home.noRecent'))}</p>`}</div>`;
}

function renderLoadError() {
  const el = document.getElementById('view-expenses');
  el.dataset.mounted = '1';
  el.innerHTML = `<div class="card ex-loaderr" id="exLoadErr" role="alert"><h2>${esc(t('nav.expenses'))}</h2>`
    + `<p>${esc(t('err.load'))}</p><button class="btn" type="button" id="exRetry">${esc(t('load.retry'))}</button></div>`;
}

// Reads the saved state. null = first run (fresh in-memory state); a thrown error = read failure.
async function readState() {
  try {
    const saved = await loadState();
    freshStart = saved == null;
    state = saved || null;
    loadFailed = false;
  } catch {
    state = null;
    loadFailed = true;
  }
}

async function retryLoad() {
  await readState();
  if (loadFailed) { toast(t('err.load')); return; }
  if (!state) state = initialState();
  document.getElementById('view-expenses').innerHTML = '';
  ensureExpenses();
  updateHomeSub();
  $('#fab').classList.add('on');
}

function ensureExpenses() {
  if (loadFailed) { renderLoadError(); return null; }
  if (!expenses && state) {
    expenses = mountExpenses(document.getElementById('view-expenses'), { state, save, t, lang: getLang() });
  }
  return expenses;
}

async function getJSON(rel) {
  const r = await fetch(new URL(rel, import.meta.url));
  if (!r.ok) throw new Error(`${rel}: ${r.status}`);
  return r.json();
}

function renderNav() {
  const link = ([r, key, ic]) => `<a href="#${r}" data-r="${r}" title="${esc(t(key))}">${icon(ic)}<span class="nl">${esc(t(key))}</span></a>`;
  $('#sideNav').innerHTML = NAV.map(link).join('');
  // Phone bar: home, expenses, «سجّل صرف» (+) in the middle, reports, settings.
  const fab = $('#fab');
  $('#bNav').innerHTML = link(NAV[0]) + link(NAV[1])
    + `<a href="#expenses" data-rep title="${esc(t('tab.reports'))}">${icon('chart')}<span class="nl">${esc(t('tab.reports'))}</span></a>` + link(NAV[2]);
  $('#bNav').insertBefore(fab, $('#bNav [data-rep]'));
  $('#bNav').setAttribute('aria-label', t('nav.menu'));
  $('#sideNav').setAttribute('aria-label', t('nav.menu'));
  $('#brandName').textContent = t('app.name');
  $('#fab').setAttribute('aria-label', t('sheet.log.title'));
}

function renderHome() {
  const lang = getLang();
  const cards = tools.map((tool) => {
    const title = esc((tool.title && (tool.title[lang] || tool.title.en)) || tool.id);
    const link = `<a href="#${esc(tool.id)}" class="tlink"><span class="ic">${icon(tool.icon)}</span><b>${title}</b><small id="home-sub-${esc(tool.id)}"></small></a>`;
    const quick = tool.id === 'expenses'
      ? `<button class="quick" type="button" data-quick="log">${icon('plus')}${esc(t('sheet.log.title'))}</button>` : '';
    return `<div class="tool" data-tool="${esc(tool.id)}">${link}${quick}</div>`;
  }).join('');
  $('#view-home').innerHTML = `<div class="row"><h1>${esc(t('app.name'))}</h1></div>`
    + `<p class="lead">${esc(t('home.lead'))}</p><div id="updBanner"></div><div id="homeBanner"></div>`
    + `<section class="home-sum" id="homeSum"></section><h2 class="home-tools-h">${esc(t('home.tools'))}</h2>`
    + `<div class="tools">${cards}<button class="fb-entry" type="button" id="fbOpen"><span class="ic">${icon('chat')}</span>`
    + `<span><b>${esc(t('fb.entry'))}</b><small>${esc(t('fb.entrySub'))}</small></span>`
    + `<svg class="i chev" aria-hidden="true"><use href="#i-chev"/></svg></button></div>`;
  renderBanner();
  renderUpdate();
}

// «تم التحديث إلى …»: once per version, for a device that had an earlier version.
function renderUpdate() {
  const el = document.getElementById('updBanner');
  if (!el) return;
  const show = settingsOk && settings.onboarded === true && settings.seenVersion !== APP_VERSION;
  el.innerHTML = show
    ? `<div class="upd" role="status"><span class="dot" aria-hidden="true">✨</span>`
      + `<span class="txt"><b>${esc(t('upd.title', { v: APP_VERSION }))}</b><small>${esc(t('upd.sub'))}</small></span>`
      + `<button class="go" type="button" data-wn>${esc(t('upd.go'))}</button>`
      + `<button class="x" type="button" id="updDismiss" aria-label="${esc(t('upd.dismiss'))}">✕</button></div>`
    : '';
}

function markSeen() {
  if (settings.seenVersion === APP_VERSION) return;
  settings.seenVersion = APP_VERSION;
  persistSettings();
  renderUpdate();
}

// «خذ نسخة احتياطية» reminder: local mode only, 30 days after the last backup (or after onboarding).
function renderBanner() {
  const el = document.getElementById('homeBanner');
  if (!el) return;
  const since = settings.lastBackupAt ?? settings.onboardedAt ?? null;
  const show = !bannerDismissed && !loadFailed && settings.mode !== 'sync' && needsBackupReminder(since, Date.now());
  el.innerHTML = show
    ? `<div class="card banner" id="backupBanner" role="status"><p>${esc(t('home.backup'))}</p>`
      + `<div class="row"><a class="btn" href="#prefs">${esc(t('home.backupGo'))}</a>`
      + `<button class="btn sec" type="button" id="backupDismiss">${esc(t('home.dismiss'))}</button></div></div>`
    : '';
}

// Placeholders; Tasks 12–13 mount into #view-expenses and #view-prefs (replacing this content).
function renderPlaceholders() {
  for (const [id, key] of [['view-expenses', 'nav.expenses'], ['view-prefs', 'nav.settings']]) {
    const el = document.getElementById(id);
    if (!el.dataset.mounted) el.innerHTML = `<h1>${esc(t(key))}</h1>`;
  }
}

function show(view) {
  current = view;
  document.querySelectorAll('.view').forEach((e) => e.classList.toggle('on', e.id === `view-${view}`));
  document.querySelectorAll('[data-r]').forEach((a) => {
    const on = a.dataset.r === view;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (view === 'expenses') ensureExpenses();
  if (view === 'prefs') ensurePrefs();
  $('#fab').classList.toggle('on', !loadFailed); // in the phone bar on every page (hidden on a PC)
  document.body.dataset.view = view;
  scrollTo(0, 0);
  dispatchEvent(new CustomEvent('toolbox:route', { detail: { view } }));
}

// Re-localise the whole shell (used at boot and by Settings when the language changes).
export function applyLanguage(lang) {
  setLang(lang);
  const l = getLang();
  document.documentElement.lang = l;
  document.documentElement.dir = dir(l);
  document.title = t('app.name');
  renderNav();
  renderHome();
  renderPlaceholders();
  if (expenses) expenses.update({ t, lang: l });
  else if (loadFailed && document.getElementById('exLoadErr')) renderLoadError();
  if (prefs) prefs.update({ t });
  if (feedback) feedback.update({ t, getLang });
  if (whatsNew) whatsNew.update({ t, getLang });
  updateHomeSub();
  if (booted) show(current);
}

function wire() {
  // Quick «سجّل صرف» and the floating + : Task 12 listens for 'toolbox:log' to open the log sheet.
  document.addEventListener('click', (e) => {
    if (e.target.closest('#exRetry')) {
      retryLoad();
    } else if (e.target.closest('[data-wn]')) {
      if (!whatsNew) whatsNew = createWhatsNew({ t, getLang });
      whatsNew.open();
      markSeen();
    } else if (e.target.closest('#updDismiss')) {
      markSeen();
    } else if (e.target.closest('#fbOpen')) {
      ensureFeedback().open();
    } else if (e.target.closest('#backupDismiss')) {
      bannerDismissed = true;
      renderBanner();
    } else if (e.target.closest('[data-quick=log]')) {
      if (location.hash !== '#expenses') location.hash = '#expenses';
      dispatchEvent(new CustomEvent('toolbox:log'));
    } else if (e.target.closest('#fab')) {
      if (location.hash.split('/')[0] !== '#expenses') location.hash = '#expenses';
      dispatchEvent(new CustomEvent('toolbox:log', { detail: { source: 'fab' } }));
    } else if (e.target.closest('[data-rep]')) {
      e.preventDefault();
      if (location.hash.split('/')[0] !== '#expenses') location.hash = '#expenses';
      ensureExpenses()?.showTab('rep');
    }
  });
  // The FAB opens «أضف قسط» on the installments tab; the hub's quick button always opens «سجّل صرف».
  addEventListener('toolbox:log', (e) => {
    const x = ensureExpenses();
    if (!x) return;
    if (e.detail && e.detail.source === 'fab') x.fab(); else x.openLog();
  });
  addEventListener('toolbox:expenses-changed', updateHomeSub);
  // N («سجّل صرف») from anywhere, unless typing or a sheet is open. KeyN, so it works on an Arabic keyboard too.
  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyN' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
    if ($('#app').hidden || loadFailed || document.querySelector('.sheet.on') || popoverOpen()) return;
    if (e.target.closest && e.target.closest('input,select,textarea,[contenteditable]')) return;
    e.preventDefault();
    if (location.hash.split('/')[0] !== '#expenses') location.hash = '#expenses';
    dispatchEvent(new CustomEvent('toolbox:log'));
  });
  // Back to the app on a new day: log the fixed expenses that became due.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') logFixed(); });
  addEventListener('online', autoSyncSoon);
  addEventListener('online', () => ensureFeedback().flush());
  onStateSaved(onOtherTabSaved);
}

function ensureFeedback() {
  if (!feedback) feedback = createFeedback({ t, getLang });
  return feedback;
}

function ensurePrefs() {
  if (prefs) return prefs;
  prefs = mountSettings(document.getElementById('view-prefs'), {
    t, getLang, settings,
    persist: persistSettings,
    setLanguage(l) { settings.lang = l; persistSettings(); applyLanguage(l); },
    applyPalette: (p) => applyPalette(document.documentElement, p),
    getState: () => (loadFailed ? null : state),
    replaceState: (next) => replaceState(next),
    onBackedUp: renderBanner,
    // creds: { token, passphrase } typed in Settings; saved only if this sync succeeds.
    async sync(creds) {
      pendingCreds = creds || null;
      try { return await scheduler.runNow(); } finally { pendingCreds = null; }
    },
    settingsOk: () => settingsOk,
    syncInfo: () => syncInfo,
    stopSync() { scheduler.cancel(); pendingCreds = null; syncInfo = { running: false, error: null }; emitSync(); renderBanner(); },
  });
  return prefs;
}

// First run: show the welcome over a hidden shell; resolves once the new state is saved.
function runWelcome() {
  const el = document.getElementById('welcome');
  el.hidden = false;
  return new Promise((resolve) => {
    mountWelcome(el, async (s, choices) => {
      state = await saveState(s); // a rejection keeps the welcome open (it shows err.save)
      freshStart = false;
      requestPersist();
      const { lang, mode, token, passphrase } = choices || {};
      Object.assign(settings, { onboarded: true, onboardedAt: Date.now(), seenVersion: APP_VERSION, lang: lang || getLang(), mode: mode === 'sync' ? 'sync' : 'local' });
      if (settings.mode === 'sync') Object.assign(settings, { token, passphrase });
      await persistSettings();
      el.hidden = true;
      el.innerHTML = '';
      if (location.hash !== '#home') history.replaceState(null, '', '#home');
      resolve();
    }, {
      lang: settings.lang,
      deviceId: settings.deviceId,
      install: {
        available: () => !!installEvt,
        async prompt() { const e = installEvt; if (!e) return; installEvt = null; await e.prompt(); try { await e.userChoice; } catch { /* dismissed */ } },
      },
    });
  });
}

// An open popover (e.g. «ما معنى هذه الأرقام؟»); older browsers have no :popover-open.
function popoverOpen() {
  try { return !!document.querySelector(':popover-open'); } catch { return false; }
}

// Fixed monthly expenses that are due by today become transactions (saved, then shown).
function logFixed() {
  if (loadFailed || !state) return;
  if (applyFixed(state, todayLocal())) save(state).then(rerender).catch(() => {});
}

async function boot() {
  try { settings = (await loadSettings()) || {}; } catch { settings = {}; settingsOk = false; }
  const [ar, en, list] = await Promise.all([
    getJSON('./locales/ar.json'), getJSON('./locales/en.json'), getJSON('../tools.json').catch(() => []),
    readState(),
  ]);
  loadLocales(ar, en);
  tools = Array.isArray(list) ? list : [];
  const palette = settings.palette === 'custom' && settings.customPalette ? settings.customPalette : (settings.palette || 'graphite');
  applyPalette(document.documentElement, palette);
  if (!settings.deviceId) { settings.deviceId = uid(); persistSettings(); }
  // Registered before the welcome so the install step can work offline-capable.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }
  // Welcome only on a successful read that found nothing, on a device that never finished it.
  if (!loadFailed && freshStart && settings.onboarded !== true) await runWelcome();
  if (!loadFailed && !state) state = initialState();
  logFixed();
  wire();
  applyLanguage(settings.lang ?? detectLang(navigator.languages));
  onRoute(show);
  booted = true;
  $('#app').hidden = false;
  if (syncReady() && navigator.onLine !== false) scheduler.runNow().catch(() => {});
  // Messages written offline earlier: send them now (only builds the sheet if any are waiting).
  loadOutbox().then((box) => { if (box.length) ensureFeedback().flush(); }).catch(() => {});
}

boot();
