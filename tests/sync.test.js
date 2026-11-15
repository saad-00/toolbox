import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, addCategory, addTx, setClock } from '../core/model.js';
import { encryptJSON, decryptJSON } from '../core/crypto.js';
import { syncNow, pullRemote } from '../core/sync.js';

const URL_ = 'https://api.github.com/repos/saad-00/toolbox-data/contents/toolbox.enc.json';
const PASS = 'mine';

function b64utf8(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}
function unb64utf8(b64) {
  return Buffer.from(b64, 'base64').toString('utf8');
}
// GitHub wraps base64 content at 60 chars with '\n'.
function wrap(b64) {
  return b64.replace(/(.{60})/g, '$1\n');
}

function mkState(catName, amount, t = 1000) {
  setClock(() => t);
  try {
    const s = createState([]);
    const c = addCategory(s, catName);
    const id = addTx(s, { catId: c, amount, date: '2026-11-10', note: catName + ' note' });
    return { s, id };
  } finally { setClock(null); }
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

// Fake GitHub contents API. Holds one file {env, sha}. `getQueue` / `putQueue`
// hold scripted overrides consumed in order: a status number, or an async fn
// (fake) => Response. `large` serves the file like GitHub does for >1 MB files.
function fakeGitHub(initialEnvelope, { getQueue = [], putQueue = [], large = false } = {}) {
  let seq = 1;
  const fake = {
    file: initialEnvelope ? { env: initialEnvelope, sha: 'sha' + seq++ } : null,
    gets: [],
    puts: [],
    requests: [],
    setFile(env) { fake.file = { env, sha: 'sha' + seq++ }; },
  };
  fake.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const headers = { ...(init.headers || {}) };
    const rec = { url, method, headers };
    fake.requests.push(rec);
    if (method === 'GET') {
      fake.gets.push(rec);
      const ov = getQueue.shift();
      if (typeof ov === 'number') return json(ov, { message: 'scripted' });
      if (typeof ov === 'function') return ov(fake);
      if (!fake.file) return json(404, { message: 'Not Found' });
      const text = JSON.stringify(fake.file.env);
      if (headers.Accept === 'application/vnd.github.raw+json') {
        return new Response(text, { status: 200 });
      }
      if (large) {
        return json(200, { sha: fake.file.sha, size: text.length, encoding: 'none', content: '' });
      }
      return json(200, { sha: fake.file.sha, size: text.length, encoding: 'base64', content: wrap(b64utf8(text)) });
    }
    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      rec.body = body;
      fake.puts.push(rec);
      const ov = putQueue.shift();
      if (typeof ov === 'number') return json(ov, { message: 'scripted' });
      if (typeof ov === 'function') return ov(fake);
      const cur = fake.file ? fake.file.sha : undefined;
      if (body.sha !== cur) return json(cur ? 409 : 422, { message: 'sha mismatch' });
      const created = !fake.file;
      fake.setFile(JSON.parse(unb64utf8(body.content)));
      return json(created ? 201 : 200, { content: { sha: fake.file.sha } });
    }
    return json(405, {});
  };
  return fake;
}

async function uploaded(put, pass = PASS) {
  return decryptJSON(JSON.parse(unb64utf8(put.body.content)), pass);
}
const txIds = (s) => s.tx.map((x) => x.id).sort();

