import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELEASES, APP_VERSION } from '../core/version.js';
import { makeMessage, toPayload, send, flushOutbox, enqueue, deviceInfo, ACCESS_KEY, MAX_OUTBOX, MAX_TRIES } from '../core/feedback.js';

test('APP_VERSION is the newest release, releases are newest first with ar/en notes', () => {
  assert.equal(APP_VERSION, RELEASES[0].v);
  const nums = RELEASES.map((r) => r.v.split('.').map(Number));
  for (let i = 1; i < nums.length; i++) assert.ok(nums[i - 1][0] > nums[i][0] || (nums[i - 1][0] === nums[i][0] && nums[i - 1][1] > nums[i][1]), RELEASES[i].v);
  for (const r of RELEASES) { assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(r.ar.length && r.ar.length === r.en.length, r.v); }
});

test('makeMessage validates kind and text, trims, and caps lengths', () => {
  assert.throws(() => makeMessage({ kind: 'x', message: 'hello' }), /feedback-kind/);
  assert.throws(() => makeMessage({ kind: 'idea', message: '  a ' }), /feedback-empty/);
  const m = makeMessage({ kind: 'idea', message: '  فكرة حلوة  ', name: ' سعد ', contact: ' 05xxxxxxxx ', lang: 'ar', device: 'Android' }, 1000);
  assert.equal(m.message, 'فكرة حلوة');
  assert.equal(m.name, 'سعد');
  assert.equal(m.contact, '05xxxxxxxx');
  assert.equal(m.device, '', 'device info only on bug reports');
  assert.equal(m.version, APP_VERSION);
  assert.equal(makeMessage({ kind: 'bug', message: 'x'.repeat(5000), device: 'iOS' }).message.length, 1000);
  assert.equal(makeMessage({ kind: 'bug', message: 'boom', device: 'iOS' }).device, 'iOS');
});

test('toPayload carries the key, a subject per kind and no empty device line', () => {
  const p = toPayload(makeMessage({ kind: 'tool', message: 'حاسبة زكاة' }, Date.UTC(2026, 10, 15, 17, 0)));
  assert.equal(p.access_key, ACCESS_KEY);
  assert.match(p.subject, /طلب أداة/);
  assert.equal(p['الرسالة'], 'حاسبة زكاة');
  assert.equal(p['للتواصل'], '—');
  assert.equal(p['الاسم'], '—');
  assert.equal(p.from_name, 'أدواتي');
  assert.equal(p['التاريخ'], '2026-11-15 17:00');
  assert.equal(p.botcheck, false);
  assert.ok(!('الجهاز' in p));
  assert.equal(toPayload(makeMessage({ kind: 'bug', message: 'boom', device: 'iOS' }))['الجهاز'], 'iOS');
});

test('send: success, refusal and offline', async () => {
  const m = makeMessage({ kind: 'idea', message: 'hello' });
  let body;
  assert.equal(await send(m, async (_u, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ success: true }) }; }), true);
  assert.equal(body.access_key, ACCESS_KEY);
  await assert.rejects(send(m, async () => ({ ok: false, json: async () => ({ success: false }) })), /feedback-failed/);
  await assert.rejects(send(m, async () => ({ ok: true, json: async () => { throw new Error('x'); } })), /feedback-failed/);
  await assert.rejects(send(m, async () => { throw new TypeError('Failed to fetch'); }), /offline/);
});

test('outbox: queued messages send in order; offline stops the run; refusals give up after MAX_TRIES', async () => {
  let box = [];
  const io = { load: async () => box, save: async (b) => { box = b; } };
  for (const t of ['aaa', 'bbb', 'ccc']) await enqueue(makeMessage({ kind: 'idea', message: t }), io);
  const seen = [];
  let r = await flushOutbox({ ...io, sendImpl: async (m) => { seen.push(m.message); if (m.message === 'bbb') throw new Error('offline'); } });
  assert.deepEqual(seen, ['aaa', 'bbb']);
  assert.deepEqual(r, { sent: 1, left: 2 });
  assert.deepEqual(box.map((m) => m.message), ['bbb', 'ccc']);
  for (let i = 0; i < MAX_TRIES; i++) await flushOutbox({ ...io, sendImpl: async () => { throw new Error('feedback-failed'); } });
  assert.equal(box.length, 0);
  for (let i = 0; i < MAX_OUTBOX + 5; i++) await enqueue(makeMessage({ kind: 'idea', message: `msg${i}` }), io);
  assert.equal(box.length, MAX_OUTBOX);
  assert.equal(box.at(-1).message, `msg${MAX_OUTBOX + 4}`);
});

test('deviceInfo is coarse', () => {
  const d = deviceInfo({ userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/130 Mobile Safari/537' }, { width: 390, height: 844 });
  assert.equal(d, 'Android · Chrome · browser · 390x844');
});
