import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validState } from '../core/validate.js';
import { createState, DEFAULT_CAT_KEYS } from '../core/model.js';
import { fixture } from './fixtures/excel-nov-2026.js';

const good = () => JSON.parse(JSON.stringify(fixture()));

test('real states are valid', () => {
  assert.equal(validState(good()), true);
  assert.equal(validState(createState(DEFAULT_CAT_KEYS)), true);
  assert.equal(validState(createState([])), true);
});

test('shape errors are refused', () => {
  for (const bad of [null, 1, 'x', [], {}, { cats: [], tx: [], plans: [] },
    { cats: {}, tx: [], plans: [], months: {} }, { cats: [], tx: [], plans: [], months: [] }]) {
    assert.equal(validState(bad), false, JSON.stringify(bad));
  }
});

const cases = {
  'month key 2026-13': (s) => { s.months['2026-13'] = { income: 0, budget: {}, updatedAt: 0 }; },
  'month key 2026-1': (s) => { s.months['2026-1'] = { income: 0, budget: {}, updatedAt: 0 }; },
  'negative income': (s) => { s.months['2026-11'].income = -1; },
  'fractional income': (s) => { s.months['2026-11'].income = 1.5; },
  'string income': (s) => { s.months['2026-11'].income = '5'; },
  'budget not an object': (s) => { s.months['2026-11'].budget = [1]; },
  'negative budget': (s) => { const k = Object.keys(s.months['2026-11'].budget)[0]; s.months['2026-11'].budget[k] = -5; },
  'fractional budget': (s) => { const k = Object.keys(s.months['2026-11'].budget)[0]; s.months['2026-11'].budget[k] = 0.5; },
  'tx amount zero': (s) => { s.tx[0].amount = 0; },
  'tx amount fractional': (s) => { s.tx[0].amount = 10.5; },
  'tx amount unsafe': (s) => { s.tx[0].amount = Number.MAX_SAFE_INTEGER + 2; },
  'tx date 2026-1-1': (s) => { s.tx[0].date = '2026-1-1'; },
  'tx date missing': (s) => { delete s.tx[0].date; },
  'tx month bad': (s) => { s.tx[0].month = '2026-00'; },
  'tx without id': (s) => { delete s.tx[0].id; },
  'tx not an object': (s) => { s.tx[0] = 5; },
  'cat without id': (s) => { delete s.cats[0].id; },
  'cat without any name': (s) => { s.cats[0].name = null; s.cats[0].nameKey = null; },
  'plan n 0': (s) => { s.plans[0].n = 0; s.plans[0].paid = []; },
  'plan n 49': (s) => { s.plans[0].n = 49; s.plans[0].paid = Array(49).fill(false); },
  'plan n fractional': (s) => { s.plans[0].n = 2.5; },
  'plan paid wrong length': (s) => { s.plans[0].paid = [true]; },
  'plan paid not an array': (s) => { s.plans[0].paid = 'yes'; },
  'plan total negative': (s) => { s.plans[0].total = -100; },
  'plan start bad': (s) => { s.plans[0].start = 'soon'; },
  'updatedAt not a number': (s) => { s.tx[0].updatedAt = 'x'; },
};
for (const [name, fn] of Object.entries(cases)) {
  test(`refused: ${name}`, () => { const s = good(); fn(s); assert.equal(validState(s), false); });
}

test('soft-deleted records are still checked; zero income/budget allowed', () => {
  const s = good(); s.tx[0].deleted = true; s.tx[0].amount = -1;
  assert.equal(validState(s), false);
  const z = good(); z.months['2026-11'].income = 0;
  assert.equal(validState(z), true);
});
