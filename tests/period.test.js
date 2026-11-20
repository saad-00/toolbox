import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, addCategory, addTx, deleteTx, restoreRecord } from '../core/model.js';
import { periodOf, periodBounds, periodProgress, dateInPeriod, setMonthStart, monthStartOf, txMonth, setIncome } from '../core/months.js';
import { monthSummary } from '../tools/expenses/calc.js';
import { addPlan, schedule, dueIn, nextPayment, upcomingPayments } from '../tools/expenses/installments.js';

test('calendar months by default', () => {
  assert.equal(periodOf('2026-11-30'), '2026-11');
  assert.deepEqual(periodBounds('2026-11'), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(periodBounds('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.equal(monthStartOf(createState([])), 1);
});

test('a payday start: «نوفمبر» runs 27 Oct – 26 Nov', () => {
  assert.equal(periodOf('2026-10-26', 27), '2026-10');
  assert.equal(periodOf('2026-10-27', 27), '2026-11');
  assert.equal(periodOf('2026-11-26', 27), '2026-11');
  assert.equal(periodOf('2026-12-27', 27), '2027-01');
  assert.deepEqual(periodBounds('2026-11', 27), { from: '2026-10-27', to: '2026-11-26' });
  assert.deepEqual(periodBounds('2027-01', 27), { from: '2026-12-27', to: '2027-01-26' });
  assert.equal(dateInPeriod('2026-11', 27, 27), '2026-10-27');
  assert.equal(dateInPeriod('2026-11', 5, 27), '2026-11-05');
});

test('progress through a period: days passed and left include today', () => {
  assert.deepEqual(periodProgress('2026-11', '2026-11-19'), { length: 30, passed: 19, left: 12 });
  assert.deepEqual(periodProgress('2026-11', '2026-11-30'), { length: 30, passed: 30, left: 1 });
  assert.deepEqual(periodProgress('2026-11', '2026-10-27', 27), { length: 31, passed: 1, left: 31 });
  assert.equal(periodProgress('2026-11', '2026-12-01'), null);
  assert.equal(periodProgress('2026-11', '2026-11-27', 27), null);
});

test('month start day is validated and shared through state.prefs', () => {
  const s = createState([]);
  setMonthStart(s, 27);
  assert.equal(monthStartOf(s), 27);
  assert.equal(typeof s.prefs.updatedAt, 'number');
  for (const bad of [0, 29, 1.5, '27', null]) assert.throws(() => setMonthStart(s, bad), /invalid-day/);
  assert.equal(monthStartOf({ prefs: { monthStart: 99 } }), 1); // a bad stored value reads as calendar months
});

test('transactions are filed by date, so changing the start day re-files them', () => {
  const s = createState([]);
  const c = addCategory(s, 'أكل');
  addTx(s, { catId: c, amount: 1000, date: '2026-10-28' });
  addTx(s, { catId: c, amount: 500, date: '2026-11-03' });
  setIncome(s, '2026-11', 100000);
  assert.equal(monthSummary(s, '2026-11').spent, 500);
  assert.equal(monthSummary(s, '2026-10').spent, 1000);
  setMonthStart(s, 27);
  assert.equal(txMonth(s, s.tx[0]), '2026-11');
  assert.equal(monthSummary(s, '2026-11').spent, 1500);
  assert.equal(monthSummary(s, '2026-10').spent, 0);
  // a new transaction stores the period month too (older app versions read x.month)
  addTx(s, { catId: c, amount: 100, date: '2026-11-30' });
  assert.equal(s.tx[2].month, '2026-12');
});

test('installments follow the payday period, and the next payment is found', () => {
  const s = createState([]);
  addPlan(s, { provider: 'tamara', item: 'جوال', total: 4000, n: 4, start: '2026-10-28', firstPaid: true });
  assert.deepEqual(schedule(s.plans[0]).map((r) => r.month), ['2026-10', '2026-11', '2026-12', '2027-01']);
  assert.deepEqual(schedule(s.plans[0], 27).map((r) => r.month), ['2026-11', '2026-12', '2027-01', '2027-02']);
  setMonthStart(s, 27);
  assert.equal(dueIn(s, '2026-11').length, 1);
  assert.equal(dueIn(s, '2026-11')[0].k, 0);
  const next = nextPayment(s, '2026-11-19');
  assert.equal(next.k, 1);
  assert.equal(next.date, '2026-11-28');
  assert.equal(next.inDays, 9);
  assert.equal(nextPayment(s, '2026-12-01').inDays, -3); // overdue
  assert.deepEqual(upcomingPayments(s, '2026-11-19', 2).map((p) => p.date), ['2026-11-28', '2026-12-28']);
});

test('short months clamp the payment day', () => {
  const s = createState([]);
  addPlan(s, { provider: 'tabby', item: 'x', total: 300, n: 3, start: '2026-01-31', firstPaid: false });
  assert.deepEqual(schedule(s.plans[0]).map((r) => r.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
});

test('restoreRecord brings a soft-deleted record back with a newer stamp', () => {
  const s = createState([]);
  const c = addCategory(s, 'أكل');
  const id = addTx(s, { catId: c, amount: 100, date: '2026-11-03' });
  deleteTx(s, id);
  const before = s.tx[0].updatedAt;
  restoreRecord(s.tx, id);
  assert.equal(s.tx[0].deleted, false);
  assert.ok(s.tx[0].updatedAt >= before);
  assert.throws(() => restoreRecord(s.tx, 'nope'), /not-found/);
});
