// Passphrase encryption of the app state: AES-GCM 256, key via PBKDF2-SHA256.
const ITER = 600000;
const KDF = 'PBKDF2-SHA256';
const subtle = globalThis.crypto.subtle;

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt, iter) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function checkPassphrase(p) {
  if (typeof p !== 'string' || p.length === 0) throw new Error('empty-passphrase');
}

export async function encryptJSON(obj, passphrase) {
  checkPassphrase(passphrase);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITER);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  return { v: 1, kdf: KDF, iter: ITER, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptJSON(envelope, passphrase) {
  checkPassphrase(passphrase);
  const e = envelope;
  if (!e || typeof e !== 'object' || e.v !== 1 || e.kdf !== KDF ||
      !Number.isInteger(e.iter) || e.iter < ITER ||
      typeof e.salt !== 'string' || typeof e.iv !== 'string' || typeof e.ct !== 'string') {
    throw new Error('bad-envelope');
  }
  let salt, iv, ct;
  try { salt = fromB64(e.salt); iv = fromB64(e.iv); ct = fromB64(e.ct); } catch { throw new Error('bad-envelope'); }
  let plain;
  try {
    const key = await deriveKey(passphrase, salt, e.iter);
    plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch { throw new Error('wrong-passphrase'); }
  return JSON.parse(new TextDecoder().decode(plain));
}
