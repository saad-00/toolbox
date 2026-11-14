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
  assert.equal(s.cats[0].updatedAt, 1000);
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
