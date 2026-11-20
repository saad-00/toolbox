import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectLang, setLang, getLang, t, dir, monthName, loadLocales } from '../core/i18n.js';

const load = (n) => JSON.parse(readFileSync(new URL(`../core/locales/${n}.json`, import.meta.url), 'utf8'));
const ar = load('ar');
const en = load('en');
loadLocales(ar, en);

test('device language decides', () => {
  assert.equal(detectLang(['ar-SA', 'en']), 'ar');
  assert.equal(detectLang(['en-GB']), 'en');
  assert.equal(detectLang(['fr-FR', 'ar']), 'en');
  assert.equal(detectLang([]), 'en');
});
test('direction', () => { assert.equal(dir('ar'), 'rtl'); assert.equal(dir('en'), 'ltr'); });
test('month names', () => {
  assert.equal(monthName('2026-11', 'ar'), 'نوفمبر 2026');
  assert.equal(monthName('2026-11', 'en'), 'November 2026');
});
test('both locales have the same keys', () => {
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
});
test('interpolation', () => {
  setLang('ar');
  assert.equal(getLang(), 'ar');
  assert.equal(t('toast.logged', { amount: '50', cat: 'مصروف' }), 'سُجّل 50 ر.س · مصروف');
  setLang('en');
  assert.equal(t('toast.logged', { amount: '50', cat: 'Food' }), 'Logged SAR 50 · Food');
});
test('missing key returns the key', () => {
  assert.equal(t('no.such.key'), 'no.such.key');
});
test('required keys exist with exact values', () => {
  assert.equal(ar['app.name'], 'أدواتي');
  assert.equal(en['sheet.log.title'], 'Log spending');
  assert.equal(ar['sheet.plan.title'], 'أضف قسط');
  assert.equal(ar['cat.allowance'], 'المصروف');
  assert.equal(en['currency'], 'SAR');
});
