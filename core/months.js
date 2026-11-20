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

// ---------- month periods («متى يبدأ شهرك؟») ----------
// A month can start on a payday instead of the 1st. With start day s > 1, period 'YYYY-MM' runs from
// day s of the previous calendar month to day s-1 of this one (s = 27: «نوفمبر» = 27 Oct – 26 Nov).
// The start day is shared across devices (state.prefs.monthStart); 1 = calendar months.
const pad2 = (n) => String(n).padStart(2, '0');

export function monthStartOf(state) {
  const s = state && state.prefs && state.prefs.monthStart;
  return Number.isInteger(s) && s >= 1 && s <= 28 ? s : 1;
}

export function periodOf(date, start = 1) {
  const cal = String(date).slice(0, 7);
  if (start <= 1) return cal;
  return Number(String(date).slice(8, 10)) >= start ? addMonth(cal, 1) : cal;
}

const lastDay = (month) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();

// First and last date (inclusive, 'YYYY-MM-DD') of a period.
export function periodBounds(month, start = 1) {
  check(month);
  if (start <= 1) return { from: `${month}-01`, to: `${month}-${pad2(lastDay(month))}` };
  return { from: `${addMonth(month, -1)}-${pad2(start)}`, to: `${month}-${pad2(start - 1)}` };
}

const dayNo = (date) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 864e5;
export function daysBetween(a, b) { return dayNo(b) - dayNo(a); }

// The date of day-of-month `day` (1–28) inside a period.
export function dateInPeriod(month, day, start = 1) {
  check(month);
  const cal = start > 1 && day >= start ? addMonth(month, -1) : month;
  return `${cal}-${pad2(day)}`;
}

// Today inside a period: days passed (today included), days left (today included) and the period
// length; null when `today` is not in it.
export function periodProgress(month, today, start = 1) {
  const { from, to } = periodBounds(month, start);
  if (today < from || today > to) return null;
  const length = daysBetween(from, to) + 1;
  const passed = daysBetween(from, today) + 1;
  return { length, passed, left: length - passed + 1 };
}

export function setMonthStart(state, day) {
  if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error('invalid-day');
  state.prefs = { monthStart: day, updatedAt: now() };
}

// The period a transaction belongs to, from its date (so changing the start day re-files old ones).
export function txMonth(state, x) { return periodOf(x.date, monthStartOf(state)); }
