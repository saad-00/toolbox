import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, addCategory, setClock } from '../core/model.js';
import { monthOf, addMonth, todayLocal, ensureMonth, setIncome, setBudget } from '../core/months.js';

test('month math across years', () => {
  assert.equal(addMonth('2026-12', 1), '2027-01');
  assert.equal(addMonth('2026-01', -1), '2025-12');
  assert.equal(addMonth('2026-05', 24), '2028-05');
  assert.equal(addMonth('2026-05', -17), '2024-12');
});
test('month comes from the date text, not UTC', () => {
  assert.equal(monthOf('2026-11-30'), '2026-11');
  assert.equal(todayLocal(new Date(2026, 10, 30, 23, 59)), '2026-11-30');
  assert.equal(todayLocal(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
});
test('invalid month strings are rejected', () => {
  for (const m of ['2026-13', '2026-00', '26-11', '2026-1', 'x', '', null]) {
    assert.throws(() => addMonth(m, 1), /invalid-month/);
    assert.throws(() => ensureMonth(createState([]), m), /invalid-month/);
  }
});
test('new month copies the latest earlier month', () => {
  const s = createState([]); const c = addCategory(s, 'a');
  setIncome(s, '2026-10', 656019); setBudget(s, '2026-10', c, 100000);
  const m = ensureMonth(s, '2026-12');
  assert.equal(m.income, 656019); assert.equal(m.budget[c], 100000);
  assert.equal(s.months['2026-12'], m);
});
test('copy uses the latest EARLIER month, never a later one', () => {
  const s = createState([]);
  setIncome(s, '2026-03', 300); setIncome(s, '2026-08', 800); setIncome(s, '2026-12', 1200);
  assert.equal(ensureMonth(s, '2026-10').income, 800);
  assert.equal(ensureMonth(s, '2026-01').income, 0);
});
test('existing month is returned unchanged', () => {
  const s = createState([]);
  setIncome(s, '2026-10', 5);
  const before = JSON.stringify(s.months['2026-10']);
  const m = ensureMonth(s, '2026-10');
  assert.equal(JSON.stringify(m), before);
});
test('editing the new month leaves earlier months alone', () => {
  const s = createState([]); const c = addCategory(s, 'a');
  setBudget(s, '2026-10', c, 100000); ensureMonth(s, '2026-11'); setBudget(s, '2026-11', c, 5);
  assert.equal(s.months['2026-10'].budget[c], 100000);
  assert.equal(s.months['2026-11'].budget[c], 5);
});
test('first month ever starts at zero', () => {
  const s = createState([]);
  const m = ensureMonth(s, '2026-11');
  assert.equal(m.income, 0); assert.deepEqual(m.budget, {});
});
test('writes bump updatedAt', () => {
  const s = createState([]); const c = addCategory(s, 'a');
  try {
    setClock(() => 1000); setIncome(s, '2026-11', 10);
    assert.equal(s.months['2026-11'].updatedAt, 1000);
    setClock(() => 2000); setBudget(s, '2026-11', c, 7);
    assert.equal(s.months['2026-11'].updatedAt, 2000);
    setClock(() => 3000); setIncome(s, '2026-11', 0);
    assert.equal(s.months['2026-11'].updatedAt, 3000);
  } finally { setClock(); }
});
test('amounts must be non-negative safe integers; zero allowed', () => {
  const s = createState([]); const c = addCategory(s, 'a');
  for (const v of [-1, 1.5, NaN, Infinity, '5', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => setIncome(s, '2026-11', v), /invalid-amount/);
    assert.throws(() => setBudget(s, '2026-11', c, v), /invalid-amount/);
  }
  setIncome(s, '2026-11', 0); setBudget(s, '2026-11', c, 0);
  assert.equal(s.months['2026-11'].budget[c], 0);
});
test('auto-copied month has updatedAt 0; only real edits stamp the clock', () => {
  const s = createState([]);
  try {
    setClock(() => 1000); setIncome(s, '2026-11', 500);
    setClock(() => 2000);
    const m = ensureMonth(s, '2026-12');
    assert.equal(m.updatedAt, 0);
    setIncome(s, '2026-12', 700);
    assert.equal(m.updatedAt, 2000);
  } finally { setClock(); }
});
test('an auto-copy on one device never overwrites a real edit from another', async () => {
  const { mergeStates } = await import('../core/merge.js');
  const { addTx } = await import('../core/model.js');
  const laptop = createState(['cat.food']);
  try {
    setClock(() => 1000); setIncome(laptop, '2026-11', 500000);
    const phone = JSON.parse(JSON.stringify(laptop));
    setClock(() => 2000); setIncome(laptop, '2026-12', 900000); // laptop: real December income
    setClock(() => 3000); ensureMonth(phone, '2026-12'); // phone: auto-copy, then spends
    addTx(phone, { catId: 'cat.food', amount: 1500, date: '2026-12-02', note: '' });
    for (const m of [mergeStates(laptop, phone), mergeStates(phone, laptop)]) {
      assert.equal(m.months['2026-12'].income, 900000);
      assert.equal(m.tx.length, 1);
    }
  } finally { setClock(); }
});
