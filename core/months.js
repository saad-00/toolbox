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
// A month can start on a payday instead of the 1st: a period runs from day s of one calendar month to
// day s-1 of the next, and is named after the month that holds most of its days: s ≤ 15 → the start
// month (s = 10: «نوفمبر» = 10 Nov – 9 Dec), s ≥ 16 → the end month (s = 27: «نوفمبر» = 27 Oct – 26 Nov).
// s = 31 means «آخر يوم في الشهر» (each month's last day). Shared across devices (state.prefs.monthStart);
// 1 = calendar months.
const pad2 = (n) => String(n).padStart(2, '0');

export function monthStartOf(state) {
  const s = state && state.prefs && state.prefs.monthStart;
  return startOk(s) ? s : 1;
}

export const startOk = (s) => Number.isInteger(s) && ((s >= 1 && s <= 28) || s === 31);
const lastDay = (month) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
const startIn = (month, start) => Math.min(start, lastDay(month)); // 31 → that month's last day
const early = (start) => start <= 15; // the period's days are mostly in the month it starts in

export function periodOf(date, start = 1) {
  const cal = String(date).slice(0, 7);
  if (start <= 1) return cal;
  const started = Number(String(date).slice(8, 10)) >= startIn(cal, start); // on/after this month's start day
  if (early(start)) return started ? cal : addMonth(cal, -1);
  return started ? addMonth(cal, 1) : cal;
}

// First and last date (inclusive, 'YYYY-MM-DD') of a period.
export function periodBounds(month, start = 1) {
  check(month);
  if (start <= 1) return { from: `${month}-01`, to: `${month}-${pad2(lastDay(month))}` };
  const a = early(start) ? month : addMonth(month, -1);
  const b = addMonth(a, 1);
  return { from: `${a}-${pad2(startIn(a, start))}`, to: `${b}-${pad2(startIn(b, start) - 1)}` };
}

const dayNo = (date) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 864e5;
export function daysBetween(a, b) { return dayNo(b) - dayNo(a); }

// The date of day-of-month `day` (1–28) inside a period.
export function dateInPeriod(month, day, start = 1) {
  check(month);
  if (start <= 1) return `${month}-${pad2(day)}`;
  const a = periodBounds(month, start).from.slice(0, 7);
  return `${day >= startIn(a, start) ? a : addMonth(a, 1)}-${pad2(day)}`;
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
  if (!startOk(day)) throw new Error('invalid-day');
  state.prefs = { monthStart: day, updatedAt: now() };
}

// The period a transaction belongs to, from its date (so changing the start day re-files old ones).
export function txMonth(state, x) { return periodOf(x.date, monthStartOf(state)); }
