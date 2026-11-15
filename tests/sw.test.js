import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

// Runs sw.js in a fake service-worker global and fires 'install'.
async function install() {
  const handlers = {};
  const added = [];
  const opened = [];
  class Request { constructor(url, init = {}) { this.url = url; this.cache = init.cache ?? 'default'; } }
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    location: { origin: 'https://x.test' },
  };
  const caches = { open: async (name) => { opened.push(name); return { addAll: async (list) => { added.push(...list); } }; } };
  vm.runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), { self, caches, Request, URL, fetch() {} });
  let wait;
  handlers.install({ waitUntil: (p) => { wait = p; } });
  await wait;
  return { added, opened };
}

test('install precaches the shell bypassing the HTTP cache, under the new version', async () => {
  const { added, opened } = await install();
  assert.deepEqual(opened, ['toolbox-v8']);
  assert.ok(added.length > 10);
  for (const r of added) {
    assert.equal(typeof r, 'object', `plain URL precached: ${r}`);
    assert.equal(r.cache, 'reload', r.url);
  }
  assert.ok(added.some((r) => r.url === 'core/app.js'));
});

test('every core and expenses module is in the shell', async () => {
  const { added } = await install();
  const urls = new Set(added.map((r) => r.url));
  for (const dir of ['core', 'tools/expenses', 'onboarding']) {
    for (const f of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
      if (/\.(js|css)$/.test(f)) assert.ok(urls.has(`${dir}/${f}`), `${dir}/${f} missing from SHELL`);
    }
  }
});
