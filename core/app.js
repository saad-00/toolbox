// Shell boot: settings → language → palette → service worker → hub → routing.
import { detectLang, setLang, getLang, t, dir, loadLocales } from './i18n.js';
import { loadSettings } from './store.js';
import { applyPalette } from './theme.js';
import { onRoute } from './router.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${esc(name)}"/></svg>`;
const NAV = [['home', 'nav.home', 'home'], ['expenses', 'nav.expenses', 'wallet'], ['prefs', 'nav.settings', 'gear']];

let tools = [];
let current = 'home';
let booted = false;

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
  $('#fab').classList.toggle('on', view === 'expenses');
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
  if (booted) show(current);
}

function wire() {
  // Quick «سجّل صرف» and the floating + : Task 12 listens for 'toolbox:log' to open the log sheet.
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-quick=log]')) {
      if (location.hash !== '#expenses') location.hash = '#expenses';
      dispatchEvent(new CustomEvent('toolbox:log'));
    } else if (e.target.closest('#fab')) {
      dispatchEvent(new CustomEvent('toolbox:log'));
    }
  });
}

async function boot() {
  let settings = {};
  try { settings = (await loadSettings()) || {}; } catch { settings = {}; }
  const [ar, en, list] = await Promise.all([
    getJSON('./locales/ar.json'), getJSON('./locales/en.json'), getJSON('../tools.json').catch(() => []),
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
