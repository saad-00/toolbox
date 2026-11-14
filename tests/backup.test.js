import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, addCategory, addTx, setClock } from '../core/model.js';
import { exportBackup, importBackup, needsBackupReminder } from '../core/backup.js';

function mk(t) {
  setClock(() => t);
  try { return createState([]); } finally { setClock(null); }
}
function withTx(base, catName, amount) {
  const s = JSON.parse(JSON.stringify(base));
  setClock(() => 2000);
  try {
    const c = s.cats.find((x) => x.name === catName) ? s.cats.find((x) => x.name === catName).id : addCategory(s, catName);
    return { s, id: addTx(s, { catId: c, amount, date: '2026-11-10' }) };
  } finally { setClock(null); }
}

test('filename has the local date', () => {
  const s = mk(1000);
  const r = exportBackup(s, new Date(2026, 10, 15));
  assert.equal(r.filename, 'toolbox-backup-2026-11-15.json');
  const o = JSON.parse(r.json);
  assert.equal(o.kind, 'toolbox-backup');
  assert.equal(o.v, 1);
  assert.deepEqual(o.state, s);
  assert.equal(typeof o.exportedAt, 'string');
});

test('import merges, never wipes', () => {
  const base = mk(1000);
  const a = withTx(base, 'Food', 500);
  const b = withTx(base, 'Food', 700);
  const json = exportBackup(b.s, new Date(2026, 10, 15)).json;
  const out = importBackup(a.s, json);
  const ids = out.tx.map((x) => x.id);
  assert.ok(ids.includes(a.id));
  assert.ok(ids.includes(b.id));
  assert.equal(out.tx.length, 2);
});

test('bad files refused', () => {
  const s = mk(1000);
  assert.throws(() => importBackup(s, '{"v":9}'), /bad-backup/);
  assert.throws(() => importBackup(s, 'not json'), /bad-backup/);
  assert.throws(() => importBackup(s, JSON.stringify({ kind: 'toolbox-backup', v: 2, state: s })), /bad-backup/);
  assert.throws(() => importBackup(s, JSON.stringify({ kind: 'other', v: 1, state: s })), /bad-backup/);
  assert.throws(() => importBackup(s, JSON.stringify({ kind: 'toolbox-backup', v: 1, state: { cats: [], tx: [], plans: [] } })), /bad-backup/);
  assert.throws(() => importBackup(s, JSON.stringify({ kind: 'toolbox-backup', v: 1, state: { cats: {}, tx: [], plans: [], months: {} } })), /bad-backup/);
});

test('bare state JSON (not wrapped) is refused', () => {
  const s = mk(1000);
  assert.throws(() => importBackup(s, JSON.stringify(s)), /bad-backup/);
});

test('reminder after 30 days', () => {
  const day = 864e5;
  assert.equal(needsBackupReminder(null, 0), true);
  assert.equal(needsBackupReminder(undefined, 0), true);
  assert.equal(needsBackupReminder(0, 29 * day), false);
  assert.equal(needsBackupReminder(0, 30 * day), false);
  assert.equal(needsBackupReminder(0, 31 * day), true);
});
