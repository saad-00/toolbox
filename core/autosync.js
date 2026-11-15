// Sync scheduler. Pure (timers are injectable for tests).
// schedule(): debounced run `delay` ms after the last call. runNow(): run immediately.
// Never two runs at once: a call while a run is in progress shares that run and queues one
// debounced follow-up, so changes made during a run are still uploaded afterwards.
export function createSyncScheduler({ run, delay = 5000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let inflight = null;
  let again = false;

  function clear() {
    if (timer != null) clearTimer(timer);
    timer = null;
  }

  function schedule() {
    clear();
    timer = setTimer(() => { timer = null; runNow().catch(() => {}); }, delay);
  }

  function runNow() {
    clear();
    if (inflight) { again = true; return inflight; }
    // Promise.resolve().then(run): a synchronous throw becomes a rejection, and the finally
    // handler always runs after `inflight` is assigned.
    inflight = Promise.resolve().then(run).finally(() => {
      inflight = null;
      if (again) { again = false; schedule(); }
    });
    return inflight;
  }

  function cancel() { clear(); again = false; }

  return { schedule, runNow, cancel, get busy() { return inflight != null; } };
}
