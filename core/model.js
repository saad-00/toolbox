// State model: categories and transactions. Amounts are integer halalas.
// Deletes are soft (deleted: true + updatedAt). Clock is overridable for tests.
let clock = Date.now;
export function setClock(fn) { clock = fn || Date.now; }
export function now() { return clock(); }

export function uid() { return crypto.randomUUID(); }

export function createState(defaultCatKeys = []) {
  const t = now();
  return {
    v: 1,
    cats: defaultCatKeys.map((nameKey, i) => ({
      id: uid(), name: null, nameKey, order: i + 1, deleted: false, updatedAt: t,
    })),
    months: {},
    tx: [],
    plans: [],
  };
}

export function getCategory(state, catId) {
  return state.cats.find((c) => c.id === catId);
}

export function liveCats(state) {
  return state.cats.filter((c) => !c.deleted).sort((a, b) => a.order - b.order);
}

function cleanName(name) {
  const n = String(name ?? '').trim();
  if (!n) throw new Error('invalid-name');
  return n;
}

export function addCategory(state, name) {
  const n = cleanName(name);
  const id = uid();
  const order = state.cats.reduce((m, c) => Math.max(m, c.order), 0) + 1;
  state.cats.push({ id, name: n, nameKey: null, order, deleted: false, updatedAt: now() });
  return id;
}

export function renameCategory(state, catId, name) {
  const n = cleanName(name);
  const c = getCategory(state, catId);
  if (!c) throw new Error('category-not-found');
  c.name = n;
  c.nameKey = null;
  c.updatedAt = now();
}

export function deleteCategory(state, catId) {
  const c = getCategory(state, catId);
  if (!c) throw new Error('category-not-found');
  if (state.tx.some((x) => x.catId === catId && !x.deleted)) throw new Error('category-has-tx');
  c.deleted = true;
  c.updatedAt = now();
}

export function catLabel(cat, t) {
  return cat.name ?? t(cat.nameKey);
}

export function addTx(state, { catId, amount, date, note }) {
  const cat = getCategory(state, catId);
  if (!cat || cat.deleted || !Number.isSafeInteger(amount) || amount <= 0
    || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid-tx');
  const id = uid();
  state.tx.push({
    id, month: date.slice(0, 7), catId, amount, date, note: note ?? '', deleted: false, updatedAt: now(),
  });
  return id;
}

export function deleteTx(state, txId) {
  const x = state.tx.find((t) => t.id === txId);
  if (!x) throw new Error('tx-not-found');
  x.deleted = true;
  x.updatedAt = now();
}
