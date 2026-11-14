// Record-level merge of two app states. Pure: inputs are deep-copied, never mutated.
// Rule: union by id; higher updatedAt wins; tie -> greater JSON.stringify (deterministic).

const copy = (x) => JSON.parse(JSON.stringify(x));

function pick(x, y) {
  const ux = x.updatedAt || 0, uy = y.updatedAt || 0;
  if (ux !== uy) return ux > uy ? x : y;
  return JSON.stringify(x) >= JSON.stringify(y) ? x : y;
}

function mergeList(a, b, onSame) {
  const map = new Map();
  for (const r of [...(a || []), ...(b || [])]) {
    const prev = map.get(r.id);
    if (!prev) { map.set(r.id, copy(r)); continue; }
    const win = copy(pick(prev, r));
    if (onSame) onSame(win, prev, r);
    map.set(r.id, win);
  }
  return [...map.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

// Plans: when both sides share the id and n, `paid` is the element-wise OR so
// payments marked on two devices both survive. Trade-off: un-marking a payment
// can be undone by a concurrent mark on another device.
function orPaid(win, x, y) {
  if (x.n === y.n && Array.isArray(x.paid) && Array.isArray(y.paid)) {
    win.paid = x.paid.map((v, i) => !!(v || y.paid[i]));
  }
}

export function mergeStates(a, b) {
  a = a || {}; b = b || {};
  const months = {};
  const ma = a.months || {}, mb = b.months || {};
  for (const k of new Set([...Object.keys(ma), ...Object.keys(mb)])) {
    months[k] = copy(ma[k] && mb[k] ? pick(ma[k], mb[k]) : (ma[k] || mb[k]));
  }
  return {
    v: Math.max(a.v || 0, b.v || 0),
    cats: mergeList(a.cats, b.cats),
    months,
    tx: mergeList(a.tx, b.tx),
    plans: mergeList(a.plans, b.plans, orPaid),
  };
}
