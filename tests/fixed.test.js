import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, addCategory, deleteCategory } from '../core/model.js';
import { setMonthStart } from '../core/months.js';
import { addFixed, setFixedActive, deleteFixed, applyFixed, liveFixed } from '../tools/expenses/fixed.js';
import { mergeStates } from '../core/merge.js';
import { validState } from '../core/validate.js';

function setup() {
  const s = createState([]);
  const rent = addCategory(s, 'إيجار');
  return { s, rent };
}

test('a fixed expense is logged on its day, once per month', () => {
  const { s, rent } = setup();
  addFixed(s, { catId: rent, amount: 350000, day: 25, note: 'الشقة' }, '2026-11-19');
  assert.equal(s.fixed[0].since, '2026-11');
  assert.equal(applyFixed(s, '2026-11-19'), 0); // not due yet
  assert.equal(applyFixed(s, '2026-11-25'), 1);
  assert.equal(applyFixed(s, '2026-11-30'), 0); // idempotent
  const x = s.tx[0];
  assert.equal(x.id, `fx-${s.fixed[0].id}-2026-11`);
  assert.deepEqual([x.date, x.month, x.amount, x.note, x.catId], ['2026-11-25', '2026-11', 350000, 'الشقة', rent]);
  assert.ok(s.months['2026-11'], 'the month record is created like a first write');
  // months later: every missed month is caught up
  assert.equal(applyFixed(s, '2027-02-26'), 3);
  assert.deepEqual(s.tx.map((t) => t.month), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('nothing before the item existed is back-filled', () => {
  const { s, rent } = setup();
  addFixed(s, { catId: rent, amount: 100, day: 1 }, '2026-11-19'); // day 1 already passed this month
  assert.equal(s.fixed[0].since, '2026-12');
  assert.equal(applyFixed(s, '2026-11-30'), 0);
  assert.equal(applyFixed(s, '2026-12-01'), 1);
  addFixed(s, { catId: rent, amount: 100, day: 19 }, '2026-11-19'); // today counts
  assert.equal(applyFixed(s, '2026-11-19'), 0 + 1);
});

test('a generated transaction the user deleted is not created again', () => {
  const { s, rent } = setup();
  addFixed(s, { catId: rent, amount: 100, day: 5 }, '2026-11-01');
  applyFixed(s, '2026-11-05');
  s.tx[0].deleted = true;
  assert.equal(applyFixed(s, '2026-11-20'), 0);
});

test('switched off: skipped; switched back on: no back-fill', () => {
  const { s, rent } = setup();
  const id = addFixed(s, { catId: rent, amount: 100, day: 5 }, '2026-11-01');
  setFixedActive(s, id, false, '2026-11-02');
  assert.equal(applyFixed(s, '2027-01-10'), 0);
  setFixedActive(s, id, true, '2027-01-10');
  assert.equal(s.fixed[0].since, '2027-02');
  assert.equal(applyFixed(s, '2027-02-05'), 1);
});

test('deleted items and deleted categories log nothing; bad input is refused', () => {
  const { s, rent } = setup();
  const id = addFixed(s, { catId: rent, amount: 100, day: 5 }, '2026-11-01');
  deleteFixed(s, id);
  assert.equal(liveFixed(s).length, 0);
  assert.equal(applyFixed(s, '2026-12-31'), 0);
  const other = addCategory(s, 'نت');
  addFixed(s, { catId: other, amount: 100, day: 5 }, '2026-11-01');
  deleteCategory(s, other);
  assert.equal(applyFixed(s, '2026-12-31'), 0);
  assert.throws(() => addFixed(s, { catId: rent, amount: 0, day: 5 }, '2026-11-01'), /invalid-amount/);
  assert.throws(() => addFixed(s, { catId: rent, amount: 10, day: 29 }, '2026-11-01'), /invalid-day/);
  assert.throws(() => addFixed(s, { catId: 'x', amount: 10, day: 5 }, '2026-11-01'), /invalid-tx/);
});

test('with a payday start, the occurrence falls inside the period', () => {
  const { s, rent } = setup();
  setMonthStart(s, 27);
  addFixed(s, { catId: rent, amount: 100, day: 28 }, '2026-10-27'); // period 2026-11 = 27 Oct – 26 Nov
  assert.equal(s.fixed[0].since, '2026-11');
  assert.equal(applyFixed(s, '2026-10-28'), 1);
  assert.deepEqual([s.tx[0].date, s.tx[0].month], ['2026-10-28', '2026-11']);
});

test('two devices generating the same month merge into one transaction', () => {
  const { s, rent } = setup();
  addFixed(s, { catId: rent, amount: 100, day: 5 }, '2026-11-01');
  const a = structuredClone(s); const b = structuredClone(s);
  applyFixed(a, '2026-11-06'); applyFixed(b, '2026-11-07');
  const m = mergeStates(a, b);
  assert.equal(m.tx.length, 1);
  assert.equal(m.fixed.length, 1);
  assert.ok(validState(m));
});

test('validState checks fixed items and prefs; states without them stay valid', () => {
  const { s, rent } = setup();
  assert.ok(validState(s));
  addFixed(s, { catId: rent, amount: 100, day: 5 }, '2026-11-01');
  setMonthStart(s, 27);
  assert.ok(validState(s));
  assert.equal(validState({ ...s, fixed: [{ ...s.fixed[0], day: 30 }] }), false);
  assert.equal(validState({ ...s, fixed: [{ ...s.fixed[0], since: 'x' }] }), false);
  assert.equal(validState({ ...s, fixed: 'x' }), false);
  assert.equal(validState({ ...s, prefs: { monthStart: 40 } }), false);
});

test('merge: prefs newest wins; states without the new keys get none', () => {
  const a = createState([]); const b = createState([]);
  assert.equal('prefs' in mergeStates(a, b), false);
  assert.equal('fixed' in mergeStates(a, b), false);
  a.prefs = { monthStart: 27, updatedAt: 10 };
  b.prefs = { monthStart: 1, updatedAt: 20 };
  assert.equal(mergeStates(a, b).prefs.monthStart, 1);
  assert.equal(mergeStates(b, a).prefs.monthStart, 1);
  assert.equal(mergeStates(a, createState([])).prefs.monthStart, 27);
});
