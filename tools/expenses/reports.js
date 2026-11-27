// Reports: month-by-month history and the Excel (CSV) export. Pure.
import { addMonth, periodOf, monthStartOf, txMonth } from '../../core/months.js';
import { getCategory, catLabel } from '../../core/model.js';
import { monthSummary, projectedState } from './calc.js';

// The last n months up to and including `end`: income and spending of each, and whether the month
// is still running (`partial`) or still to come.
export function history(state, end, today, n = 6) {
  const now = periodOf(today, monthStartOf(state));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const month = addMonth(end, -i);
    const sum = monthSummary(projectedState(state, month), month);
    out.push({ month, income: sum.income, spent: sum.spent, partial: month === now, future: month > now });
  }
  return out;
}

// «اقتراح من صرفك الفعلي»: each category's spending averaged over the months (of the n before `month`)
// that have any spending. { months: how many counted, by: { catId: halalas } }.
export function categoryAverages(state, month, n = 3) {
  const window = new Set(Array.from({ length: n }, (_, i) => addMonth(month, -(i + 1))));
  const sums = {}; const withData = new Set();
  for (const x of state.tx) {
    if (x.deleted) continue;
    const m = txMonth(state, x);
    if (!window.has(m)) continue;
    withData.add(m);
    sums[x.catId] = (sums[x.catId] || 0) + x.amount;
  }
  const by = {};
  for (const [id, v] of Object.entries(sums)) by[id] = Math.round(v / withData.size);
  return { months: withData.size, by };
}

// Averages over finished months that have any income or spending.
export function historyStats(rows) {
  const done = rows.filter((r) => !r.partial && !r.future && (r.spent || r.income));
  const avg = done.length ? Math.round(done.reduce((a, r) => a + r.spent, 0) / done.length) : 0;
  const over = done.filter((r) => r.income && r.spent > r.income).length;
  return { months: done.length, avg, over };
}

// A cell Excel shows as text: quoted, and never read as a formula (CSV injection).
function cell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const plain = (h) => (h % 100 ? (h / 100).toFixed(2) : String(h / 100));

// Every live transaction, oldest first. The BOM makes Excel read the Arabic as UTF-8.
export function exportCsv(state, t) {
  const head = [t('csv.date'), t('csv.month'), t('csv.cat'), t('csv.amount'), t('csv.note')];
  const rows = state.tx.filter((x) => !x.deleted)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((x) => {
      const c = getCategory(state, x.catId);
      return [x.date, txMonth(state, x), c ? catLabel(c, t) : '', plain(x.amount), x.note || ''];
    });
  return `﻿${[head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
