// Installment plans (Tabby/Tamara style). Amounts are integer halalas.
import { uid, now } from '../../core/model.js';
import { addMonth, monthOf, periodOf, monthStartOf, daysBetween } from '../../core/months.js';

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

// Date of payment k: the start date's day, k calendar months later (clamped to short months).
export function paymentDate(plan, k) {
  const m = addMonth(monthOf(plan.start), k);
  const last = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
  return `${m}-${String(Math.min(Number(plan.start.slice(8, 10)), last)).padStart(2, '0')}`;
}

// Payments by month period (start = the state's month start day; 1 = calendar months).
export function schedule(plan, start = 1) {
  return Array.from({ length: plan.n }, (_, k) => {
    const date = paymentDate(plan, k);
    return { k, date, month: periodOf(date, start), amount: paymentAmount(plan, k), paid: !!plan.paid[k] };
  });
}

export function dueIn(state, month) {
  const out = [];
  const start = monthStartOf(state);
  for (const plan of state.plans) {
    if (plan.deleted) continue;
    for (const row of schedule(plan, start)) {
      if (row.month === month) out.push({ plan, k: row.k, amount: row.amount, paid: row.paid, date: row.date });
    }
  }
  return out;
}

// The next unpaid payment due today or later, with days until it is due. null when none.
// Unpaid payments before today are not «next»: see overduePayments.
export function nextPayment(state, today) {
  return upcomingPayments(state, today, 1)[0] || null;
}

// Unpaid payments dated before today (e.g. a plan added after it started, its past payments never ticked).
export function overduePayments(state, today) {
  const out = [];
  for (const plan of state.plans) {
    if (plan.deleted) continue;
    for (let k = 0; k < plan.n; k++) {
      const date = paymentDate(plan, k);
      if (!plan.paid[k] && date < today) out.push({ plan, k, date });
    }
  }
  return out;
}

// Ticks every overdue payment as paid; returns which ones (plan id + k), so the change can be undone.
export function markPaidBefore(state, today) {
  const done = overduePayments(state, today).map(({ plan, k }) => ({ id: plan.id, k }));
  for (const { id, k } of done) setPaid(state, id, k, true);
  return done;
}

// Unpaid payments due from today on (soonest first), for the home summary.
export function upcomingPayments(state, today, limit = 2) {
  const out = [];
  for (const plan of state.plans) {
    if (plan.deleted) continue;
    for (let k = 0; k < plan.n; k++) {
      if (plan.paid[k]) continue;
      const date = paymentDate(plan, k);
      if (date >= today) out.push({ plan, k, date, amount: paymentAmount(plan, k), inDays: daysBetween(today, date) });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, limit);
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
