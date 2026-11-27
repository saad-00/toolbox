import { test, expect } from '@playwright/test';

// A fresh device opens the first-run welcome; mark it onboarded (no saved state) and reload.
async function ready(page, url = './') {
  await page.goto('./');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(async () => (await import('./core/store.js')).saveSettings({ onboarded: true }));
  if (url !== './') await page.goto(url);
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
}

test.describe('Arabic device', () => {
  test.use({ locale: 'ar-SA' });
  test('rtl, Arabic title and nav', async ({ page }) => {
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('#view-home h1')).toHaveText('أدواتي');
    await expect(page.locator('#sideNav a[data-r=home]')).toHaveText('الرئيسية');
    await expect(page.locator('#sideNav a[data-r=expenses]')).toHaveText('المصاريف');
    await expect(page.locator('#bNav a[data-r=prefs]')).toHaveText('الإعدادات');
    await expect(page.locator('.tool[data-tool=expenses] b')).toHaveText('المصاريف');
    await expect(page.locator('.tool[data-tool=expenses] .quick')).toHaveText('سجّل صرف');
  });
});

test.describe('English device', () => {
  test.use({ locale: 'en-US' });
  test('ltr and Toolbox', async ({ page }) => {
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#view-home h1')).toHaveText('Toolbox');
    await expect(page.locator('#sideNav a[data-r=expenses]')).toHaveText('Expenses');
    await expect(page.locator('.tool[data-tool=expenses] .quick')).toHaveText('Log spending');
  });
});

test('graphite palette applied by default', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#view-home')).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  expect(bg).toBe('#14161b');
  await expect(page.locator('meta[name=theme-color]')).toHaveAttribute('content', '#14161b');
});

test('unknown hash shows home', async ({ page }) => {
  await ready(page, './#nowhere');
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('#sideNav a[data-r=home]')).toHaveClass(/\bon\b/);
});

test('routes to expenses and prefs; quick button opens expenses', async ({ page }) => {
  await ready(page, './#prefs');
  await expect(page.locator('#view-prefs')).toBeVisible();
  await expect(page.locator('#view-home')).toBeHidden();
  await page.goto('./#home');
  await page.locator('.tool[data-tool=expenses] .quick').click();
  await expect(page).toHaveURL(/#expenses$/);
  await expect(page.locator('#view-expenses')).toBeVisible();
});

test('toast and sheet (Escape and backdrop close)', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#view-home')).toBeVisible();
  await page.evaluate(async () => { const ui = await import('./core/ui.js'); ui.toast('hello'); });
  await expect(page.locator('#toast')).toHaveText('hello');
  await expect(page.locator('#toast')).toHaveClass(/\bon\b/);
  const open = () => page.evaluate(async () => {
    const ui = await import('./core/ui.js');
    const el = document.createElement('div'); el.className = 'sheet'; el.id = 'tsheet'; el.textContent = 'x';
    document.body.appendChild(el); ui.openSheet(el);
  });
  await open();
  await expect(page.locator('#tsheet')).toHaveClass(/\bon\b/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#tsheet')).not.toHaveClass(/\bon\b/);
  await page.evaluate(async () => { const ui = await import('./core/ui.js'); ui.openSheet(document.getElementById('tsheet')); });
  await page.locator('#sheetBg').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('#tsheet')).not.toHaveClass(/\bon\b/);
});

test('manifest and service worker', async ({ page, request }) => {
  const m = await request.get('manifest.webmanifest');
  expect(m.headers()['content-type']).toContain('manifest+json');
  const j = await m.json();
  expect(j.start_url).toBe('./');
  expect(j.scope).toBe('./');
  expect(j.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512']);
  for (const i of j.icons) expect((await request.get(i.src)).ok()).toBe(true);
  await page.goto('./');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe('http://127.0.0.1:4173/');
  const keys = await page.evaluate(async () => { await navigator.serviceWorker.ready; for (let i = 0; i < 50; i++) { const k = await caches.keys(); if (k.length) return k; await new Promise((r) => setTimeout(r, 100)); } return []; });
  expect(keys).toEqual(['toolbox-v15']);
});

test('content security policy is set and nothing violates it', async ({ page }) => {
  const violations = [];
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await ready(page);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain('connect-src \'self\' https://api.github.com');
  // walk the main screens and open a sheet
  await page.goto('./#expenses');
  await expect(page.locator('#exLeft')).toBeVisible();
  await page.locator('#exLog').click();
  await expect(page.locator('#logSheet')).toHaveClass(/\bon\b/);
  await page.goto('./#prefs');
  await expect(page.locator('#view-prefs')).toBeVisible();
  await expect(page.locator('#view-prefs')).not.toBeEmpty();
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.fonts.check('16px Alexandria'))).toBe(true);
});
