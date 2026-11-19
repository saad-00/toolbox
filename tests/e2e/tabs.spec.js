import { test, expect } from '@playwright/test';

// Two tabs of the app open on the same device (same IndexedDB).
const NOW = new Date('2026-11-15T10:00:00');
const stubChannel = () => {
  // A tab that never hears the other tab's «saved» ping (worst case: it stays stale).
  window.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} removeEventListener() {} };
};

async function open(context, { deaf = false } = {}) {
  const page = await context.newPage();
  if (deaf) await page.addInitScript(stubChannel);
  await page.clock.setFixedTime(NOW);
  await page.goto('./#expenses');
  await expect(page.locator('#exLeft')).toContainText('1,730.25');
  return page;
}

async function seedContext(context) {
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  await page.goto('./');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(async () => {
    const store = await import('./core/store.js');
    const f = await import('./tests/fixtures/excel-nov-2026.js');
    await store.saveState(f.fixture());
    await store.saveSettings({ lang: 'ar', onboarded: true });
  });
  await page.close();
}

async function log(page, amount) {
  await page.locator('#exLog').click();
  const sheet = page.locator('#logSheet');
  await expect(sheet).toHaveClass(/\bon\b/);
  await page.locator('#logAmt').fill(amount);
  await sheet.locator('.chips button', { hasText: /^مصروف$/ }).click();
  await sheet.locator('button[type=submit]').click();
  await expect(sheet).not.toHaveClass(/\bon\b/);
}

const todays = (page) => page.evaluate(async () => {
  const s = await (await import('./core/store.js')).loadState();
  return s.tx.filter((x) => !x.deleted && x.date === '2026-11-15').map((x) => x.amount).sort((a, b) => a - b);
});

test('a stale tab saving does not erase what another tab saved', async ({ context }) => {
  await seedContext(context);
  const a = await open(context, { deaf: true });
  const b = await open(context, { deaf: true });
  await log(a, '50');
  await expect(a.locator('#exLeft')).toContainText('1,680.25');
  await log(b, '20'); // b never saw a's entry
  expect(await todays(a)).toEqual([2000, 5000]);
  // b adopts the merged state at once
  await expect(b.locator('#exLeft')).toContainText('1,660.25');
  await a.reload();
  await expect(a.locator('#exLeft')).toContainText('1,660.25');
});

test('a save in one tab refreshes the other tab', async ({ context }) => {
  await seedContext(context);
  const a = await open(context);
  const b = await open(context);
  await log(a, '50');
  await expect(b.locator('#exLeft')).toContainText('1,680.25');
  await expect(b.locator('#exTxs')).toContainText('50');
});
