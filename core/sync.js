// Encrypted sync through the GitHub REST contents API (one file in a private repo).
// Flow: GET remote -> decrypt -> merge with local -> encrypt -> PUT with sha.
// Safety: any read/decrypt failure aborts before a PUT, so remote data is never
// overwritten by a state that was not merged with it. Input state is never mutated.
import { encryptJSON, decryptJSON } from './crypto.js';
import { mergeStates } from './merge.js';

const API = 'https://api.github.com';
const ACCEPT = 'application/vnd.github+json';
const ACCEPT_RAW = 'application/vnd.github.raw+json';

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function b64ToUtf8(b64) {
  const s = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function fail(status) {
  if (status === 401 || status === 403) return new Error('bad-token');
  return new Error('sync-failed', { cause: status });
}

async function call(fetchFn, url, init) {
  try {
    return await fetchFn(url, init);
  } catch {
    throw new Error('offline');
  }
}

// Reading the body can fail mid-stream (connection dropped) -> offline.
async function readText(res) {
  try {
    return await res.text();
  } catch {
    throw new Error('offline');
  }
}

function parseEnvelope(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('bad-envelope');
  }
}

// -> { sha, remote } or null when the file does not exist yet.
async function pull(fetchFn, url, headers, passphrase) {
  const res = await call(fetchFn, url, { method: 'GET', headers, cache: 'no-store' });
  if (res.status === 404) return null;
  if (res.status !== 200) throw fail(res.status);
  let meta;
  try { meta = JSON.parse(await readText(res)); } catch (e) {
    if (e.message === 'offline') throw e;
    throw new Error('sync-failed', { cause: res.status });
  }
  if (!meta || typeof meta.sha !== 'string') throw new Error('sync-failed', { cause: res.status });
  let text;
  const content = typeof meta.content === 'string' ? meta.content.replace(/\s+/g, '') : '';
  if (meta.encoding === 'none' || (content === '' && meta.size > 0)) {
    // Files over 1 MB: content is omitted; fetch the raw bytes instead.
    const raw = await call(fetchFn, url, { method: 'GET', headers: { ...headers, Accept: ACCEPT_RAW }, cache: 'no-store' });
    if (raw.status !== 200) throw fail(raw.status);
    text = await readText(raw);
  } else {
    try { text = b64ToUtf8(content); } catch { throw new Error('bad-envelope'); }
  }
  const remote = await decryptJSON(parseEnvelope(text), passphrase);
  return { sha: meta.sha, remote };
}

export async function syncNow({
  state, token, passphrase,
  owner = 'saad-00', repo = 'toolbox-data', path = 'toolbox.enc.json',
  deviceId = 'device', fetch: fetchFn = globalThis.fetch,
}) {
  const url = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: ACCEPT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const got = await pull(fetchFn, url, headers, passphrase);
    const merged = got ? mergeStates(state, got.remote) : JSON.parse(JSON.stringify(state));
    const envelope = await encryptJSON(merged, passphrase);
    const body = {
      message: `sync ${deviceId} ${new Date().toISOString()}`,
      content: utf8ToB64(JSON.stringify(envelope)),
    };
    if (got) body.sha = got.sha;
    const res = await call(fetchFn, url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 200 || res.status === 201) {
      return { state: merged, status: got ? 'pushed' : 'created' };
    }
    if (res.status === 409 || res.status === 422) continue;
    if (res.status === 404) throw new Error('repo-not-found');
    throw fail(res.status);
  }
  throw new Error('conflict');
}