test('first sync creates the file', async () => {
  const { s, id } = mkState('Food', 500);
  const before = JSON.stringify(s);
  const f = fakeGitHub(null);
  const r = await syncNow({ state: s, token: 'tok', passphrase: PASS, deviceId: 'pc', fetch: f.fetch });
  assert.equal(r.status, 'created');
  assert.equal(f.gets.length, 1);
  assert.equal(f.puts.length, 1);
  assert.equal(f.puts[0].url, URL_);
  assert.equal('sha' in f.puts[0].body, false);
  assert.match(f.puts[0].body.message, /^sync pc \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(txIds(r.state), [id]);
  assert.deepEqual(await uploaded(f.puts[0]), r.state);
  assert.notEqual(r.state, s);
  assert.equal(JSON.stringify(s), before, 'input not mutated');
});

test('pull, merge, push', async () => {
  const local = mkState('Food', 500, 1000);
  const remote = mkState('Fuel', 700, 2000);
  const f = fakeGitHub(await encryptJSON(remote.s, PASS));
  const before = JSON.stringify(local.s);
  const r = await syncNow({ state: local.s, token: 'tok', passphrase: PASS, fetch: f.fetch });
  assert.equal(r.status, 'pushed');
  assert.equal(f.puts.length, 1);
  assert.equal(f.puts[0].body.sha, 'sha1');
  const want = [local.id, remote.id].sort();
  assert.deepEqual(txIds(r.state), want);
  assert.deepEqual(txIds(await uploaded(f.puts[0])), want);
  assert.equal(JSON.stringify(local.s), before, 'input not mutated');
});

test('409 retries once with a fresh pull (third device tx survives)', async () => {
  const local = mkState('Food', 500, 1000);
  const remote = mkState('Fuel', 700, 2000);
  const third = mkState('Rent', 900, 3000);
  const thirdEnv = await encryptJSON(unionOf(remote.s, third.s), PASS);
  const f = fakeGitHub(await encryptJSON(remote.s, PASS), {
    // A third device writes between our GET and PUT: our PUT gets 409.
    putQueue: [async (fk) => { fk.setFile(thirdEnv); return json(409, { message: 'conflict' }); }],
  });
  const r = await syncNow({ state: local.s, token: 'tok', passphrase: PASS, fetch: f.fetch });
  assert.equal(r.status, 'pushed');
  assert.equal(f.gets.length, 2, 're-read after 409');
  assert.equal(f.puts.length, 2);
  assert.equal(f.puts[0].body.sha, 'sha1');
  assert.equal(f.puts[1].body.sha, 'sha2', 'second PUT uses the fresh sha');
  const want = [local.id, remote.id, third.id].sort();
  assert.deepEqual(txIds(await uploaded(f.puts[1])), want);
  assert.deepEqual(txIds(r.state), want);
});

function unionOf(a, b) {
  return { ...a, cats: [...a.cats, ...b.cats], tx: [...a.tx, ...b.tx] };
}

test('second conflict → conflict error', async () => {
  const { s } = mkState('Food', 500);
  const f = fakeGitHub(null, { putQueue: [422, 409] });
  await assert.rejects(syncNow({ state: s, token: 'tok', passphrase: PASS, fetch: f.fetch }), /^Error: conflict$/);
  assert.equal(f.gets.length, 2);
  assert.equal(f.puts.length, 2);
});

test('wrong passphrase never pushes', async () => {
  const { s } = mkState('Food', 500);
  const f = fakeGitHub(await encryptJSON(mkState('Fuel', 1).s, 'other'));
  await assert.rejects(syncNow({ state: s, token: 'tok', passphrase: PASS, fetch: f.fetch }), /wrong-passphrase/);
  assert.equal(f.puts.length, 0);
});

test('bad envelope never pushes', async () => {
  const { s } = mkState('Food', 500);
  const f = fakeGitHub({ hello: 'world' });
  await assert.rejects(syncNow({ state: s, token: 'tok', passphrase: PASS, fetch: f.fetch }), /bad-envelope/);
  assert.equal(f.puts.length, 0);
  const g = fakeGitHub(null, { getQueue: [async () => json(200, { sha: 'x', size: 5, encoding: 'base64', content: b64utf8('not json') })] });
  await assert.rejects(syncNow({ state: s, token: 'tok', passphrase: PASS, fetch: g.fetch }), /bad-envelope/);
  assert.equal(g.puts.length, 0);
});

test('401 → bad-token', async () => {
  const { s } = mkState('Food', 500);
  const f = fakeGitHub(null, { getQueue: [401] });
  await assert.rejects(syncNow({ state: s, token: 'bad', passphrase: PASS, fetch: f.fetch }), /^Error: bad-token$/);
  assert.equal(f.puts.length, 0);
  const g = fakeGitHub(null, { putQueue: [403] });
  await assert.rejects(syncNow({ state: s, token: 'ro', passphrase: PASS, fetch: g.fetch }), /^Error: bad-token$/);
});

test('network error → offline; 404 on PUT → repo-not-found; 500 → sync-failed', async () => {
  const { s } = mkState('Food', 500);
  const off = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(syncNow({ state: s, token: 'tok', passphrase: PASS, fetch: off }), /^Error: offline$/);
  const f = fakeGitHub(null, { putQueue: [404] });
  await assert.rejects(syncNow({ state: s, token: 'tok', passphrase: PASS, fetch: f.fetch }), /^Error: repo-not-found$/);
  const g = fakeGitHub(null, { getQueue: [500] });
  await assert.rejects(syncNow({ state: s, token: 'tok', passphrase: PASS, fetch: g.fetch }), (e) => {
    assert.equal(e.message, 'sync-failed');
    assert.equal(e.cause, 500);
    return true;
  });
  assert.equal(g.puts.length, 0);
});

test('malformed metadata → sync-failed, not offline', async () => {
  const { s } = mkState('Food', 500);
  const f = fakeGitHub(null, { getQueue: [async () => new Response('<html>', { status: 200 })] });
  await assert.rejects(syncNow({ state: s, token: 'tok', passphrase: PASS, fetch: f.fetch }), /^Error: sync-failed$/);
  assert.equal(f.puts.length, 0);
});

test('headers present on every request', async () => {
  const local = mkState('Food', 500, 1000);
  const f = fakeGitHub(await encryptJSON(mkState('Fuel', 1).s, PASS), { putQueue: [409] });
  await syncNow({ state: local.s, token: 'tok123', passphrase: PASS, fetch: f.fetch });
  assert.equal(f.requests.length, 4);
  for (const r of f.requests) {
    assert.equal(r.url, URL_);
    assert.equal(r.headers.Authorization, 'Bearer tok123');
    assert.equal(r.headers.Accept, 'application/vnd.github+json');
    assert.equal(r.headers['X-GitHub-Api-Version'], '2022-11-28');
  }
});

test('oversized file uses the raw media type', async () => {
  const local = mkState('Food', 500, 1000);
  const remote = mkState('Fuel', 700, 2000);
  const f = fakeGitHub(await encryptJSON(remote.s, PASS), { large: true });
  const r = await syncNow({ state: local.s, token: 'tok', passphrase: PASS, fetch: f.fetch });
  assert.equal(f.gets.length, 2);
  assert.equal(f.gets[1].headers.Accept, 'application/vnd.github.raw+json');
  assert.equal(f.gets[1].headers.Authorization, 'Bearer tok');
  assert.equal(f.puts[0].body.sha, 'sha1');
  assert.deepEqual(txIds(r.state), [local.id, remote.id].sort());
});

test('uploaded body never contains plaintext; >1 MB payload round-trips', async () => {
  const { s } = mkState('Groceries-شاورما', 500);
  // Pad with ~1.2 MB of notes (non-ASCII) to exercise chunked base64.
  s.tx[0].note = 'ملاحظة '.repeat(100000);
  const f = fakeGitHub(null);
  await syncNow({ state: s, token: 'tok', passphrase: PASS, fetch: f.fetch });
  const content = f.puts[0].body.content;
  assert.ok(content.length > 1_000_000);
  const raw = unb64utf8(content);
  assert.equal(raw.includes('Groceries'), false);
  assert.equal(raw.includes('شاورما'), false);
  assert.equal(JSON.stringify(f.puts[0].body).includes('Groceries'), false);
  const back = await uploaded(f.puts[0]);
  assert.equal(back.tx[0].note, s.tx[0].note);
  assert.equal(back.cats[0].name, 'Groceries-شاورما');
});

// pullRemote: read-only (used by the welcome connection test). Never PUTs.
test('pullRemote returns null when the file does not exist, with no PUT', async () => {
  const gh = fakeGitHub(null);
  assert.equal(await pullRemote({ token: 't', passphrase: PASS, fetch: gh.fetch }), null);
  assert.equal(gh.gets.length, 1);
  assert.equal(gh.puts.length, 0);
});

test('pullRemote decrypts the remote state, with no PUT (base64 and raw paths)', async () => {
  const { s } = mkState('remote cat', 500);
  for (const large of [false, true]) {
    const gh = fakeGitHub(await encryptJSON(s, PASS), { large });
    const got = await pullRemote({ token: 't', passphrase: PASS, fetch: gh.fetch });
    assert.deepEqual(got, s);
    assert.equal(gh.puts.length, 0);
    assert.equal(gh.gets[0].url, URL_);
    assert.equal(gh.gets[0].headers.Authorization, 'Bearer t');
  }
});

test('pullRemote maps errors like syncNow and never PUTs', async () => {
  const { s } = mkState('x', 1);
  const gh = fakeGitHub(await encryptJSON(s, 'other'));
  await assert.rejects(pullRemote({ token: 't', passphrase: PASS, fetch: gh.fetch }), /wrong-passphrase/);
  const bad = fakeGitHub(null, { getQueue: [401] });
  await assert.rejects(pullRemote({ token: 't', passphrase: PASS, fetch: bad.fetch }), /bad-token/);
  const off = { fetch: async () => { throw new TypeError('net'); } };
  await assert.rejects(pullRemote({ token: 't', passphrase: PASS, fetch: off.fetch }), /offline/);
  assert.equal(gh.puts.length + bad.puts.length, 0);
});
