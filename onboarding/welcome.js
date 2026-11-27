// First-run welcome: (1) language, (2) salary + starter categories, (3) install guide, (4) data mode.
// Nothing is written here: the finished state goes to done(state, choices), which saves it.
// done may reject (e.g. storage failure); the welcome then stays open so the user can retry.
import { detectLang, setLang, getLang, t, dir } from '../core/i18n.js';
import { createState, DEFAULT_CAT_KEYS } from '../core/model.js';
import { parseAmount } from '../core/money.js';
import { setIncome, todayLocal, setMonthStart, periodOf, periodBounds } from '../core/months.js';
import { pullRemote } from '../core/sync.js';
import { toast, fieldError } from '../core/ui.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TOTAL = 4;
// A remote worth adopting: any live category or transaction, or any month record.
const hasContent = (s) => !!s && ((s.cats || []).some((c) => !c.deleted) || (s.tx || []).some((x) => !x.deleted)
  || Object.keys(s.months || {}).length > 0 || (s.plans || []).some((p) => !p.deleted));
const syncErr = (e) => {
  const k = `sync.err.${e && e.message}`;
  const s = t(k);
  return s === k ? t('sync.err.sync-failed') : s;
};

// opts: { lang?, deviceId?, install?: { available(): boolean, prompt(): Promise } }
export function mountWelcome(el, done, opts = {}) {
  const data = {
    salary: '',
    checked: new Set(DEFAULT_CAT_KEYS),
    pay: '27', // «متى ينزل راتبك؟»: '27' | '1' | '31' (last day) | 'other'
    payDay: 25, // the day picked under «يوم آخر…»
    mode: 'local',
    token: '',
    passphrase: '',
    connected: null, // { remote: State|null, token, passphrase } after a successful (read-only) connection test
    testMsg: '',
  };
  let step = 1;
  let busy = false;

  function setLanguage(l) {
    setLang(l);
    const lang = getLang();
    document.documentElement.lang = lang;
    document.documentElement.dir = dir(lang);
    document.title = t('app.name');
  }

  const stepBody = {
    1: () => `<h2>${esc(t('wel.lang.title'))}</h2>
<div class="seg" role="group" aria-label="${esc(t('set.lang'))}">${['ar', 'en'].map((l) => `<button type="button" data-lang="${l}" lang="${l}" aria-pressed="${getLang() === l}">${esc(t(`lang.${l}`))}</button>`).join('')}</div>
<p class="note">${esc(t('wel.lang.note'))}</p>`,
    2: () => `<h2>${esc(t('wel.money.title'))}</h2>
<label class="wfield">${esc(t('wel.salary'))}<input type="text" inputmode="decimal" id="wSalary" autocomplete="off" dir="ltr" placeholder="0" value="${esc(data.salary)}"></label>
<p class="note">${esc(t('wel.salaryHint'))}</p>
${payHtml()}
<h3>${esc(t('wel.cats'))}</h3>
<div class="wcats">${DEFAULT_CAT_KEYS.map((k) => `<label><input type="checkbox" name="cat" value="${esc(k)}"${data.checked.has(k) ? ' checked' : ''}><span>${esc(t(k))}</span></label>`).join('')}</div>
<p class="note">${esc(t('wel.catsNote'))}</p>`,
    3: () => `<h2>${esc(t('wel.install.title'))}</h2>
<p class="note">${esc(t('wel.install.lead'))}</p>
<div class="step"><span class="n">1</span><div><b>${esc(t('wel.install.iphone'))}</b><small>${esc(t('wel.install.iphoneSteps'))}</small></div></div>
<div class="step"><span class="n">2</span><div><b>${esc(t('wel.install.android'))}</b><small>${esc(t('wel.install.androidSteps'))}</small></div></div>
${opts.install && opts.install.available() ? `<button class="btn sec winstall" type="button" id="wInstall">${esc(t('wel.install.button'))}</button>` : ''}`,
    4: () => `<h2>${esc(t('wel.mode.title'))}</h2>
<label class="wmode"><input type="radio" name="mode" value="local"${data.mode === 'local' ? ' checked' : ''}><span><b>${esc(t('wel.mode.local'))}</b><small>${esc(t('wel.mode.localNote'))}</small></span></label>
<details id="wAdv"${data.mode === 'sync' ? ' open' : ''}><summary>${esc(t('adv.title'))}</summary>
<label class="wmode"><input type="radio" name="mode" value="sync"${data.mode === 'sync' ? ' checked' : ''}><span><b>${esc(t('wel.mode.sync'))}</b><small>${esc(t('wel.mode.syncNote'))}</small></span></label>
<label class="wfield">${esc(t('sync.token'))}<input type="password" id="wToken" autocomplete="off" dir="ltr" placeholder="github_pat_…" value="${esc(data.token)}"></label>
<label class="wfield">${esc(t('sync.pass'))}<input type="password" id="wPass" autocomplete="new-password" value="${esc(data.passphrase)}"></label>
<button class="btn sec" type="button" id="wTest">${esc(t('wel.test'))}</button>
<p class="note" id="wTestOut" aria-live="polite">${esc(data.testMsg)}</p>
</details>`,
  };

  // The month start the payday answer gives (1 = calendar months).
  const payStart = () => (data.pay === 'other' ? data.payDay : Number(data.pay));

  function payHtml() {
    const lang = getLang();
    const loc = lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-US';
    const dm = (d) => new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long' }).format(new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))));
    const s = payStart();
    const month = periodOf(todayLocal(), s);
    const b = periodBounds(month, s);
    const name = new Intl.DateTimeFormat(loc, { month: 'long' }).format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
    const range = s === 1 ? t('wel.rangeCal', { month: name, to: dm(b.to) }) : t('wel.range', { month: name, from: dm(b.from), to: dm(b.to) });
    const opt = (v, key) => `<label class="wpay-opt"><span><input type="radio" name="payday" value="${v}"${data.pay === v ? ' checked' : ''}>${esc(t(key))}</span><small>${esc(t(`${key}Sub`))}</small></label>`;
    const days = data.pay !== 'other' ? '' : `<div class="wdays" id="wDays" role="group" aria-label="${esc(t('wel.payDays'))}">${Array.from({ length: 28 }, (_, i) => `<button type="button" data-day="${i + 1}" aria-pressed="${data.payDay === i + 1}">${i + 1}</button>`).join('')}</div><p class="note">${esc(t('wel.payDaysNote'))}</p>`;
    return `<fieldset class="wpay"><legend>${esc(t('wel.pay'))}</legend><p class="note">${esc(t('wel.payNote'))}</p>`
      + `<div class="wpay-opts">${opt('27', 'wel.pay27')}${opt('1', 'wel.pay1')}${opt('31', 'wel.payLast')}${opt('other', 'wel.payOther')}</div>${days}`
      + `<p class="wrange" id="wRange" role="status">${esc(range)}</p><p class="note">${esc(t('wel.rangeLater'))}</p></fieldset>`;
  }

  function render() {
    const dots = Array.from({ length: TOTAL }, (_, i) => `<i class="${i + 1 === step ? 'on' : ''}"></i>`).join('');
    const last = step === TOTAL;
    el.innerHTML = `<section class="card wcard" aria-labelledby="wTitle">
<div class="wtop"><span class="wlogo"><svg class="i" aria-hidden="true"><use href="#i-home"/></svg></span><h1 id="wTitle">${esc(t('app.name'))}</h1></div>
<p class="lead">${esc(t('wel.hello'))}</p>
<div class="wdots" role="img" aria-label="${esc(t('wel.step', { n: step, total: TOTAL }))}">${dots}</div>
<div class="wbody" data-step="${step}">${stepBody[step]()}</div>
<div class="row wnav">${step > 1 ? `<button class="btn sec" type="button" id="wBack">${esc(t('wel.back'))}</button>` : ''}<span class="sp"></span>`
      + `<button class="btn" type="button" id="${last ? 'wFinish' : 'wNext'}">${esc(t(last ? 'wel.start' : 'wel.next'))}</button></div>
</section>`;
  }

  // Keep typed values across re-renders (language switch, back/next).
  function collect() {
    const q = (s) => el.querySelector(s);
    if (q('#wSalary')) data.salary = q('#wSalary').value;
    if (step === 2) data.checked = new Set([...el.querySelectorAll('input[name=cat]:checked')].map((x) => x.value));
    const p = q('input[name=payday]:checked');
    if (p) data.pay = p.value;
    if (q('#wToken')) data.token = q('#wToken').value;
    if (q('#wPass')) data.passphrase = q('#wPass').value;
    const m = q('input[name=mode]:checked');
    if (m) data.mode = m.value;
  }

  function salaryHalalas() {
    const s = data.salary.trim();
    return s ? parseAmount(s) : null;
  }

  async function testConnection() {
    collect();
    const token = data.token.trim();
    const passphrase = data.passphrase;
    const out = el.querySelector('#wTestOut');
    if (!token || !passphrase) { toast(t('sync.needBoth')); return; }
    busy = true;
    el.querySelector('#wTest').disabled = true;
    out.textContent = t('sync.running');
    try {
      // Read-only: GET + decrypt, never PUT. The first auto-sync after Finish uploads.
      const remote = await pullRemote({ token, passphrase });
      data.connected = { remote: hasContent(remote) ? remote : null, token, passphrase };
      data.mode = 'sync';
      data.testMsg = t(data.connected.remote ? 'wel.connectedData' : 'wel.connected');
    } catch (e) {
      data.connected = null;
      data.testMsg = syncErr(e);
    }
    busy = false;
    if (step === 4) { render(); el.querySelector('#wTestOut')?.focus?.(); }
  }

  async function finish() {
    collect();
    let choices = { lang: getLang(), mode: 'local' };
    let state;
    if (data.mode === 'sync') {
      const c = data.connected;
      if (!c || c.token !== data.token.trim() || c.passphrase !== data.passphrase) { toast(t('wel.needTest')); return; }
      choices = { ...choices, mode: 'sync', token: c.token, passphrase: c.passphrase };
      // An existing synced account is adopted as is; an empty or missing remote gets the
      // starter categories and salary below, exactly like local mode.
      if (c.remote) state = c.remote;
    }
    if (!state) {
      state = createState(DEFAULT_CAT_KEYS.filter((k) => data.checked.has(k)));
      let h = null;
      try { h = salaryHalalas(); } catch { step = 2; render(); const i = el.querySelector('#wSalary'); fieldError(i, t('err.invalid-amount'), i.closest('label')); return; }
      if (payStart() !== 1) setMonthStart(state, payStart());
      if (h != null) setIncome(state, periodOf(todayLocal(), payStart()), h); // the period that holds today
    }
    busy = true;
    el.querySelector('#wFinish').disabled = true;
    try {
      await done(state, choices);
    } catch {
      busy = false;
      const b = el.querySelector('#wFinish');
      if (b) b.disabled = false;
      toast(t('err.save'));
    }
  }

  el.addEventListener('click', (e) => {
    if (busy) return;
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.day) { collect(); data.payDay = Number(b.dataset.day); render(); el.querySelector(`[data-day="${data.payDay}"]`)?.focus(); return; }
    if (b.dataset.lang) { collect(); setLanguage(b.dataset.lang); render(); el.querySelector(`[data-lang=${getLang()}]`)?.focus(); return; }
    if (b.id === 'wNext') {
      collect();
      if (step === 2) {
        try { salaryHalalas(); } catch { const i = el.querySelector('#wSalary'); fieldError(i, t('err.invalid-amount'), i.closest('label')); return; }
      }
      step++; render();
      const h = el.querySelector('.wbody h2');
      if (h) { h.tabIndex = -1; h.focus(); }
    } else if (b.id === 'wBack') { collect(); step--; render(); }
    else if (b.id === 'wTest') testConnection();
    else if (b.id === 'wFinish') finish();
    else if (b.id === 'wInstall' && opts.install) opts.install.prompt().finally(() => { if (step === 3) render(); });
  });
  // Choosing «محلي» or «مزامنة» updates the mode without re-rendering (keeps typed fields).
  el.addEventListener('change', (e) => {
    if (e.target.name === 'mode') data.mode = e.target.value;
    if (e.target.name === 'payday') { collect(); render(); el.querySelector(`input[name=payday][value="${data.pay}"]`)?.focus(); }
  });
  addEventListener('toolbox:installable', () => { if (step === 3 && el.isConnected && !el.hidden) render(); });

  setLanguage(opts.lang || detectLang(navigator.languages));
  render();
  return { get step() { return step; } };
}
