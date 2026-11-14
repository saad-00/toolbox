// Installment plans (Tabby/Tamara style). Amounts are integer halalas.
import { uid, now } from '../../core/model.js';
import { addMonth, monthOf } from '../../core/months.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function addPlan(state, { provider, item, total, n, start, firstPaid }) {
  const prov = typeof provider === 'string' ? provider.trim() : '';
  const it = typeof item === 'string' ? item.trim() : '';
  if (!prov || !it) throw new Error('invalid-plan');
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('invalid-plan');
  if (!Number.isInteger(n) || n < 1 || n > 48) throw new Error('invalid-months');
  if (typeof start !== 'string' || !DATE_RE.test(start)) throw new Error('invalid-plan');
  const paid = Array(n).fill(false);
  paid[0] = !!firstPaid;
  const id = uid();
  state.plans.push({ id, provider: prov, item: it, total, n, start, paid, deleted: false, updatedAt: now() });
  return id;
}

export function paymentAmount(plan, k) {
  const base = Math.floor(plan.total / plan.n);
  return k === plan.n - 1 ? plan.total - base * (plan.n - 1) : base;
}

export function schedule(plan) {
  const first = monthOf(plan.start);
  return Array.from({ length: plan.n }, (_, k) => ({
    k, month: addMonth(first, k), amount: paymentAmount(plan, k), paid: !!plan.paid[k],
  }));
}

export function dueIn(state, month) {
  const out = [];
  for (const plan of state.plans) {
    if (plan.deleted) continue;
    for (const row of schedule(plan)) {
      if (row.month === month) out.push({ plan, k: row.k, amount: row.amount, paid: row.paid });
    }
  }
  return out;
}

function findPlan(state, planId) {
  const plan = state.plans.find(p => p.id === planId);
  if (!plan) throw new Error('plan-not-found');
  return plan;
}

export function setPaid(state, planId, k, paid) {
  const plan = findPlan(state, planId);
  if (!Number.isInteger(k) || k < 0 || k >= plan.n) throw new Error('invalid-payment');
  plan.paid[k] = !!paid;
  plan.updatedAt = now();
  return plan;
}

export function deletePlan(state, planId) {
  const plan = findPlan(state, planId);
  plan.deleted = true;
  plan.updatedAt = now();
  return plan;
}

export function remaining(plan) {
  let sum = 0;
  for (let k = 0; k < plan.n; k++) if (!plan.paid[k]) sum += paymentAmount(plan, k);
  return sum;
}
