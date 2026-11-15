import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncScheduler } from '../core/autosync.js';

// Manual timers: fire() runs every pending callback.
function fakeTimers() {
  const q = new Map();
  let id = 0;
  return {
    setTimer: (fn, ms) => { q.set(++id, { fn, ms }); return id; },
    clearTimer: (i) => { q.delete(i); },
    pending: () => [...q.values()].map((x) => x.ms),
    fire: () => { const all = [...q.values()]; q.clear(); all.forEach((x) => x.fn()); },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
function deferred() { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; }

test('schedule debounces: many saves, one run after the delay', async () => {
  const tm = fakeTimers();
  let runs = 0;
  const s = createSyncScheduler({ run: async () => { runs++; }, delay: 5000, ...tm });
  s.schedule(); s.schedule(); s.schedule();
  assert.deepEqual(tm.pending(), [5000]);
  assert.equal(runs, 0);
  tm.fire();
  await tick();
  assert.equal(runs, 1);
});

test('never two runs at once: runNow while busy shares the run and reruns once after', async () => {
  const tm = fakeTimers();
  let runs = 0;
  let active = 0;
  let maxActive = 0;
  const gates = [];
  const s = createSyncScheduler({
    run: async () => { runs++; active++; maxActive = Math.max(maxActive, active); const d = deferred(); gates.push(d); await d.p; active--; return runs; },
    delay: 5000, ...tm,
  });
  const a = s.runNow();
  await tick();
  assert.equal(s.busy, true);
  const b = s.runNow();
  assert.equal(a, b);
  s.schedule();
  tm.fire(); // timer fires while busy -> no second concurrent run
  await tick();
  assert.equal(runs, 1);
  gates[0].resolve();
  assert.equal(await a, 1);
  assert.equal(s.busy, false);
  assert.deepEqual(tm.pending(), [5000]); // a follow-up run is scheduled for changes made meanwhile
  tm.fire();
  await tick();
  assert.equal(runs, 2);
  gates[1].resolve();
  await tick();
  assert.equal(maxActive, 1);
});

test('a failed run rejects runNow and does not stay busy', async () => {
  const tm = fakeTimers();
  let n = 0;
  const s = createSyncScheduler({ run: async () => { n++; if (n === 1) throw new Error('offline'); return 'ok'; }, ...tm });
  await assert.rejects(s.runNow(), /offline/);
  assert.equal(s.busy, false);
  assert.equal(await s.runNow(), 'ok');
});

test('a synchronous throw in run is handled like a rejection', async () => {
  const s = createSyncScheduler({ run: () => { throw new Error('boom'); }, ...fakeTimers() });
  await assert.rejects(s.runNow(), /boom/);
  assert.equal(s.busy, false);
});

test('timer-fired failures are swallowed (no unhandled rejection)', async () => {
  const tm = fakeTimers();
  let n = 0;
  const s = createSyncScheduler({ run: async () => { n++; throw new Error('x'); }, ...tm });
  s.schedule();
  tm.fire();
  await tick();
  assert.equal(n, 1);
});

test('runNow cancels a pending debounce; cancel drops it', async () => {
  const tm = fakeTimers();
  let runs = 0;
  const s = createSyncScheduler({ run: async () => { runs++; }, ...tm });
  s.schedule();
  await s.runNow();
  assert.deepEqual(tm.pending(), []);
  s.schedule();
  s.cancel();
  assert.deepEqual(tm.pending(), []);
  assert.equal(runs, 1);
});
