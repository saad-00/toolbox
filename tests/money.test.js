import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatAmount } from '../core/money.js';

test('parses latin and arabic digits', () => {
  assert.equal(parseAmount('1500'), 150000);
  assert.equal(parseAmount('1,500.5'), 150050);
  assert.equal(parseAmount('١٬٥٠٠٫٥'), 150050);
  assert.equal(parseAmount(' 171.75 '), 17175);
});
test('rejects empty, zero, negative, text', () => {
  for (const v of ['', '0', '-5', 'abc', '1.234']) assert.throws(() => parseAmount(v), /invalid-amount/);
});
test('formats', () => {
  assert.equal(formatAmount(173025, 'ar'), '1,730.25');
  assert.equal(formatAmount(100000, 'en'), '1,000');
});
test('formats negatives', () => {
  assert.equal(formatAmount(-10000, 'ar'), '-100');
});
