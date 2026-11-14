// Backup export/import. Pure. Import always merges into the current state, never replaces it.
import { mergeStates } from './merge.js';

const pad = (n) => String(n).padStart(2, '0');

export function exportBackup(state, date = new Date()) {
  const filename = `toolbox-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
  const json = JSON.stringify({ kind: 'toolbox-backup', v: 1, exportedAt: date.toISOString(), state });
  return { filename, json };
}

export function importBackup(current, json) {
  let b;
  try { b = JSON.parse(json); } catch { throw new Error('bad-backup'); }
  const s = b && b.state;
  const ok = b && typeof b === 'object' && b.kind === 'toolbox-backup' && b.v === 1
    && s && typeof s === 'object'
    && Array.isArray(s.cats) && Array.isArray(s.tx) && Array.isArray(s.plans)
    && s.months && typeof s.months === 'object' && !Array.isArray(s.months);
  if (!ok) throw new Error('bad-backup');
  return mergeStates(current, s);
}

export function needsBackupReminder(lastBackupAt, now) {
  if (lastBackupAt == null) return true;
  return now - lastBackupAt > 30 * 864e5;
}
