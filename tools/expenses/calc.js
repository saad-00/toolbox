// Monthly summary matching the Excel sheet. All values are integer halalas.
// Pure: never mutates state (a missing month reads as income 0 / empty budget).
import { liveCats } from '../../core/model.js';
import { dueIn } from './installments.js';

export function monthSummary(state, month) {
  const rec = state.months[month];
  const income = rec ? rec.income : 0;
  const budgets = rec ? rec.budget : {};
  const live = state.tx.filter((x) => !x.deleted && x.month === month);

  const rows = liveCats(state).map((c) => {
    const spent = live.reduce((a, x) => (x.catId === c.id ? a + x.amount : a), 0);
    const budget = budgets[c.id] || 0;
    return { catId: c.id, spent, budget, left: budget - spent };
  });

  const byProvider = new Map();
  let duePaid = 0; let dueAll = 0;
  for (const d of dueIn(state, month)) {
    dueAll += d.amount;
    if (d.paid) duePaid += d.amount;
    const p = byProvider.get(d.plan.provider) || { provider: d.plan.provider, due: 0, paid: 0 };
    p.due += d.amount;
    if (d.paid) p.paid += d.amount;
    byProvider.set(d.plan.provider, p);
  }

  const spent = rows.reduce((a, r) => a + r.spent, 0) + duePaid;
  const budgetTotal = rows.reduce((a, r) => a + r.budget, 0) + dueAll;
  return {
    income, spent, budgetTotal,
    remainingNow: income - spent,
    remainingActual: income - budgetTotal,
    rows, providers: [...byProvider.values()],
  };
}
