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
test('rejects malformed comma grouping and unsafe values', () => {
  for (const v of ['1,50', '1,5', ',,1', '1,2,3', '12345678901234567890']) assert.throws(() => parseAmount(v), /invalid-amount/);
  assert.equal(parseAmount('1,234,567.89'), 123456789);
});
test('formats', () => {
  assert.equal(formatAmount(173025, 'ar'), '1,730.25');
  assert.equal(formatAmount(100000, 'en'), '1,000');
  assert.equal(formatAmount(153020, 'ar'), '1,530.20');
  assert.equal(formatAmount(17175, 'en'), '171.75');
  assert.equal(formatAmount(5, 'en'), '0.05');
  assert.equal(formatAmount(-15050, 'en'), '\u2066-150.50\u2069');
});
test('formats negatives', () => {
  assert.equal(formatAmount(-10000, 'ar'), '\u2066-100\u2069'); // isolated: see below
});

test('a negative amount is isolated left-to-right, so the minus stays in front inside Arabic text', () => {
  assert.equal(formatAmount(-918490, 'ar'), '⁦-9,184.90⁩');
  assert.equal(formatAmount(-100000, 'en'), '⁦-1,000⁩');
  assert.equal(formatAmount(0, 'ar'), '0'); // zero and positives are unchanged
});
