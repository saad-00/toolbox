// State model: categories and transactions. Amounts are integer halalas.
// Deletes are soft (deleted: true + updatedAt). Clock is overridable for tests.
let clock = Date.now;
export function setClock(fn) { clock = fn || Date.now; }
export function now() { return clock(); }

// Highest state format this app version understands (state.v).
export const STATE_VERSION = 1;

export function uid() { return crypto.randomUUID(); }

// The nine starter categories offered on first run (locale keys).
export const DEFAULT_CAT_KEYS = ['cat.housing', 'cat.bills', 'cat.mobileNet', 'cat.food', 'cat.transport',
  'cat.subscriptions', 'cat.emergency', 'cat.savings', 'cat.allowance'];

// Starter categories get a fixed id (= nameKey), a fixed order (position in DEFAULT_CAT_KEYS)
// and updatedAt 0, so the same starter created on two devices is one record when merged, and
// any real rename/delete made anywhere wins over an untouched starter.
export function createState(defaultCatKeys = []) {
  return {
    v: STATE_VERSION,
    cats: defaultCatKeys.map((nameKey, i) => {
      const k = DEFAULT_CAT_KEYS.indexOf(nameKey);
      return { id: nameKey, name: null, nameKey, order: k >= 0 ? k + 1 : i + 1, deleted: false, updatedAt: 0 };
    }),
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
