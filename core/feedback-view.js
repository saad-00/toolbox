// «راسلنا» sheet: pick a kind, write, optionally leave a name/number, send.
// Offline (or a network error) → the message waits in the outbox and is sent later.
import { makeMessage, send, enqueue, flushOutbox, deviceInfo, KINDS, MAX_MESSAGE, MAX_CONTACT, MAX_NAME } from './feedback.js';
import { loadOutbox, saveOutbox } from './store.js';
import { toast, openSheet, closeSheet } from './ui.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMOJI = { tool: '🧰', bug: '🐞', idea: '💡' };
const io = { load: loadOutbox, save: saveOutbox };

export function createFeedback(ctx) {
  let { t, getLang } = ctx;
  let kind = 'tool';
  let busy = false;
  let flushing = null;
  let sheet = document.getElementById('fbSheet');
  if (!sheet) {
    sheet = document.createElement('form');
    sheet.id = 'fbSheet';
    sheet.className = 'sheet fb';
    sheet.noValidate = true;
    document.body.appendChild(sheet);
    wire();
  }
  const $ = (s) => sheet.querySelector(s);

  function skeleton() {
    sheet.setAttribute('aria-label', t('fb.title'));
    const close = `<button type="button" class="icon-btn" data-close aria-label="${esc(t('sheet.close'))}">✕</button>`;
    sheet.innerHTML = `
<div class="row"><h2 class="sheet-h">${esc(t('fb.title'))}</h2><span class="sp"></span>${close}</div>
<div class="fb-types" role="radiogroup" aria-label="${esc(t('fb.kind'))}">${KINDS.map((k) => `<button type="button" role="radio" data-k="${k}"><span aria-hidden="true">${EMOJI[k]}</span><b>${esc(t(`fb.k.${k}`))}</b></button>`).join('')}</div>
<label class="fld"><span>${esc(t('fb.message'))}</span><span class="fb-count" id="fbCount"></span><textarea id="fbMsg" maxlength="${MAX_MESSAGE}"></textarea></label>
<label class="fld"><span>${esc(t('fb.name'))}</span> <span class="fb-opt">${esc(t('fb.optional'))}</span><input type="text" id="fbName" maxlength="${MAX_NAME}" autocomplete="name" placeholder="${esc(t('fb.namePh'))}"></label>
<label class="fld"><span>${esc(t('fb.contact'))}</span> <span class="fb-opt">${esc(t('fb.optional'))}</span><input type="text" id="fbContact" maxlength="${MAX_CONTACT}" autocomplete="off" placeholder="${esc(t('fb.contactPh'))}"></label>
<input type="text" id="fbHp" name="botcheck" tabindex="-1" autocomplete="off" aria-hidden="true" class="fb-hp">
<div class="fb-meta" id="fbMeta" hidden><svg class="i" aria-hidden="true"><use href="#i-info"/></svg><span>${esc(t('fb.meta'))}</span></div>
<button class="btn" type="submit" id="fbSend">${esc(t('fb.send'))}</button>`;
    paint();
  }

  function paint() {
    sheet.querySelectorAll('[data-k]').forEach((b) => {
      const on = b.dataset.k === kind;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    $('#fbMsg').placeholder = t(`fb.ph.${kind}`);
    $('#fbMeta').hidden = kind !== 'bug';
    count();
  }

  function count() {
    const v = $('#fbMsg').value;
    $('#fbCount').textContent = `${v.length} / ${MAX_MESSAGE}`;
    $('#fbSend').disabled = busy || v.trim().length < 3;
  }

  function wire() {
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) { closeSheet(); return; }
      const b = e.target.closest('[data-k]');
      if (b) { kind = b.dataset.k; paint(); }
    });
    sheet.addEventListener('input', (e) => { if (e.target.id === 'fbMsg') count(); });
    sheet.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      if ($('#fbHp').value) { closeSheet(); toast(t('fb.sent')); return; } // a bot filled the hidden field
      let msg;
      try {
        msg = makeMessage({ kind, message: $('#fbMsg').value, name: $('#fbName').value, contact: $('#fbContact').value, lang: getLang(), device: deviceInfo() });
      } catch { $('#fbMsg').focus(); return; }
      busy = true;
      const btn = $('#fbSend');
      btn.textContent = t('fb.sending');
      count();
      let note = null;
      try {
        if (navigator.onLine === false) throw new Error('offline');
        await send(msg);
        note = t('fb.sent');
      } catch (err) {
        if (err && err.message === 'offline') {
          try { await enqueue(msg, io); note = t('fb.queued'); } catch { note = null; }
        }
      }
      busy = false;
      btn.textContent = t('fb.send');
      if (note) { reset(); closeSheet(); toast(note); } else { count(); toast(t('fb.failed')); }
    });
  }

  function reset() {
    kind = 'tool';
    $('#fbMsg').value = '';
    $('#fbName').value = '';
    $('#fbContact').value = '';
    $('#fbHp').value = '';
    paint();
  }

  skeleton();

  return {
    open() {
      paint();
      openSheet(sheet);
      setTimeout(() => { if (sheet.classList.contains('on')) $('#fbMsg').focus(); }, 250);
    },
    update(next = {}) {
      if (next.t) t = next.t;
      if (next.getLang) getLang = next.getLang;
      const msg = $('#fbMsg').value;
      const name = $('#fbName').value;
      const how = $('#fbContact').value;
      skeleton();
      $('#fbMsg').value = msg;
      $('#fbName').value = name;
      $('#fbContact').value = how;
      count();
    },
    // Sends waiting messages; one run at a time. Silent unless something was delivered.
    flush() {
      if (flushing || navigator.onLine === false) return flushing;
      flushing = flushOutbox(io)
        .then((r) => { if (r.sent) toast(t('fb.flushed', { n: r.sent })); return r; })
        .catch(() => null)
        .finally(() => { flushing = null; });
      return flushing;
    },
  };
}
