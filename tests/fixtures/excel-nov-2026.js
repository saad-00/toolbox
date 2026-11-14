// Fixture mirroring the last block of the user's Excel sheet (Nov 2026).
// Built only through public APIs; returns a FRESH state each call.
import { createState, addCategory, addTx } from '../../core/model.js';
import { setIncome, setBudget } from '../../core/months.js';
import { addPlan } from '../../tools/expenses/installments.js';

export function fixture() {
  const s = createState([]);
  const month = '2026-11';
  setIncome(s, month, 656019);
  const budgets = [
    ['فلوس البيت', 100000], ['نت الجوال', 17175], ['youtube premium', 5000],
    ['PC Game Pass', 4100], ['مصروف', 100000], ['قرض', 20000],
  ];
  const ids = {};
  for (const [name, budget] of budgets) {
    ids[name] = addCategory(s, name);
    setBudget(s, month, ids[name], budget);
  }
  const txs = [['فلوس البيت', 100000], ['نت الجوال', 17175], ['youtube premium', 5000],
    ['PC Game Pass', 4100], ['مصروف', 100000]];
  for (const [name, amount] of txs) addTx(s, { catId: ids[name], amount, date: '2026-11-05', note: '' });
  addPlan(s, { provider: 'تمارا', item: 'قسط تمارا', total: 414476, n: 4, start: '2026-11-03', firstPaid: true });
  addPlan(s, { provider: 'تابي', item: 'قسط PC', total: 612400, n: 4, start: '2026-11-13', firstPaid: true });
  return s;
}
