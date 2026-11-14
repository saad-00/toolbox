import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTES, isLight, applyPalette } from '../core/theme.js';
import { route } from '../core/router.js';

function fakeRoot() {
  const props = {};
  return { props, style: { colorScheme: '', setProperty: (k, v) => { props[k] = v; } } };
}

test('seven palettes, graphite first with exact values', () => {
  assert.equal(PALETTES.length, 7);
  assert.equal(PALETTES[0].id, 'graphite');
  assert.deepEqual(
    { bg: PALETTES[0].bg, b1: PALETTES[0].b1, b2: PALETTES[0].b2, b3: PALETTES[0].b3 },
    { bg: '#14161b', b1: '#556072', b2: '#7d8798', b3: '#2c3644' });
  assert.deepEqual(PALETTES.map((p) => p.id).sort(),
    ['emerald', 'graphite', 'ice', 'mint', 'riyadh', 'sand', 'wine']);
});

test('isLight by luminance', () => {
  assert.equal(isLight('#eef6fb'), true);
  assert.equal(isLight('#14161b'), false);
  assert.equal(isLight('#ffffff'), true);
  assert.equal(isLight('#000000'), false);
});

test('light presets are exactly ice, sand, mint', () => {
  assert.deepEqual(PALETTES.filter((p) => isLight(p.bg)).map((p) => p.id), ['ice', 'sand', 'mint']);
});

test('applyPalette dark sets tokens and solid-ink = bg', () => {
  const r = fakeRoot();
  assert.equal(applyPalette(r, 'graphite'), 'dark');
  assert.equal(r.props['--bg'], '#14161b');
  assert.equal(r.props['--b1'], '#556072');
  assert.equal(r.props['--ink'], '#fff');
  assert.equal(r.props['--solid-ink'], '#14161b');
  assert.equal(r.style.colorScheme, 'dark');
});

test('applyPalette light preset and custom object', () => {
  const r = fakeRoot();
  assert.equal(applyPalette(r, 'ice'), 'light');
  assert.equal(r.props['--ink'], '#1d2230');
  assert.equal(r.props['--solid-ink'], '#fff');
  assert.equal(r.style.colorScheme, 'light');
  const c = fakeRoot();
  assert.equal(applyPalette(c, { bg: '#101828', b1: '#ff7a59', b2: '#7c5cff', b3: '#00c2a8' }), 'dark');
  assert.equal(c.props['--b2'], '#7c5cff');
});

test('applyPalette unknown id falls back to graphite', () => {
  const r = fakeRoot();
  assert.equal(applyPalette(r, 'nope'), 'dark');
  assert.equal(r.props['--bg'], '#14161b');
});

test('route', () => {
  assert.equal(route(''), 'home');
  assert.equal(route('#home'), 'home');
  assert.equal(route('#expenses'), 'expenses');
  assert.equal(route('#prefs'), 'prefs');
  assert.equal(route('#zzz'), 'home');
  assert.equal(route(undefined), 'home');
});
