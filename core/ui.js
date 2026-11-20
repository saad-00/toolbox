// Shared shell UI: toast, bottom sheets (centred dialogs on a PC) and inline field errors.
// Markup lives in index.html (#toast, #sheetBg).
let lastFocus = null;
let wired = false;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// toast(msg) shows a status line for 2.4 s. With { action: { label, run } } it also shows a button
// (e.g. «تراجع») and stays 6 s, so there is time to press it; pressing it hides the toast and runs `run`.
export function toast(msg, { action } = {}) {
  const e = document.getElementById('toast');
  if (!e) return;
  wire();
  clearTimeout(e._t);
  e._run = null;
  if (action) {
    e.innerHTML = `<span>${esc(msg)}</span><button type="button" class="t-act">${esc(action.label)}</button>`;
    e._run = action.run;
    e.classList.add('act');
  } else {
    e.textContent = msg;
    e.classList.remove('act');
  }
  e.classList.add('on');
  e._t = setTimeout(() => { e.classList.remove('on'); e.classList.remove('act'); e._run = null; }, action ? 6000 : 2400);
}

const FOCUSABLE = 'button:not([disabled]):not([hidden]),[href],input:not([disabled]):not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])';
const visible = (x) => !!(x.offsetWidth || x.offsetHeight || x.getClientRects().length) && !x.closest('[hidden]');
const focusables = (el) => [...el.querySelectorAll(FOCUSABLE)].filter(visible);

function wire() {
  if (wired) return;
  wired = true;
  document.getElementById('sheetBg')?.addEventListener('click', closeSheet);
  document.getElementById('toast')?.addEventListener('click', (ev) => {
    const e = ev.currentTarget;
    if (!ev.target.closest('.t-act') || !e._run) return;
    const run = e._run;
    e._run = null;
    clearTimeout(e._t);
    e.classList.remove('on'); e.classList.remove('act');
    run();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheet(); return; }
    // Keep Tab inside the open sheet: the page behind it is blurred and must not take focus.
    if (e.key !== 'Tab') return;
    const sheet = document.querySelector('.sheet.on');
    if (!sheet) return;
    const f = focusables(sheet);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    const inside = sheet.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
  });
}

// el: a .sheet element already in the document. Only one sheet is open at a time.
export function openSheet(el) {
  wire();
  closeSheet(false);
  lastFocus = document.activeElement;
  el.setAttribute('role', el.getAttribute('role') || 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.classList.add('on');
  document.getElementById('sheetBg')?.classList.add('on');
  // Focus moves into the dialog at once (a view may move it on to its main field afterwards).
  if (!el.contains(document.activeElement)) {
    const f = focusables(el);
    (f.find((x) => x.matches('input,textarea')) || f[0])?.focus({ preventScroll: true });
  }
}

export function closeSheet(restoreFocus = true) {
  const open = document.querySelectorAll('.sheet.on');
  open.forEach((s) => s.classList.remove('on'));
  document.getElementById('sheetBg')?.classList.remove('on');
  if (restoreFocus && open.length && lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
}

// Inline error under a field: `after` is the element the message goes below (default: the input).
// The message is tied to the input (aria-describedby / aria-invalid) and clears as soon as it changes.
export function fieldError(input, msg, after = input) {
  if (!input) return;
  const id = `${input.id}-err`;
  let p = document.getElementById(id);
  if (!p) {
    p = document.createElement('p');
    p.id = id;
    p.className = 'ferr';
    p.setAttribute('role', 'alert');
    after.insertAdjacentElement('afterend', p);
  }
  p.textContent = msg;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', id);
  input.addEventListener('input', () => clearFieldError(input), { once: true });
  input.focus();
}

export function clearFieldError(input) {
  if (!input) return;
  document.getElementById(`${input.id}-err`)?.remove();
  input.removeAttribute('aria-invalid');
  if (input.getAttribute('aria-describedby') === `${input.id}-err`) input.removeAttribute('aria-describedby');
}
