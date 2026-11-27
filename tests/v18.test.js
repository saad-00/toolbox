import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, addCategory, addTx, DEFAULT_CAT_KEYS, setCategoryColor, suggestSplit, CAT_COLORS } from '../core/model.js';
import { periodOf, periodBounds, dateInPeriod, setMonthStart, monthStartOf, setIncome } from '../core/months.js';
import { addPlan } from '../tools/expenses/installments.js';
import { categoryAverages } from '../tools/expenses/reports.js';
import { validState } from '../core/validate.js';

test('a period is named after the month that holds most of its days', () => {
  // start 27: «نوفمبر» = 27 Oct – 26 Nov (as before)
  assert.deepEqual(periodBounds('2026-11', 27), { from: '2026-10-27', to: '2026-11-26' });
  // start 10: «نوفمبر» = 10 Nov – 9 Dec (was 10 Oct – 9 Nov)
  assert.deepEqual(periodBounds('2026-11', 10), { from: '2026-11-10', to: '2026-12-09' });
  assert.equal(periodOf('2026-11-15', 10), '2026-11');
  assert.equal(periodOf('2026-12-09', 10), '2026-11');
  assert.equal(periodOf('2026-11-09', 10), '2026-10');
  assert.equal(dateInPeriod('2026-11', 12, 10), '2026-11-12');
  assert.equal(dateInPeriod('2026-11', 5, 10), '2026-12-05');
  // the switch happens between 15 and 16
  assert.deepEqual(periodBounds('2026-11', 15), { from: '2026-11-15', to: '2026-12-14' });
  assert.deepEqual(periodBounds('2026-11', 16), { from: '2026-10-16', to: '2026-11-15' });
});

test('«آخر يوم في الشهر» (31): the period starts on each month’s last day', () => {
  const s = createState([]);
  setMonthStart(s, 31);
  assert.equal(monthStartOf(s), 31);
  assert.deepEqual(periodBounds('2026-11', 31), { from: '2026-10-31', to: '2026-11-29' });
  assert.deepEqual(periodBounds('2026-03', 31), { from: '2026-02-28', to: '2026-03-30' });
  assert.equal(periodOf('2026-11-30', 31), '2026-12');
  assert.equal(periodOf('2026-11-29', 31), '2026-11');
  assert.equal(periodOf('2026-02-28', 31), '2026-03');
  assert.equal(dateInPeriod('2026-11', 28, 31), '2026-11-28');
  for (const bad of [29, 30, 32, 0]) assert.throws(() => setMonthStart(s, bad), /invalid-day/);
  assert.ok(validState(s));
  assert.equal(validState({ ...s, prefs: { monthStart: 30, updatedAt: 1 } }), false);
});

test('addPlan can start with a number of payments already paid', () => {
  const s = createState([]);
  addPlan(s, { provider: 'tabby', item: 'جوال', total: 480000, n: 24, start: '2026-03-10', paidCount: 9 });
  assert.deepEqual(s.plans[0].paid.slice(0, 10), [true, true, true, true, true, true, true, true, true, false]);
  assert.equal(s.plans[0].paid.filter(Boolean).length, 9);
  for (const bad of [-1, 25, 1.5]) assert.throws(() => addPlan(s, { provider: 'x', item: 'y', total: 100, n: 24, start: '2026-03-10', paidCount: bad }), /invalid-plan/);
  addPlan(s, { provider: 'x', item: 'y', total: 100, n: 4, start: '2026-03-10', firstPaid: true }); // firstPaid still works
  assert.deepEqual(s.plans[1].paid, [true, false, false, false]);
});

test('categoryAverages: per-category spending averaged over the months with data among the 3 before', () => {
  const s = createState([]);
  const food = addCategory(s, 'أكل');
  const fuel = addCategory(s, 'بنزين');
  for (const [d, a] of [['2026-08-05', 100000], ['2026-09-05', 200000], ['2026-10-05', 300000], ['2026-11-05', 999900]]) addTx(s, { catId: food, amount: a, date: d });
  addTx(s, { catId: fuel, amount: 60000, date: '2026-10-07' });
  const avg = categoryAverages(s, '2026-11');
  assert.equal(avg.months, 3);
  assert.equal(avg.by[food], 200000);
  assert.equal(avg.by[fuel], 20000);
  // only October has data → one month counts
  const t = createState([]); const c = addCategory(t, 'x');
  addTx(t, { catId: c, amount: 50000, date: '2026-10-01' });
  assert.deepEqual(categoryAverages(t, '2026-11'), { months: 1, by: { [c]: 50000 } });
  assert.deepEqual(categoryAverages(createState([]), '2026-11'), { months: 0, by: {} });
});

test('suggestSplit: a starting split of the income over the default categories, in whole riyals', () => {
  const s = createState(DEFAULT_CAT_KEYS);
  const own = addCategory(s, 'هدايا');
  const split = suggestSplit(s, 800000);
  const total = Object.values(split).reduce((a, b) => a + b, 0);
  assert.ok(total <= 800000);
  assert.ok(total >= 700000, 'most of the income is placed');
  for (const v of Object.values(split)) assert.equal(v % 100, 0);
  assert.equal(split[own], undefined); // a custom category gets no guess
  assert.ok(split['cat.housing'] > split['cat.food']);
  assert.deepEqual(suggestSplit(s, 0), {});
});

test('category colours come from a fixed set, are stamped, and are validated', () => {
  const s = createState(DEFAULT_CAT_KEYS);
  setCategoryColor(s, 'cat.food', 'orange');
  assert.equal(s.cats.find((c) => c.id === 'cat.food').color, 'orange');
  assert.ok(s.cats.find((c) => c.id === 'cat.food').updatedAt > 0);
  setCategoryColor(s, 'cat.food', null);
  assert.equal(s.cats.find((c) => c.id === 'cat.food').color, null);
  assert.throws(() => setCategoryColor(s, 'cat.food', '#ff0000'), /invalid-color/);
  assert.equal(CAT_COLORS.length, 8);
  setCategoryColor(s, 'cat.bills', 'yellow');
  assert.ok(validState(s));
  assert.equal(validState({ ...s, cats: [{ ...s.cats[0], color: 'purple-ish' }] }), false);
});
