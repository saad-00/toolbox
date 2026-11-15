import { test, expect } from '@playwright/test';

test('works offline after first load: hub renders and spending can be logged', async ({ page, context }) => {
  await page.clock.setFixedTime(new Date('2026-11-15T10:00:00'));
  await page.goto('./');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const store = await import('./core/store.js');
    const f = await import('./tests/fixtures/excel-nov-2026.js');
    await store.saveState(f.fixture());
    await store.saveSettings({ lang: 'ar', onboarded: true });
  });
  await page.reload(); // now controlled by the service worker
  await expect(page.locator('#view-home')).toBeVisible();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  // let any in-flight cache writes settle
  await page.evaluate(async () => (await caches.keys()).length);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#view-home')).toBeVisible();

  await page.evaluate(() => { location.hash = '#expenses'; });
  await expect(page.locator('#view-expenses')).toBeVisible();
  await expect(page.locator('#exLeft')).toContainText('1,730.25');
  await page.locator('#fab').click();
  const sheet = page.locator('#logSheet');
  await expect(sheet).toHaveClass(/\bon\b/);
  await page.locator('#logAmt').fill('50');
  await sheet.locator('.chips button', { hasText: /^مصروف$/ }).click();
  await sheet.locator('button[type=submit]').click();
  await expect(page.locator('#exLeft')).toContainText('1,680.25');
  await expect(page.locator('#toast')).toHaveText('أُضيف 50 ر.س إلى تم الصرف · مصروف');
});
