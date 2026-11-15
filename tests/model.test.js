import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, uid, addCategory, renameCategory, deleteCategory, catLabel,
  addTx, deleteTx, setClock, now, getCategory, liveCats,
} from '../core/model.js';

test('default categories are keys, shown in user language', () => {
  const s = createState(['cat.food']);
  assert.equal(s.cats[0].nameKey, 'cat.food');
  assert.equal(catLabel(s.cats[0], k => k === 'cat.food' ? 'الأكل' : k), 'الأكل');
});
test('renamed category keeps the user text', () => {
  const s = createState(['cat.food']); renameCategory(s, s.cats[0].id, 'مطاعم');
  assert.equal(catLabel(s.cats[0], () => 'X'), 'مطاعم');
});
test('cannot delete a category that has live transactions', () => {
  const s = createState([]); const c = addCategory(s, 'هدايا');
  const tx = addTx(s, {catId: c, amount: 5000, date: '2026-11-03', note: ''});
  assert.throws(() => deleteCategory(s, c), /category-has-tx/);
  deleteTx(s, tx); deleteCategory(s, c);
  assert.equal(s.cats.find(x => x.id === c).deleted, true);
});
test('delete marks, never removes', () => {
  const s = createState([]); const c = addCategory(s, 'a'); const id = addTx(s, {catId: c, amount: 100, date: '2026-11-01', note: ''});
  deleteTx(s, id); assert.equal(s.tx.length, 1); assert.equal(s.tx[0].deleted, true);
});
test('state shape, month derived from date, updatedAt from clock', () => {
  setClock(() => 1000);
  const s = createState(['cat.a', 'cat.b']);
  assert.deepEqual([s.v, s.months, s.tx, s.plans], [1, {}, [], []]);
  assert.deepEqual(s.cats.map(c => c.order), [1, 2]);
  assert.equal(s.cats[0].updatedAt, 0); // untouched starters never beat a real edit
  assert.equal(s.cats[0].id, 'cat.a');
  const c = addCategory(s, '  هدايا  ');
  assert.equal(getCategory(s, c).name, 'هدايا');
  assert.equal(getCategory(s, c).order, 3);
  setClock(() => 2000);
  const id = addTx(s, {catId: c, amount: 100, date: '2026-11-09', note: 'n'});
  const t = s.tx.find(x => x.id === id);
  assert.equal(t.month, '2026-11'); assert.equal(t.updatedAt, 2000); assert.equal(t.deleted, false);
  setClock(() => 3000);
  deleteTx(s, id); assert.equal(t.updatedAt, 3000);
  renameCategory(s, c, 'x'); assert.equal(getCategory(s, c).updatedAt, 3000);
  setClock(); assert.equal(typeof now(), 'number');
  assert.notEqual(uid(), uid());
});
test('invalid category names rejected', () => {
  const s = createState([]);
  assert.throws(() => addCategory(s, '   '), /invalid-name/);
  const c = addCategory(s, 'a');
  assert.throws(() => renameCategory(s, c, ' '), /invalid-name/);
});
test('deleteCategory checks live tx in any month; liveCats sorted', () => {
  const s = createState([]);
  const a = addCategory(s, 'a'); const b = addCategory(s, 'b');
  addTx(s, {catId: a, amount: 1, date: '2025-01-01', note: ''});
  assert.throws(() => deleteCategory(s, a), /category-has-tx/);
  deleteCategory(s, b);
  assert.deepEqual(liveCats(s).map(c => c.id), [a]);
});
test('addTx validates input', () => {
  const s = createState([]); const c = addCategory(s, 'a'); const d = addCategory(s, 'd'); deleteCategory(s, d);
  const ok = { catId: c, amount: 100, date: '2026-11-01', note: '' };
  for (const bad of [
    { ...ok, catId: 'nope' }, { ...ok, catId: d }, { ...ok, amount: 0 }, { ...ok, amount: -5 },
    { ...ok, amount: 1.5 }, { ...ok, amount: Number.MAX_SAFE_INTEGER + 2 }, { ...ok, date: '2026-1-1' }, { ...ok, date: '' },
  ]) assert.throws(() => addTx(s, bad), /invalid-tx/);
  assert.equal(s.tx.length, 0);
});

test('starter categories have stable ids so two fresh devices merge to nine', async () => {
  const { DEFAULT_CAT_KEYS } = await import('../core/model.js');
  const { mergeStates } = await import('../core/merge.js');
  setClock(() => 5000);
  let a, b;
  try { a = createState(DEFAULT_CAT_KEYS); } finally { setClock(); }
  setClock(() => 9000);
  try { b = createState(DEFAULT_CAT_KEYS); } finally { setClock(); }
  assert.deepEqual(a.cats.map((c) => c.id), DEFAULT_CAT_KEYS);
  assert.ok(a.cats.every((c) => c.updatedAt === 0));
  assert.deepEqual(a, b);
  assert.equal(mergeStates(a, b).cats.length, 9);
});
test('a renamed or deleted starter wins over a fresh device', async () => {
  const { DEFAULT_CAT_KEYS } = await import('../core/model.js');
  const { mergeStates } = await import('../core/merge.js');
  const a = createState(DEFAULT_CAT_KEYS);
  setClock(() => 1000);
  try { renameCategory(a, 'cat.food', 'مطاعم'); deleteCategory(a, 'cat.bills'); } finally { setClock(); }
  const fresh = createState(DEFAULT_CAT_KEYS);
  for (const m of [mergeStates(a, fresh), mergeStates(fresh, a)]) {
    assert.equal(m.cats.length, 9);
    assert.equal(getCategory(m, 'cat.food').name, 'مطاعم');
    assert.equal(getCategory(m, 'cat.bills').deleted, true);
  }
});
test('a subset of starters keeps the same order as the full list', async () => {
  const { DEFAULT_CAT_KEYS } = await import('../core/model.js');
  const { mergeStates } = await import('../core/merge.js');
  const full = createState(DEFAULT_CAT_KEYS);
  const part = createState(['cat.food', 'cat.savings']);
  assert.equal(getCategory(part, 'cat.food').order, getCategory(full, 'cat.food').order);
  assert.deepEqual(mergeStates(full, part), mergeStates(full, full));
});
