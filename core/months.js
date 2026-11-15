// Month math and automatic new-month copy. Month keys are 'YYYY-MM'.
import { now } from './model.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function check(month) {
  if (typeof month !== 'string' || !MONTH_RE.test(month)) throw new Error('invalid-month');
  return month;
}

export function monthOf(date) { return String(date).slice(0, 7); }

export function addMonth(month, k) {
  check(month);
  const idx = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + k;
  const y = Math.floor(idx / 12);
  const m = idx - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

export function todayLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The automatic copy is stamped updatedAt 0: it is derived data, so any real edit of that month
// on another device (setIncome/setBudget, which stamp now()) wins when states are merged.
export function ensureMonth(state, month) {
  check(month);
  const existing = state.months[month];
  if (existing) return existing;
  let src = null;
  for (const k of Object.keys(state.months)) {
    if (k < month && (src === null || k > src)) src = k;
  }
  const from = src ? state.months[src] : null;
  const rec = {
    income: from ? from.income : 0,
    budget: from ? { ...from.budget } : {},
    updatedAt: 0,
  };
  state.months[month] = rec;
  return rec;
}

function checkAmount(v) {
  if (!Number.isSafeInteger(v) || v < 0) throw new Error('invalid-amount');
}

export function setIncome(state, month, halalas) {
  check(month); checkAmount(halalas);
  const m = ensureMonth(state, month);
  m.income = halalas;
  m.updatedAt = now();
  return m;
}

export function setBudget(state, month, catId, halalas) {
  check(month); checkAmount(halalas);
  const m = ensureMonth(state, month);
  m.budget[catId] = halalas;
  m.updatedAt = now();
  return m;
}
