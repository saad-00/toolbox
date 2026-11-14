// Shell boot: settings → language → palette → service worker → hub → routing.
import { detectLang, setLang, getLang, t, dir, loadLocales } from './i18n.js';
import { loadSettings, loadState, saveState } from './store.js';
import { createState } from './model.js';
import { monthOf, todayLocal } from './months.js';
import { formatAmount } from './money.js';
import { mountExpenses, projectedSummary } from '../tools/expenses/view.js';
import { applyPalette } from './theme.js';
import { onRoute } from './router.js';
import { toast } from './ui.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${esc(name)}"/></svg>`;
const NAV = [['home', 'nav.home', 'home'], ['expenses', 'nav.expenses', 'wallet'], ['prefs', 'nav.settings', 'gear']];

let tools = [];
let current = 'home';
let booted = false;
let state = null;
let expenses = null;
// True when the saved state could not be read: nothing may be written until a retry succeeds,
// otherwise the first save would replace the user's real data with an empty state.
let loadFailed = false;

const DEFAULT_CATS = ['cat.housing', 'cat.bills', 'cat.mobileNet', 'cat.food', 'cat.transport',
  'cat.subscriptions', 'cat.emergency', 'cat.savings', 'cat.allowance'];

// First-run state (in memory only; written on the first change). Task 13's welcome screen replaces this.
export function initialState() { return createState(DEFAULT_CATS); }

async function save(s) {
  if (loadFailed) return;
  await saveState(s);
}

// Hub card line: what is left this month.
function updateHomeSub() {
  const e = document.getElementById('home-sub-expenses');
  if (!e || !state) return;
  const sum = projectedSummary(state, monthOf(todayLocal()));
  e.textContent = t('home.left', { amount: formatAmount(sum.remainingNow, getLang()) });
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
    state = saved || initialState();
    loadFailed = false;
  } catch {
    state = null;
    loadFailed = true;
  }
}

async function retryLoad() {
  await readState();
  if (loadFailed) { toast(t('err.load')); return; }
  document.getElementById('view-expenses').innerHTML = '';
  ensureExpenses();
  updateHomeSub();
  if (current === 'expenses') $('#fab').classList.add('on');
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
  const html = NAV.map(([r, key, ic]) => `<a href="#${r}" data-r="${r}">${icon(ic)}${esc(t(key))}</a>`).join('');
  $('#sideNav').innerHTML = html;
  $('#bNav').innerHTML = html;
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
    + `<p class="lead">${esc(t('home.lead'))}</p><div class="tools">${cards}</div>`;
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
  $('#fab').classList.toggle('on', view === 'expenses' && !loadFailed);
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
  updateHomeSub();
  if (booted) show(current);
}

function wire() {
  // Quick «سجّل صرف» and the floating + : Task 12 listens for 'toolbox:log' to open the log sheet.
  document.addEventListener('click', (e) => {
    if (e.target.closest('#exRetry')) {
      retryLoad();
    } else if (e.target.closest('[data-quick=log]')) {
      if (location.hash !== '#expenses') location.hash = '#expenses';
      dispatchEvent(new CustomEvent('toolbox:log'));
    } else if (e.target.closest('#fab')) {
      dispatchEvent(new CustomEvent('toolbox:log', { detail: { source: 'fab' } }));
    }
  });
  // The FAB opens «أضف قسط» on the installments tab; the hub's quick button always opens «سجّل صرف».
  addEventListener('toolbox:log', (e) => {
    const x = ensureExpenses();
    if (!x) return;
    if (e.detail && e.detail.source === 'fab') x.fab(); else x.openLog();
  });
  addEventListener('toolbox:expenses-changed', updateHomeSub);
}

async function boot() {
  let settings = {};
  try { settings = (await loadSettings()) || {}; } catch { settings = {}; }
  const [ar, en, list] = await Promise.all([
    getJSON('./locales/ar.json'), getJSON('./locales/en.json'), getJSON('../tools.json').catch(() => []),
    readState(),
  ]);
  loadLocales(ar, en);
  tools = Array.isArray(list) ? list : [];
  const palette = settings.palette === 'custom' && settings.customPalette ? settings.customPalette : (settings.palette || 'graphite');
  applyPalette(document.documentElement, palette);
  wire();
  applyLanguage(settings.lang ?? detectLang(navigator.languages));
  onRoute(show);
  booted = true;
  $('#app').hidden = false;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }
}

boot();
