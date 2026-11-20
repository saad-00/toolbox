// Fixed monthly expenses («مصاريف ثابتة»): rent, subscriptions… logged automatically each month on
// their day. state.fixed = [{ id, catId, amount, day (1–28), note, active, since, deleted, updatedAt }].
// Pure apart from the clock. A generated transaction has the id `fx-<fixed id>-<month>`, so two
// devices that generate the same one merge into a single record, and one the user deleted stays deleted.
import { uid, now, getCategory } from '../../core/model.js';
import { periodOf, monthStartOf, dateInPeriod, addMonth, ensureMonth } from '../../core/months.js';

const list = (state) => (state.fixed || (state.fixed = []));

function check({ catId, amount, day }, state) {
  const cat = getCategory(state, catId);
  if (!cat || cat.deleted) throw new Error('invalid-tx');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('invalid-amount');
  if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error('invalid-day');
}

// The first month whose occurrence is today or later: nothing before the item existed is back-filled.
function firstMonth(state, day, today) {
  const s = monthStartOf(state);
  const m = periodOf(today, s);
  return dateInPeriod(m, day, s) >= today ? m : addMonth(m, 1);
}

export function addFixed(state, { catId, amount, day, note = '' }, today) {
  check({ catId, amount, day }, state);
  const id = uid();
  list(state).push({ id, catId, amount, day, note: String(note).trim(), active: true, since: firstMonth(state, day, today), deleted: false, updatedAt: now() });
  return id;
}

export function setFixedActive(state, id, active, today) {
  const f = list(state).find((x) => x.id === id);
  if (!f) throw new Error('not-found');
  f.active = !!active;
  // Switching back on never back-fills the months it was off.
  if (f.active) f.since = firstMonth(state, f.day, today);
  f.updatedAt = now();
  return f;
}

export function deleteFixed(state, id) {
  const f = list(state).find((x) => x.id === id);
  if (!f) throw new Error('not-found');
  f.deleted = true;
  f.updatedAt = now();
  return f;
}

export const liveFixed = (state) => (state.fixed || []).filter((f) => !f.deleted).sort((a, b) => a.day - b.day || (a.id < b.id ? -1 : 1));

// Logs every due occurrence (date <= today) that has no transaction yet. Returns how many were added.
export function applyFixed(state, today) {
  const s = monthStartOf(state);
  const until = periodOf(today, s);
  let added = 0;
  for (const f of liveFixed(state)) {
    if (!f.active) continue;
    const cat = getCategory(state, f.catId);
    if (!cat || cat.deleted) continue;
    for (let m = f.since; m <= until; m = addMonth(m, 1)) {
      const date = dateInPeriod(m, f.day, s);
      if (date > today) break;
      const id = `fx-${f.id}-${m}`;
      if (state.tx.some((x) => x.id === id)) continue;
      ensureMonth(state, m);
      state.tx.push({ id, month: m, catId: f.catId, amount: f.amount, date, note: f.note || '', fixed: f.id, deleted: false, updatedAt: now() });
      added++;
    }
  }
  return added;
}
