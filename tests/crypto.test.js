import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptJSON, decryptJSON } from '../core/crypto.js';

test('round trip with Arabic text', async () => {
  const e = await encryptJSON({ x: 'فلوس البيت' }, 'pw');
  assert.deepEqual(await decryptJSON(e, 'pw'), { x: 'فلوس البيت' });
  assert.equal(e.v, 1);
  assert.equal(e.kdf, 'PBKDF2-SHA256');
  assert.equal(e.iter, 600000);
  assert.equal(atob(e.salt).length, 16);
  assert.equal(atob(e.iv).length, 12);
});

test('wrong passphrase', async () => {
  const e = await encryptJSON({ x: 1 }, 'pw');
  await assert.rejects(decryptJSON(e, 'nope'), /wrong-passphrase/);
});

test('ciphertext hides the data and changes every time', async () => {
  const a = await encryptJSON({ x: 'فلوس البيت' }, 'pw');
  const b = await encryptJSON({ x: 'فلوس البيت' }, 'pw');
  assert.ok(!JSON.stringify(a).includes('فلوس'));
  assert.notEqual(a.ct, b.ct);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
});

test('bad envelope', async () => {
  const e = await encryptJSON({ x: 1 }, 'pw');
  for (const bad of [null, {}, { ...e, v: 2 }, { ...e, kdf: 'x' }, { ...e, iter: 1000 }, { ...e, iter: 'a' }, { ...e, ct: undefined }, { ...e, salt: undefined }]) {
    await assert.rejects(decryptJSON(bad, 'pw'), /bad-envelope/);
  }
});

test('empty passphrase', async () => {
  await assert.rejects(encryptJSON({ x: 1 }, ''), /empty-passphrase/);
  const e = await encryptJSON({ x: 1 }, 'pw');
  await assert.rejects(decryptJSON(e, ''), /empty-passphrase/);
});

test('~1 MB state round trip', async () => {
  const big = { rows: Array.from({ length: 30000 }, (_, i) => ({ id: i, note: 'ملاحظة رقم ' + i, a: 12345 })) };
  assert.ok(JSON.stringify(big).length > 1_000_000);
  const e = await encryptJSON(big, 'pw');
  assert.deepEqual(await decryptJSON(e, 'pw'), big);
});
