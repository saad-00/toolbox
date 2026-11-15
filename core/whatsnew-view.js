// «وش الجديد» sheet: a timeline of releases, newest first.
import { RELEASES } from './version.js';
import { openSheet, closeSheet } from './ui.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(iso, lang) {
  const [y, m, d] = iso.split('-').map(Number);
  const loc = lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB';
  return new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
}

export function createWhatsNew(ctx) {
  let { t, getLang } = ctx;
  let sheet = document.getElementById('wnSheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'wnSheet';
    sheet.className = 'sheet';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  }

  function render() {
    const lang = getLang();
    sheet.setAttribute('aria-label', t('wn.title'));
    const items = RELEASES.map((r, i) => `<li class="${i ? '' : 'new'}"><div class="v"><b dir="ltr">${esc(r.v)}</b>`
      + `${i ? '' : `<span class="tag">${esc(t('wn.latest'))}</span>`}<small>${esc(fmtDate(r.date, lang))}</small></div>`
      + `<ul>${(r[lang] || r.en).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></li>`).join('');
    sheet.innerHTML = `<div class="row"><h2 class="sheet-h">${esc(t('wn.title'))}</h2><span class="sp"></span>`
      + `<button type="button" class="icon-btn" data-close aria-label="${esc(t('sheet.close'))}">✕</button></div>`
      + `<ul class="wn">${items}</ul>`;
  }

  return {
    open() { render(); openSheet(sheet); },
    update(next = {}) { if (next.t) t = next.t; if (next.getLang) getLang = next.getLang; if (sheet.classList.contains('on')) render(); },
  };
}
