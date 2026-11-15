// Settings screen (#prefs): language, palette, backup, sync. Everything here is device-local
// (IndexedDB 'settings'), never synced. The app owns state and sync; ctx exposes them:
// ctx = { t, getLang, settings, persist(), setLanguage(l), applyPalette(p), getState(),
//         replaceState(next), onBackedUp(), sync(creds), syncInfo(), stopSync(), settingsOk() }
import { PALETTES } from './theme.js';
import { exportBackup, importBackup } from './backup.js';
import { toast } from './ui.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEFAULT_CUSTOM = { bg: '#101828', b1: '#ff7a59', b2: '#7c5cff', b3: '#00c2a8' };
const CUSTOM_KEYS = [['cBg', 'bg'], ['cB1', 'b1'], ['cB2', 'b2'], ['cB3', 'b3']];

export function mountSettings(el, ctx) {
  const { settings } = ctx;
  let t = ctx.t;
  let customOpen = settings.palette === 'custom';
  let saveTimer = null;
  el.dataset.mounted = '1';

  const $ = (s) => el.querySelector(s);
  const when = (ms) => new Intl.DateTimeFormat(ctx.getLang() === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-US',
    { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
  const custom = () => ({ ...DEFAULT_CUSTOM, ...(settings.customPalette || {}) });
  const currentPal = () => settings.palette || 'graphite';
  const syncOn = () => settings.mode === 'sync';

  function swatch(id, p) {
    const style = p ? ` style="background:radial-gradient(circle at 30% 30%,${p.b1},${p.b2} 55%,${p.bg})"` : '';
    const label = esc(t(`palette.${id}`));
    return `<button type="button" class="sw${p ? '' : ' cus'}" data-p="${id}" aria-label="${label}" title="${label}" aria-pressed="${currentPal() === id}"${style}></button>`;
  }

  function skeleton() {
    const c = custom();
    const noSave = ctx.settingsOk && !ctx.settingsOk()
      ? `<p class="card serr" id="sSettingsErr" role="alert">${esc(t('set.cantSave'))}</p>` : '';
    el.innerHTML = `<h1>${esc(t('nav.settings'))}</h1><p class="lead">${esc(t('set.lead'))}</p>${noSave}
<div class="grid2 prefs">
 <div class="card">
  <h2>${esc(t('set.lang'))}</h2>
  <div class="seg" role="group" aria-label="${esc(t('set.lang'))}">${['ar', 'en'].map((l) => `<button type="button" data-lang="${l}" lang="${l}" aria-pressed="${ctx.getLang() === l}">${esc(t(`lang.${l}`))}</button>`).join('')}</div>
  <h2 class="sp-h">${esc(t('set.palette'))}</h2>
  <div class="swatches" role="group" aria-label="${esc(t('set.palette'))}">${PALETTES.map((p) => swatch(p.id, p)).join('')}${swatch('custom', null)}</div>
  <p class="note" id="sPalName"></p>
  <div class="cpanel" id="sCustom"${customOpen ? '' : ' hidden'}>
   <h3>${esc(t('set.custom.title'))}</h3>
   ${CUSTOM_KEYS.map(([id, k]) => `<label>${esc(t(`set.custom.${k}`))}<input type="color" id="${id}" value="${esc(c[k])}"></label>`).join('')}
  </div>
 </div>
 <div class="card">
  <h2>${esc(t('set.backup'))}</h2>
  <p class="note" id="sBackupInfo"></p>
  <div class="row"><button class="btn" type="button" id="sBackup">${esc(t('set.backupBtn'))}</button>`
      + `<button class="btn sec" type="button" id="sRestore">${esc(t('set.restoreBtn'))}</button>`
      + `<input type="file" id="sImport" accept="application/json,.json" hidden></div>
  <p class="note">${esc(t('set.restoreNote'))}</p>
  <h2 class="sp-h">${esc(t('set.sync'))}</h2>
  <p class="note sstatus" id="sStatus" aria-live="polite"></p>
  <details id="sAdv"${syncOn() ? ' open' : ''}><summary>${esc(t('adv.title'))}</summary>
   <label class="wfield">${esc(t('sync.token'))}<input type="password" id="sToken" autocomplete="off" dir="ltr" placeholder="github_pat_…"></label>
   <label class="wfield">${esc(t('sync.pass'))}<input type="password" id="sPass" autocomplete="new-password"></label>
   <div class="row"><button class="btn" type="button" id="sSyncNow">${esc(t('sync.now'))}</button><button class="btn sec" type="button" id="sStop">${esc(t('sync.stop'))}</button></div>
  </details>
 </div>
</div>`;
    $('#sToken').value = settings.token || '';
    $('#sPass').value = settings.passphrase || '';
    renderPalette();
    renderBackupInfo();
    renderStatus();
  }

  function renderPalette() {
    const id = currentPal();
    el.querySelectorAll('[data-p]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === id)));
    $('#sPalName').textContent = t(`palette.${PALETTES.some((p) => p.id === id) || id === 'custom' ? id : 'graphite'}`);
    $('#sCustom').hidden = !customOpen;
  }

  function renderBackupInfo() {
    $('#sBackupInfo').textContent = settings.lastBackupAt ? t('set.backupLast', { date: when(settings.lastBackupAt) }) : t('set.backupNever');
  }

  function renderStatus() {
    const out = $('#sStatus');
    if (!out) return;
    const info = ctx.syncInfo();
    let main;
    if (!syncOn()) main = t('sync.off');
    else if (info.running) main = t('sync.running');
    else main = settings.lastSyncAt ? t('sync.last', { time: when(settings.lastSyncAt) }) : t('sync.never');
    const err = !info.running && info.error ? errText(info.error) : '';
    out.innerHTML = `<span>${esc(main)}</span>${err ? `<span class="serr" role="alert">${esc(err)}</span>` : ''}`;
    $('#sStop').hidden = !syncOn() && !settings.token && !settings.passphrase;
    $('#sSyncNow').disabled = !!info.running;
  }

  function errText(code) {
    const k = `sync.err.${code}`;
    const s = t(k);
    return s === k ? t('sync.err.sync-failed') : s;
  }

  function persistSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; ctx.persist(); }, 250);
  }

  function choosePalette(id) {
    if (id === 'custom') {
      // First tap selects «ألوانك» and opens the picker; later taps toggle the picker.
      customOpen = currentPal() === 'custom' ? !customOpen : true;
      settings.palette = 'custom';
      settings.customPalette = custom();
      ctx.applyPalette(settings.customPalette);
    } else {
      settings.palette = id;
      customOpen = false;
      ctx.applyPalette(id);
    }
    renderPalette();
    ctx.persist();
  }

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function backup() {
    const state = ctx.getState();
    if (!state) { toast(t('err.load')); return; }
    const { filename, json } = exportBackup(state, new Date());
    download(filename, json);
    settings.lastBackupAt = Date.now();
    await ctx.persist();
    ctx.onBackedUp();
    renderBackupInfo();
    toast(t('toast.backedUp'));
  }

  async function restore(file) {
    const state = ctx.getState();
    if (!state) { toast(t('err.load')); return; }
    let next;
    try { next = importBackup(state, await file.text()); } catch { toast(t('err.bad-backup')); return; }
    try { await ctx.replaceState(next); } catch { toast(t('err.save')); return; }
    toast(t('toast.restored'));
  }

  async function syncClick() {
    if (!ctx.getState()) { toast(t('err.load')); return; }
    const token = $('#sToken').value.trim();
    const passphrase = $('#sPass').value;
    if (!token || !passphrase) { toast(t('sync.needBoth')); return; }
    // Nothing is saved until this sync succeeds (the app then stores token, passphrase, mode).
    renderStatus();
    try { await ctx.sync({ token, passphrase }); toast(t('toast.synced')); } catch { /* the status line shows the error */ }
    renderStatus();
  }

  async function stop() {
    delete settings.token;
    delete settings.passphrase;
    settings.mode = 'local';
    ctx.stopSync();
    await ctx.persist();
    $('#sToken').value = '';
    $('#sPass').value = '';
    renderStatus();
    toast(t('toast.syncStopped'));
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !el.contains(b)) return;
    if (b.dataset.lang) { if (b.dataset.lang !== ctx.getLang()) ctx.setLanguage(b.dataset.lang); }
    else if (b.dataset.p) choosePalette(b.dataset.p);
    else if (b.id === 'sBackup') backup();
    else if (b.id === 'sRestore') $('#sImport').click();
    else if (b.id === 'sSyncNow') syncClick();
    else if (b.id === 'sStop') stop();
  });
  el.addEventListener('input', (e) => {
    const k = CUSTOM_KEYS.find(([id]) => id === e.target.id);
    if (!k) return;
    settings.customPalette = { ...custom(), [k[1]]: e.target.value };
    settings.palette = 'custom';
    ctx.applyPalette(settings.customPalette);
    renderPalette();
    persistSoon();
  });
  el.addEventListener('change', (e) => {
    // The colour picker closed: write now rather than waiting for the debounce.
    if (CUSTOM_KEYS.some(([id]) => id === e.target.id) && saveTimer) { clearTimeout(saveTimer); saveTimer = null; ctx.persist(); }
    if (e.target.id === 'sImport') {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) restore(f);
    }
  });
  addEventListener('toolbox:sync', renderStatus);

  skeleton();

  return {
    // Re-localise after a language change; keeps typed but unsaved sync fields.
    update(next = {}) {
      if (next.t) t = next.t;
      const tok = $('#sToken')?.value;
      const pass = $('#sPass')?.value;
      const adv = $('#sAdv')?.open;
      skeleton();
      if (tok != null) $('#sToken').value = tok;
      if (pass != null) $('#sPass').value = pass;
      if (adv != null) $('#sAdv').open = adv;
      const b = $(`[data-lang=${ctx.getLang()}]`);
      if (b) b.focus();
    },
    renderStatus,
  };
}
