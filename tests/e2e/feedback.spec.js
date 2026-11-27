import { test, expect } from '@playwright/test';

async function seed(page, lang = 'ar') {
  await page.goto('./');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(async (lang) => {
    const store = await import('./core/store.js');
    await store.saveSettings({ lang, onboarded: true });
    location.hash = '#home';
  }, lang);
  await page.reload();
  await expect(page.locator('#fbOpen')).toBeVisible();
}

function mockApi(page, { ok = true } = {}) {
  const bodies = [];
  return page.route('https://api.web3forms.com/submit', async (route) => {
    bodies.push(JSON.parse(route.request().postData()));
    await route.fulfill({ status: ok ? 200 : 400, contentType: 'application/json', body: JSON.stringify({ success: ok }) });
  }).then(() => bodies);
}
const outbox = (page) => page.evaluate(async () => (await import('./core/store.js')).loadOutbox());

test('home entry opens «راسلنا»; a bug report is sent with device info and closes the sheet', async ({ page }) => {
  const bodies = await mockApi(page);
  await seed(page);
  await expect(page.locator('#fbOpen')).toContainText('عندك فكرة أو مشكلة؟');
  await page.locator('#fbOpen').click();
  const sheet = page.locator('#fbSheet');
  await expect(sheet).toHaveClass(/\bon\b/);
  await expect(page.locator('#fbSend')).toBeDisabled();
  await expect(page.locator('#fbMeta')).toBeHidden();
  await sheet.locator('[data-k=bug]').click();
  await expect(sheet.locator('[data-k=bug]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#fbMeta')).toBeVisible();
  await expect(page.locator('#fbMsg')).toHaveAttribute('placeholder', /وش صار/);
  await page.locator('#fbMsg').fill('لما أضغط سجّل ما يحفظ');
  await page.locator('#fbName').fill('سعد');
  await page.locator('#fbContact').fill('@saad');
  await page.locator('#fbSend').click();
  await expect(sheet).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#toast')).toContainText('وصلت رسالتك');
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ access_key: '268ee1a3-cec2-4742-9d3c-1a73867d1bfd', 'الرسالة': 'لما أضغط سجّل ما يحفظ', 'الاسم': 'سعد', 'للتواصل': '@saad', from_name: 'سعد', botcheck: false });
  expect(bodies[0].subject).toContain('عطل');
  expect(bodies[0]['الجهاز']).toBeTruthy();
  // reopened: fresh form, back to «طلب أداة», no device line
  await page.locator('#fbOpen').click();
  await expect(page.locator('#fbMsg')).toHaveValue('');
  await expect(sheet.locator('[data-k=tool]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#fbMeta')).toBeHidden();
});

test('a suggestion carries no device info and the name stays optional', async ({ page }) => {
  const bodies = await mockApi(page);
  await seed(page);
  await page.locator('#fbOpen').click();
  await page.locator('#fbSheet [data-k=idea]').click();
  await page.locator('#fbMsg').fill('أداة للزكاة');
  await page.locator('#fbSend').click();
  await expect(page.locator('#toast')).toContainText('وصلت رسالتك');
  expect(bodies[0]['الجهاز']).toBeUndefined();
  expect(bodies[0]['للتواصل']).toBe('—');
  expect(bodies[0]['الاسم']).toBe('—');
  expect(bodies[0].subject).toContain('اقتراح');
});

test('offline: the message waits in the outbox and is sent when the connection returns', async ({ page, context }) => {
  const bodies = await mockApi(page);
  await seed(page);
  await page.locator('#fbOpen').click();
  await page.locator('#fbMsg').fill('حاسبة مدة');
  await context.setOffline(true);
  await page.locator('#fbSend').click();
  await expect(page.locator('#toast')).toContainText('حفظنا رسالتك');
  await expect(page.locator('#fbSheet')).not.toHaveClass(/\bon\b/);
  expect(await outbox(page)).toHaveLength(1);
  expect(bodies).toHaveLength(0);
  await context.setOffline(false);
  await expect.poll(() => bodies.length).toBe(1);
  await expect.poll(async () => (await outbox(page)).length).toBe(0);
  expect(bodies[0]['الرسالة']).toBe('حاسبة مدة');
});

test('a refused message keeps the sheet open with an error', async ({ page }) => {
  await mockApi(page, { ok: false });
  await seed(page);
  await page.locator('#fbOpen').click();
  await page.locator('#fbMsg').fill('اختبار رفض');
  await page.locator('#fbSend').click();
  await expect(page.locator('#toast')).toContainText('ما قدرنا نرسل');
  await expect(page.locator('#fbSheet')).toHaveClass(/\bon\b/);
  await expect(page.locator('#fbMsg')).toHaveValue('اختبار رفض');
  expect(await outbox(page)).toHaveLength(0);
});

test('English labels', async ({ page }) => {
  await seed(page, 'en');
  await expect(page.locator('#fbOpen')).toContainText('Got an idea or a problem?');
  await page.locator('#fbOpen').click();
  await expect(page.locator('#fbSheet h2')).toHaveText('Contact us');
  await expect(page.locator('#fbSheet [data-k=bug]')).toContainText('Bug');
});

test('update banner: shown once to an existing user, «وش الجديد» lists releases, dismissal sticks', async ({ page }) => {
  await seed(page);
  const banner = page.locator('#updBanner .upd');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/تم التحديث إلى\s1\.8/);
  await banner.locator('[data-wn]').click();
  const wn = page.locator('#wnSheet');
  await expect(wn).toHaveClass(/\bon\b/);
  await expect(wn.locator('.wn > li')).toHaveCount(9);
  await expect(wn.locator('.wn > li').first()).toContainText('الأحدث');
  await expect(wn.locator('.wn > li').first()).toContainText('1.8');
  await expect(banner).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await (await import('./core/store.js')).loadSettings()).seenVersion)).toBe('1.8');
  await page.reload();
  await expect(page.locator('#fbOpen')).toBeVisible();
  await expect(page.locator('#updBanner .upd')).toHaveCount(0);
  // still reachable from Settings
  await page.goto('./#prefs');
  await expect(page.locator('#view-prefs .ver')).toContainText('1.8');
  await page.locator('#view-prefs .ver').click();
  await expect(page.locator('#wnSheet')).toHaveClass(/\bon\b/);
});

test('update banner ✕ hides it for good', async ({ page }) => {
  await seed(page);
  await page.locator('#updDismiss').click();
  await expect(page.locator('#updBanner .upd')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await (await import('./core/store.js')).loadSettings()).seenVersion)).toBe('1.8');
  await page.reload();
  await expect(page.locator('#fbOpen')).toBeVisible();
  await expect(page.locator('#updBanner .upd')).toHaveCount(0);
});
