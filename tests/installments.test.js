import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, setClock } from '../core/model.js';
import { addPlan, paymentAmount, schedule, dueIn, setPaid, remaining, deletePlan } from '../tools/expenses/installments.js';

test('rounding goes to the last payment', () => {
  const p = { total: 100000, n: 3 };
  assert.deepEqual([0, 1, 2].map(k => paymentAmount(p, k)), [33333, 33333, 33334]);
});

test('48 months allowed, 49 refused', () => {
  const s = createState([]);
  addPlan(s, { provider: 'تابي', item: 'سيارة', total: 4800000, n: 48, start: '2026-11-13', firstPaid: true });
  assert.equal(schedule(s.plans[0]).at(-1).month, '2030-10');
  assert.throws(() => addPlan(s, { provider: 'x', item: 'y', total: 100, n: 49, start: '2026-11-01', firstPaid: false }), /invalid-months/);
  assert.throws(() => addPlan(s, { provider: 'x', item: 'y', total: 100, n: 0, start: '2026-11-01', firstPaid: false }), /invalid-months/);
  assert.throws(() => addPlan(s, { provider: 'x', item: 'y', total: 100, n: 1.5, start: '2026-11-01', firstPaid: false }), /invalid-months/);
});

test('due in a month and first payment paid', () => {
  const s = createState([]);
  addPlan(s, { provider: 'تمارا', item: 'أثاث', total: 414476, n: 4, start: '2026-11-03', firstPaid: true });
  const nov = dueIn(s, '2026-11');
  assert.equal(nov[0].amount, 103619);
  assert.equal(nov[0].paid, true);
  assert.equal(dueIn(s, '2026-12')[0].paid, false);
  assert.equal(remaining(s.plans[0]), 310857);
  assert.equal(dueIn(s, '2027-03').length, 0);
});

test('validation of plan fields', () => {
  const s = createState([]);
  const ok = { provider: 'a', item: 'b', total: 100, n: 2, start: '2026-11-01', firstPaid: false };
  for (const bad of [{ provider: '  ' }, { item: '' }, { total: 0 }, { total: -5 }, { total: 1.5 }, { total: 2 ** 53 }, { start: '2026-11' }, { start: 'x' }]) {
    assert.throws(() => addPlan(s, { ...ok, ...bad }), /invalid-plan/);
  }
  assert.equal(s.plans.length, 0);
});

test('setPaid, errors, updatedAt, deletePlan', () => {
  const s = createState([]);
  try {
    setClock(() => 1000);
    const id = addPlan(s, { provider: ' تابي ', item: ' x ', total: 300, n: 3, start: '2026-01-31', firstPaid: false });
    const p = s.plans[0];
    assert.equal(p.provider, 'تابي');
    assert.equal(p.updatedAt, 1000);
    assert.equal(p.deleted, false);
    setClock(() => 2000);
    setPaid(s, id, 1, true);
    assert.deepEqual(p.paid, [false, true, false]);
    assert.equal(p.updatedAt, 2000);
    assert.equal(remaining(p), 200);
    assert.throws(() => setPaid(s, 'nope', 0, true), /plan-not-found/);
    assert.throws(() => setPaid(s, id, 3, true), /invalid-payment/);
    assert.throws(() => setPaid(s, id, -1, true), /invalid-payment/);
    setClock(() => 3000);
    deletePlan(s, id);
    assert.equal(p.deleted, true);
    assert.equal(p.updatedAt, 3000);
    assert.equal(dueIn(s, '2026-01').length, 0);
    assert.throws(() => deletePlan(s, 'nope'), /plan-not-found/);
  } finally { setClock(null); }
});

test('payments always sum to total', () => {
  for (const total of [1, 100, 99999, 100001, 414476, 4800001, 123456789]) {
    for (let n = 1; n <= 48; n++) {
      const p = { total, n };
      let sum = 0;
      for (let k = 0; k < n; k++) sum += paymentAmount(p, k);
      assert.equal(sum, total, `total ${total} n ${n}`);
    }
  }
});
