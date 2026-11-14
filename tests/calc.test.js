import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTx, deleteTx, createState } from '../core/model.js';
import { monthSummary } from '../tools/expenses/calc.js';
import { fixture } from './fixtures/excel-nov-2026.js';

test('november matches the excel sheet', () => {
  const r = monthSummary(fixture(), '2026-11');
  assert.equal(r.income, 656019); assert.equal(r.spent, 482994); assert.equal(r.budgetTotal, 502994);
  assert.equal(r.remainingNow, 173025); assert.equal(r.remainingActual, 153025);
});
test('exact sums, no float drift', () => {
  const r = monthSummary(fixture(), '2026-11');
  assert.equal(r.rows.filter(x => x.spent).reduce((a, x) => a + x.spent, 0), 226275);
});
test('over budget gives negative left', () => {
  const s = fixture(); addTx(s, {catId: s.cats.find(c => c.name === 'قرض').id, amount: 30000, date: '2026-11-20', note: ''});
  assert.equal(monthSummary(s, '2026-11').rows.find(x => x.budget === 20000).left, -10000);
});
test('deleted transactions do not count', () => {
  const s = fixture();
  const before = monthSummary(s, '2026-11');
  const id = addTx(s, {catId: s.cats[0].id, amount: 5000, date: '2026-11-21', note: ''});
  assert.equal(monthSummary(s, '2026-11').spent, before.spent + 5000);
  deleteTx(s, id);
  const after = monthSummary(s, '2026-11');
  assert.equal(after.spent, before.spent);
  assert.deepEqual(after.rows, before.rows);
});
test('rows include every live category; providers grouped', () => {
  const r = monthSummary(fixture(), '2026-11');
  assert.equal(r.rows.length, 6);
  assert.deepEqual(r.rows.find(x => x.budget === 20000), { catId: r.rows[5].catId, spent: 0, budget: 20000, left: 20000 });
  assert.deepEqual(r.providers, [{provider: 'تمارا', due: 103619, paid: 103619}, {provider: 'تابي', due: 153100, paid: 153100}]);
});
test('missing month does not mutate state', () => {
  const s = fixture();
  const snap = JSON.stringify(s);
  const r = monthSummary(s, '2027-05');
  assert.equal(r.income, 0); assert.equal(r.budgetTotal, 0); assert.equal(r.spent, 0);
  assert.equal(JSON.stringify(s), snap);
  assert.equal(monthSummary(createState([]), '2026-11').rows.length, 0);
});
