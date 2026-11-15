// Shape check for a state that comes from outside this device's own saves (backup import,
// remote pull). Pure. Returns true only when every record (soft-deleted ones too) is well formed,
// so a malformed file can never break the Expenses screens.
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const isId = (x) => typeof x === 'string' && x.length > 0;
const nonNeg = (x) => Number.isSafeInteger(x) && x >= 0;
const pos = (x) => Number.isSafeInteger(x) && x > 0;
const stamp = (x) => x === undefined || (typeof x === 'number' && Number.isFinite(x) && x >= 0);
const optStr = (x) => x === undefined || x === null || typeof x === 'string';
const optBool = (x) => x === undefined || typeof x === 'boolean';
const base = (r) => isObj(r) && isId(r.id) && stamp(r.updatedAt) && optBool(r.deleted);

function validCat(c) {
  return base(c) && optStr(c.name) && optStr(c.nameKey)
    && (typeof c.name === 'string' || typeof c.nameKey === 'string')
    && (c.order === undefined || Number.isFinite(c.order));
}

function validMonth(key, m) {
  return MONTH_RE.test(key) && isObj(m) && nonNeg(m.income) && stamp(m.updatedAt)
    && isObj(m.budget) && Object.values(m.budget).every(nonNeg);
}

function validTx(x) {
  return base(x) && isId(x.catId) && pos(x.amount)
    && typeof x.date === 'string' && DATE_RE.test(x.date)
    && typeof x.month === 'string' && MONTH_RE.test(x.month)
    && optStr(x.note);
}

function validPlan(p) {
  return base(p) && Number.isInteger(p.n) && p.n >= 1 && p.n <= 48
    && Array.isArray(p.paid) && p.paid.length === p.n && p.paid.every((v) => typeof v === 'boolean')
    && pos(p.total) && typeof p.start === 'string' && DATE_RE.test(p.start)
    && typeof p.provider === 'string' && typeof p.item === 'string';
}

export function validState(s) {
  if (!isObj(s) || !Array.isArray(s.cats) || !Array.isArray(s.tx) || !Array.isArray(s.plans) || !isObj(s.months)) return false;
  if (s.v !== undefined && !pos(s.v)) return false;
  return s.cats.every(validCat)
    && Object.entries(s.months).every(([k, m]) => validMonth(k, m))
    && s.tx.every(validTx)
    && s.plans.every(validPlan);
}
