import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, addCategory, addTx } from '../core/model.js';
import { setIncome } from '../core/months.js';
import { history, historyStats, exportCsv } from '../tools/expenses/reports.js';

const t = (k) => ({ 'csv.date': 'التاريخ', 'csv.month': 'الشهر', 'csv.cat': 'البند', 'csv.amount': 'المبلغ', 'csv.note': 'ملاحظة' }[k] || k);

function setup() {
  const s = createState([]);
  const c = addCategory(s, 'أكل');
  setIncome(s, '2026-08', 1000000);
  addTx(s, { catId: c, amount: 1265000, date: '2026-08-10' });
  addTx(s, { catId: c, amount: 980000, date: '2026-09-10' });
  addTx(s, { catId: c, amount: 300000, date: '2026-11-03', note: 'بقالة' });
  return { s, c };
}

test('history: six months ending at the chosen one, income carried forward like the app does', () => {
  const { s } = setup();
  const h = history(s, '2026-11', '2026-11-19');
  assert.deepEqual(h.map((r) => r.month), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(h.map((r) => r.income), [0, 0, 1000000, 1000000, 1000000, 1000000]);
  assert.deepEqual(h.map((r) => r.spent), [0, 0, 1265000, 980000, 0, 300000]);
  assert.deepEqual(h.map((r) => r.partial), [false, false, false, false, false, true]);
  assert.deepEqual(history(s, '2026-12', '2026-11-19').map((r) => r.future), [false, false, false, false, false, true]);
});

test('stats: average of finished months with data, and how often income was exceeded', () => {
  const { s } = setup();
  const st = historyStats(history(s, '2026-11', '2026-11-19'));
  assert.equal(st.months, 3); // Aug, Sep, Oct (income only); Nov is still running
  assert.equal(st.avg, Math.round((1265000 + 980000 + 0) / 3));
  assert.equal(st.over, 1);
  assert.deepEqual(historyStats([]), { months: 0, avg: 0, over: 0 });
});

test('CSV export: BOM, header, rows oldest first, quoted, no formulas', () => {
  const { s, c } = setup();
  addTx(s, { catId: c, amount: 1250, date: '2026-11-04', note: '=HYPERLINK("x")' });
  s.tx[0].deleted = true;
  const csv = exportCsv(s, t);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines[0], '"التاريخ","الشهر","البند","المبلغ","ملاحظة"');
  assert.equal(lines.length, 4); // header + 3 live
  assert.equal(lines[1], '"2026-09-10","2026-09","أكل","9800",""');
  assert.equal(lines[2], '"2026-11-03","2026-11","أكل","3000","بقالة"');
  assert.equal(lines[3], '"2026-11-04","2026-11","أكل","12.50","\'=HYPERLINK(""x"")"');
});
