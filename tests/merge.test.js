import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, addCategory, addTx, deleteTx, setClock } from '../core/model.js';
import { setBudget } from '../core/months.js';
import { addPlan, setPaid } from '../tools/expenses/installments.js';
import { mergeStates, mergeForSave } from '../core/merge.js';

const norm = (s) => JSON.parse(JSON.stringify(s));
function at(t, fn) {
  setClock(() => t);
  try { return fn(); } finally { setClock(null); }
}
function base() {
  return at(1, () => {
    const s = createState([]);
    s.cats.push({ id: 'c1', name: 'Food', nameKey: null, order: 1, deleted: false, updatedAt: 1 });
    return s;
  });
}
const clone = (s) => norm(s);

test('transactions from both devices survive', () => {
  const a = base(); const b = clone(a);
  const t1 = at(5, () => addTx(a, { catId: 'c1', amount: 1000, date: '2026-11-01', note: 'a' }));
  const t2 = at(6, () => addTx(b, { catId: 'c1', amount: 2000, date: '2026-11-02', note: 'b' }));
  const m = mergeStates(a, b);
  assert.equal(m.tx.length, 2);
  assert.deepEqual(m.tx.map((t) => t.id).sort(), [t1, t2].sort());
  assert.deepEqual(m.tx.map((t) => t.id), [...m.tx.map((t) => t.id)].sort());
});

test('newer updatedAt wins per record', () => {
  const a = base(); const id = at(5, () => addTx(a, { catId: 'c1', amount: 1000, date: '2026-11-01', note: 'x' }));
  const b = clone(a);
  b.tx[0].amount = 7777; b.tx[0].updatedAt = 9;
  assert.equal(mergeStates(a, b).tx.find((t) => t.id === id).amount, 7777);
  assert.equal(mergeStates(b, a).tx.find((t) => t.id === id).amount, 7777);
});

test('a newer delete beats an older edit', () => {
  const a = base(); const id = at(5, () => addTx(a, { catId: 'c1', amount: 1000, date: '2026-11-01', note: 'x' }));
  const b = clone(a);
  at(20, () => deleteTx(a, id));
  b.tx[0].amount = 5555; b.tx[0].updatedAt = 10;
  const m = mergeStates(a, b);
  assert.equal(m.tx[0].deleted, true);
  assert.equal(mergeStates(b, a).tx[0].deleted, true);
});

test('months merge per key by updatedAt', () => {
  const a = base(); const b = clone(a);
  at(10, () => setBudget(a, '2026-10', 'c1', 100));
  at(30, () => setBudget(b, '2026-10', 'c1', 300));
  at(40, () => setBudget(a, '2026-11', 'c1', 400));
  const m = mergeStates(a, b);
  assert.equal(m.months['2026-10'].budget.c1, 300);
  assert.equal(m.months['2026-11'].budget.c1, 400);
  assert.deepEqual(norm(m), norm(mergeStates(b, a)));
});

test('merge is commutative and idempotent', () => {
  const a = base(); const b = clone(a);
  at(5, () => addTx(a, { catId: 'c1', amount: 1, date: '2026-11-01', note: '' }));
  at(6, () => addTx(b, { catId: 'c1', amount: 2, date: '2026-11-02', note: '' }));
  at(7, () => setBudget(a, '2026-11', 'c1', 9));
  assert.deepEqual(norm(mergeStates(a, b)), norm(mergeStates(b, a)));
  assert.deepEqual(norm(mergeStates(a, a)), norm(a));
  const m = mergeStates(a, b);
  assert.deepEqual(norm(mergeStates(m, a)), norm(m));
});

test('tie on updatedAt resolves deterministically by JSON', () => {
  const a = base(); const b = clone(a);
  a.cats[0].name = 'A'; b.cats[0].name = 'B';
  assert.equal(mergeStates(a, b).cats[0].name, 'B');
  assert.equal(mergeStates(b, a).cats[0].name, 'B');
});

test('plan paid flags OR-merge across devices', () => {
  const a = base();
  const id = at(2, () => addPlan(a, { provider: 'Tabby', item: 'TV', total: 40000, n: 4, start: '2026-11-01', firstPaid: true }));
  const b = clone(a);
  at(5, () => setPaid(a, id, 1, true));
  at(6, () => setPaid(b, id, 2, true));
  const m = mergeStates(a, b);
  assert.deepEqual(m.plans[0].paid, [true, true, true, false]);
  assert.equal(m.plans[0].updatedAt, 6);
  assert.deepEqual(norm(m), norm(mergeStates(b, a)));
});

test('plan with different n: winner paid kept, no OR', () => {
  const a = base();
  const id = at(2, () => addPlan(a, { provider: 'T', item: 'x', total: 300, n: 3, start: '2026-11-01', firstPaid: true }));
  const b = clone(a);
  b.plans[0].n = 2; b.plans[0].paid = [false, false]; b.plans[0].updatedAt = 9;
  const m = mergeStates(a, b);
  assert.deepEqual(m.plans.find((p) => p.id === id).paid, [false, false]);
});

