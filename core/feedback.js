// «راسلنا»: tool requests, bug reports and suggestions, delivered by e-mail through Web3Forms.
// The access key is public by design (it can only send mail to the owner's inbox), so it lives
// in the code. Messages that cannot be sent (offline, network error) wait in an outbox and are
// retried later. Nothing from the user's expenses is ever included.

import { APP_VERSION } from './version.js';

export const ENDPOINT = 'https://api.web3forms.com/submit';
export const ACCESS_KEY = '268ee1a3-cec2-4742-9d3c-1a73867d1bfd';
export const KINDS = ['tool', 'bug', 'idea'];
export const MAX_MESSAGE = 1000;
export const MAX_CONTACT = 120;
export const MAX_NAME = 60;
export const MAX_OUTBOX = 20;
export const MAX_TRIES = 5;

const SUBJECT = { tool: '🧰 طلب أداة', bug: '🐞 عطل', idea: '💡 اقتراح' };

// Short, non-identifying description of the device (bug reports only).
export function deviceInfo(nav = globalThis.navigator, scr = globalThis.screen) {
  const ua = String(nav?.userAgent || '');
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'other';
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'other';
  const standalone = !!(globalThis.matchMedia?.('(display-mode: standalone)')?.matches || nav?.standalone);
  const size = scr && scr.width ? `${scr.width}x${scr.height}` : '';
  return [os, browser, standalone ? 'installed' : 'browser', size].filter(Boolean).join(' · ');
}

// Validates and normalises a message. Throws Error('feedback-empty' | 'feedback-kind').
export function makeMessage({ kind, message, name = '', contact = '', lang = 'ar', device = '' }, now = Date.now()) {
  if (!KINDS.includes(kind)) throw new Error('feedback-kind');
  const text = String(message ?? '').trim().slice(0, MAX_MESSAGE);
  if (text.length < 3) throw new Error('feedback-empty');
  const nm = String(name ?? '').trim().slice(0, MAX_NAME);
  const how = String(contact ?? '').trim().slice(0, MAX_CONTACT);
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind, message: text, name: nm, contact: how, lang: lang === 'en' ? 'en' : 'ar',
    device: kind === 'bug' ? String(device || '') : '',
    version: APP_VERSION, createdAt: now,
  };
}

// The JSON body Web3Forms expects. Labels are Arabic: the owner reads the mail.
export function toPayload(msg) {
  const body = {
    access_key: ACCESS_KEY,
    subject: `${SUBJECT[msg.kind]} — أدواتي`,
    from_name: msg.name || 'أدواتي',
    'النوع': SUBJECT[msg.kind],
    'الرسالة': msg.message,
    'الاسم': msg.name || '—',
    'للتواصل': msg.contact || '—',
    'لغة التطبيق': msg.lang,
    'نسخة التطبيق': msg.version,
    'التاريخ': new Date(msg.createdAt).toISOString().slice(0, 16).replace('T', ' '),
    botcheck: false,
  };
  if (msg.device) body['الجهاز'] = msg.device;
  return body;
}

// Sends one message. Resolves true on success; throws Error('offline' | 'feedback-failed').
export async function send(msg, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(toPayload(msg)),
    });
  } catch { throw new Error('offline'); }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data || data.success !== true) throw new Error('feedback-failed');
  return true;
}

// Outbox: an array kept in IndexedDB by the caller (load/save injected, so this stays testable).
// Sends what it can, keeps the rest in order. Returns { sent, left }.
export async function flushOutbox({ load, save, sendImpl = send }) {
  const box = (await load()) || [];
  if (!box.length) return { sent: 0, left: 0 };
  const left = [];
  let sent = 0;
  let stop = false;
  for (const m of box) {
    if (stop) { left.push(m); continue; }
    try { await sendImpl(m); sent++; } catch (e) {
      if (e && e.message === 'offline') { left.push(m); stop = true; continue; } // no network: try later
      const tries = (m.tries || 0) + 1; // the server refused: give up after MAX_TRIES
      if (tries < MAX_TRIES) left.push({ ...m, tries });
    }
  }
  await save(left.slice(-MAX_OUTBOX));
  return { sent, left: left.length };
}

export async function enqueue(msg, { load, save }) {
  const box = (await load()) || [];
  box.push(msg);
  await save(box.slice(-MAX_OUTBOX));
}
