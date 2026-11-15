// Record-level merge of two app states. Pure: inputs are deep-copied, never mutated.
// Rule: union by id; higher updatedAt wins; tie -> greater JSON.stringify (deterministic).

const copy = (x) => JSON.parse(JSON.stringify(x));
const KNOWN = new Set(['v', 'cats', 'months', 'tx', 'plans']);

// x comes from side a, y from side b. tieB: on equal updatedAt side b wins (same-device saves).
function pick(x, y, tieB = false) {
  const ux = x.updatedAt || 0, uy = y.updatedAt || 0;
  if (ux !== uy) return ux > uy ? x : y;
  if (tieB) return y;
  return JSON.stringify(x) >= JSON.stringify(y) ? x : y;
}

// keepOrderB: b's records in b's order, then a-only records in a's order (else sorted by id).
function mergeList(a, b, onSame, { tieB = false, keepOrderB = false } = {}) {
  const map = new Map();
  for (const r of (a || [])) {
    const prev = map.get(r.id);
    map.set(r.id, copy(prev ? pick(prev, r) : r));
  }
  for (const r of (b || [])) {
    const prev = map.get(r.id);
    if (!prev) { map.set(r.id, copy(r)); continue; }
    const win = copy(pick(prev, r, tieB));
    if (onSame) onSame(win, prev, r);
    map.set(r.id, win);
  }
  if (keepOrderB) {
    const ids = new Set((b || []).map((r) => r.id));
    return [...(b || []).map((r) => map.get(r.id)), ...[...map.values()].filter((r) => !ids.has(r.id))];
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

// Cross-device merge (sync, backup import): commutative, OR-merges plan `paid`.
// opts.orPaid=false: plain newest-wins for plans.
export function mergeStates(a, b, { orPaid: useOr = true, tieB = false, keepOrderB = false } = {}) {
  a = a || {}; b = b || {};
  const lo = { tieB, keepOrderB };
  const months = {};
  const ma = a.months || {}, mb = b.months || {};
  for (const k of new Set([...Object.keys(ma), ...Object.keys(mb)])) {
    months[k] = copy(ma[k] && mb[k] ? pick(ma[k], mb[k], tieB) : (ma[k] || mb[k]));
  }
  const cats = mergeList(a.cats, b.cats, null, lo);
  const tx = mergeList(a.tx, b.tx, null, lo);
  // A category deleted on one device while another spent in it: undelete it (updatedAt stays the
  // max) so that spending never vanishes from the summary.
  const used = new Set(tx.filter((x) => !x.deleted).map((x) => x.catId));
  for (const c of cats) if (c.deleted && used.has(c.id)) c.deleted = false;
  const out = {
    v: Math.max(a.v || 0, b.v || 0),
    cats,
    months,
    tx,
    plans: mergeList(a.plans, b.plans, useOr ? orPaid : null, lo),
  };
  // Top-level keys this version does not know (added by a newer app) are carried through, not
  // dropped: the side with the greater v wins; equal v -> b on a same-device save, else the
  // greater JSON (commutative); a key only one side has is kept.
  const va = a.v || 0, vb = b.v || 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (KNOWN.has(k)) continue;
    let val;
    if (!(k in b)) val = a[k];
    else if (!(k in a)) val = b[k];
    else if (va !== vb) val = va > vb ? a[k] : b[k];
    else if (tieB) val = b[k];
    else val = JSON.stringify(a[k]) >= JSON.stringify(b[k]) ? a[k] : b[k];
    if (val !== undefined) out[k] = copy(val);
  }
  return out;
}

// Same-device merge (two tabs, one IndexedDB): `stored` is an older or sibling version of `live`.
// No OR on `paid` (it would undo an un-mark), ties go to the live tab, and live's record order
// is kept so a save never reorders what the tab shows.
export function mergeForSave(stored, live) {
  return mergeStates(stored, live, { orPaid: false, tieB: true, keepOrderB: true });
}