test('merge is pure: inputs are not mutated or aliased', () => {
  const a = base(); const b = clone(a);
  at(2, () => addPlan(a, { provider: 'T', item: 'x', total: 300, n: 3, start: '2026-11-01' }));
  at(3, () => addPlan(b, { provider: 'U', item: 'y', total: 300, n: 3, start: '2026-11-01' }));
  at(4, () => setBudget(a, '2026-11', 'c1', 5));
  const sa = JSON.stringify(a); const sb = JSON.stringify(b);
  const m = mergeStates(a, b);
  m.plans[0].paid[0] = true; m.months['2026-11'].budget.c1 = 99; m.cats[0].name = 'zzz';
  assert.equal(JSON.stringify(a), sa);
  assert.equal(JSON.stringify(b), sb);
});

test('missing sections are treated as empty; v is the max', () => {
  const a = base(); at(5, () => addTx(a, { catId: 'c1', amount: 1, date: '2026-11-01', note: '' }));
  const b = { v: 2 };
  const m = mergeStates(a, b);
  assert.equal(m.v, 2);
  assert.equal(m.tx.length, 1);
  assert.deepEqual(m.plans, []);
  assert.deepEqual(m.months, {});
  const m2 = mergeStates({}, {});
  assert.deepEqual(m2.cats, []); assert.deepEqual(m2.tx, []);
});

test('mergeForSave (same device) keeps a newer un-mark', () => {
  const a = base();
  const id = at(2, () => addPlan(a, { provider: 'T', item: 'x', total: 300, n: 3, start: '2026-11-01', firstPaid: true }));
  const stored = clone(a);
  at(5, () => setPaid(a, id, 0, false));
  assert.deepEqual(mergeForSave(stored, a).plans[0].paid, [false, false, false]);
  assert.deepEqual(mergeStates(stored, a).plans[0].paid, [true, false, false]); // cross-device default
});

test('mergeForSave: live wins ties and keeps its order; stored-only records are kept', () => {
  const live = base();
  at(5, () => addPlan(live, { provider: 'Z', item: 'z', total: 300, n: 3, start: '2026-11-01', firstPaid: true }));
  at(5, () => addPlan(live, { provider: 'A', item: 'a', total: 300, n: 3, start: '2026-11-01' }));
  const stored = clone(live);
  stored.plans[0].paid[0] = false; // same updatedAt, different content
  stored.tx.push({ id: '0-other-tab', month: '2026-11', catId: 'c1', amount: 9, date: '2026-11-01', note: '', deleted: false, updatedAt: 6 });
  const m = mergeForSave(stored, live);
  assert.deepEqual(m.plans.map((p) => p.provider), ['Z', 'A']);
  assert.equal(m.plans[0].paid[0], true);
  assert.equal(m.tx.length, 1);
});

test('a category deleted on one device is restored when the other device spent in it', () => {
  const a = base(); const b = clone(a);
  at(10, () => { a.cats[0].deleted = true; a.cats[0].updatedAt = 10; }); // a: delete (no tx there)
  const id = at(5, () => addTx(b, { catId: 'c1', amount: 700, date: '2026-11-03', note: '' }));
  for (const m of [mergeStates(a, b), mergeStates(b, a), mergeForSave(a, b)]) {
    const c = m.cats.find((x) => x.id === 'c1');
    assert.equal(c.deleted, false);
    assert.equal(c.updatedAt, 10);
    assert.equal(m.tx.find((x) => x.id === id).deleted, false);
  }
  assert.deepEqual(norm(mergeStates(a, b)), norm(mergeStates(b, a)));
  // a deleted tx does not hold the category
  const c2 = clone(b); c2.tx[0].deleted = true; c2.tx[0].updatedAt = 6;
  assert.equal(mergeStates(a, c2).cats.find((x) => x.id === 'c1').deleted, true);
});

test('unknown top-level keys are carried through (greater v wins)', () => {
  const a = { ...base(), goals: ['a'] };
  const b = { ...clone(base()), v: 2, goals: ['b'], extra: 1 };
  for (const m of [mergeStates(a, b), mergeStates(b, a)]) {
    assert.deepEqual(m.goals, ['b']);
    assert.equal(m.extra, 1);
    assert.equal(m.v, 2);
  }
  const c = { ...base(), only: { x: 1 } };
  assert.deepEqual(mergeStates(c, base()).only, { x: 1 });
  assert.deepEqual(mergeStates(base(), c).only, { x: 1 });
  // same v: deterministic (commutative) across devices; the live side on a same-device save
  const p = { ...base(), k: 'p' }; const q = { ...base(), k: 'q' };
  assert.equal(mergeStates(p, q).k, mergeStates(q, p).k);
  assert.equal(mergeForSave(p, q).k, 'q');
  assert.equal(mergeForSave(q, p).k, 'p');
  // copies, not aliases
  const m = mergeStates(c, base()); m.only.x = 9;
  assert.equal(c.only.x, 1);
});
