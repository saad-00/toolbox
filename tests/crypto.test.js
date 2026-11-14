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

test('passphrase is NFC-normalised', async () => {
  const e = await encryptJSON({ x: 1 }, 'é');
  assert.deepEqual(await decryptJSON(e, 'é'), { x: 1 });
  const e2 = await encryptJSON({ x: 2 }, 'كلمة');
  assert.deepEqual(await decryptJSON(e2, 'كلمة'.normalize('NFD')), { x: 2 });
});

test('tampered ciphertext, bad base64, wrong sizes, other iter', async () => {
  const e = await encryptJSON({ x: 1 }, 'pw');
  const bytes = Uint8Array.from(atob(e.ct), c => c.charCodeAt(0));
  bytes[0] ^= 1;
  const ct = btoa(String.fromCharCode(...bytes));
  await assert.rejects(decryptJSON({ ...e, ct }, 'pw'), /wrong-passphrase/);
  await assert.rejects(decryptJSON({ ...e, ct: '***' }, 'pw'), /bad-envelope/);
  await assert.rejects(decryptJSON({ ...e, salt: btoa('short') }, 'pw'), /bad-envelope/);
  await assert.rejects(decryptJSON({ ...e, iv: btoa('short') }, 'pw'), /bad-envelope/);
  await assert.rejects(decryptJSON({ ...e, ct: btoa('tiny') }, 'pw'), /bad-envelope/);
  await assert.rejects(decryptJSON({ ...e, iter: 600001 }, 'pw'), /bad-envelope/);
});

test('unserialisable input', async () => {
  await assert.rejects(encryptJSON(undefined, 'pw'), /invalid-input/);
});
