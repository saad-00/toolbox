// Device-local persistence in IndexedDB (browser only). DB 'toolbox' v1, store 'kv'.
// Keys: 'state' (synced app state), 'settings' and 'outbox' (device-local, never synced).
import { mergeForSave } from './merge.js';

let dbPromise = null;
// Tabs of the app on this device ping each other after every state save. A channel instance
// never receives its own messages, so one shared instance both posts and listens.
let channel = null;
function chan() {
  if (!channel && typeof BroadcastChannel === 'function') {
    try { channel = new BroadcastChannel('toolbox'); } catch { channel = null; }
  }
  return channel;
}
export function onStateSaved(fn) {
  const c = chan();
  if (c) c.addEventListener('message', (e) => { if (e.data && e.data.type === 'state-saved') fn(); });
}

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('toolbox', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

async function get(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function put(key, value) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function loadState() { return (await get('state')) ?? null; }
// Merge-on-save: in ONE readwrite transaction read the stored state, merge the live state into
// it, and write the result, so a stale tab can never erase what another tab saved. Resolves to
// the merged state (a new object), which the caller adopts. Other tabs are pinged afterwards.
export async function saveState(state) {
  const db = await open();
  const out = await new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    const os = tx.objectStore('kv');
    let merged;
    const r = os.get('state');
    r.onsuccess = () => {
      try {
        merged = r.result ? mergeForSave(r.result, state) : structuredClone(state);
        os.put(merged, 'state');
      } catch (e) { try { tx.abort(); } catch { /* already finished */ } reject(e); }
    };
    tx.oncomplete = () => resolve(merged);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('save-aborted'));
  });
  try { chan()?.postMessage({ type: 'state-saved' }); } catch { /* best effort */ }
  return out;
}
export async function loadSettings() { return (await get('settings')) ?? {}; }
export async function saveSettings(obj) { await put('settings', obj); }

// Feedback messages waiting to be sent (device-local, never synced).
export async function loadOutbox() { const v = await get('outbox'); return Array.isArray(v) ? v : []; }
export async function saveOutbox(list) { await put('outbox', list); }

export async function requestPersist() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
