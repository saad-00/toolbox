// Shared shell UI: toast and bottom sheets. Markup lives in index.html (#toast, #sheetBg).
let lastFocus = null;
let wired = false;

export function toast(msg) {
  const e = document.getElementById('toast');
  if (!e) return;
  e.textContent = msg;
  e.classList.add('on');
  clearTimeout(e._t);
  e._t = setTimeout(() => e.classList.remove('on'), 2400);
}

function wire() {
  if (wired) return;
  wired = true;
  document.getElementById('sheetBg')?.addEventListener('click', closeSheet);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
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
}

export function closeSheet(restoreFocus = true) {
  const open = document.querySelectorAll('.sheet.on');
  open.forEach((s) => s.classList.remove('on'));
  document.getElementById('sheetBg')?.classList.remove('on');
  if (restoreFocus && open.length && lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
}
