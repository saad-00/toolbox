import { test, expect } from '@playwright/test';

const stored = (page) => page.evaluate(async () => (await import('./core/store.js')).loadState());
const deviceSettings = (page) => page.evaluate(async () => (await import('./core/store.js')).loadSettings());
const cssVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const DAY = 864e5;

// A fresh context always opens the welcome flow; seed the device through the app's own modules, then reload.
async function seed(page, { settings = {}, fixture = true, hash = '' } = {}) {
  await page.goto('./');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(async ({ settings, fixture }) => {
    const store = await import('./core/store.js');
    if (fixture) { const f = await import('./tests/fixtures/excel-nov-2026.js'); await store.saveState(f.fixture()); }
    await store.saveSettings({ onboarded: true, lang: 'ar', ...settings });
  }, { settings, fixture });
  await page.goto(`./${hash}`);
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
}

test.describe('first run', () => {
  test('first run in English device opens LTR English', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto('./');
    const w = page.locator('#welcome');
    await expect(w).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(w.locator('h1')).toHaveText('Toolbox');
    await expect(page).toHaveTitle('Toolbox');
    await expect(w.locator('[data-lang=en]')).toHaveAttribute('aria-pressed', 'true');
    // switching language re-renders the welcome in place and flips direction
    await w.locator('[data-lang=ar]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(w.locator('h1')).toHaveText('أدواتي');
    await expect(w.locator('[data-lang=ar]')).toHaveAttribute('aria-pressed', 'true');
    await w.locator('[data-lang=en]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(w.locator('#wNext')).toHaveText('Next');
    // nothing is written before the user finishes
    expect(await stored(page)).toBeNull();
    await ctx.close();
  });

  test('first run in Arabic device, default categories removable', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ar-SA' });
    const page = await ctx.newPage();
    await page.goto('./');
    const w = page.locator('#welcome');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(w.locator('h1')).toHaveText('أدواتي');
    await w.locator('#wNext').click();
    // step 2: salary + nine checked categories
    const boxes = w.locator('input[name=cat]');
    await expect(boxes).toHaveCount(9);
    for (let i = 0; i < 9; i++) await expect(boxes.nth(i)).toBeChecked();
    await w.locator('label', { hasText: 'البنزين والمواصلات' }).click();
    await expect(w.locator('input[name=cat][value="cat.transport"]')).not.toBeChecked();
    await w.locator('#wSalary').fill('6560.19');
    await w.locator('#wNext').click();
    // step 3: install guide for iPhone and Android
    await expect(w).toContainText('آيفون');
    await expect(w).toContainText('أندرويد');
    await expect(w).toContainText('إضافة إلى الشاشة الرئيسية');
    await w.locator('#wNext').click();
    // step 4: local is the default; sync sits under «إعدادات متقدمة»
    await expect(w.locator('input[name=mode][value=local]')).toBeChecked();
    await expect(w.locator('details#wAdv summary')).toHaveText('إعدادات متقدمة');
    await expect(w.locator('#wToken')).toBeHidden();
    await w.locator('#wFinish').click();
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#welcome')).toBeHidden();
    await expect(page).toHaveURL(/#home$/);
    await expect(page.locator('#view-home')).toBeVisible();
    const s = await stored(page);
    const live = s.cats.filter((c) => !c.deleted);
    expect(live).toHaveLength(8);
    expect(live.map((c) => c.nameKey)).not.toContain('cat.transport');
    const set = await deviceSettings(page);
    expect(set.onboarded).toBe(true);
    expect(set.lang).toBe('ar');
    expect(set.mode).toBe('local');
    expect(typeof set.deviceId).toBe('string');
    // the salary is this month's income
    await page.goto('./#expenses');
    await expect(page.locator('#fInc')).toHaveText('6,560.19');
    await page.locator('#exBudBtn').click(); // PC: the budget opens from the header (no tabs)
    await expect(page.locator('#exBuds .brow')).toHaveCount(8);
    await expect(page.locator('#exBuds')).not.toContainText('البنزين والمواصلات');
    // welcome never comes back
    await page.reload();
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#welcome')).toBeHidden();
    await ctx.close();
  });

  test('welcome is not shown when state exists', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('#welcome')).toBeVisible();
    await page.evaluate(async () => {
      const store = await import('./core/store.js');
      const f = await import('./tests/fixtures/excel-nov-2026.js');
      await store.saveState(f.fixture());
    });
    await page.reload();
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#welcome')).toBeHidden();
  });
});

test.describe('settings', () => {
  test.use({ locale: 'ar-SA' });

  test('switching language in settings flips direction', async ({ page }) => {
    await seed(page, { hash: '#prefs' });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const v = page.locator('#view-prefs');
    await expect(v.locator('h1')).toHaveText('الإعدادات');
    await v.locator('[data-lang=en]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(v.locator('h1')).toHaveText('Settings');
    await expect(page.locator('#sideNav a[data-r=expenses]')).toHaveText('Expenses');
    await expect(v.locator('[data-lang=en]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await deviceSettings(page)).lang).toBe('en');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await v.locator('[data-lang=ar]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('palette choice persists, graphite is default', async ({ page }) => {
    await seed(page, { hash: '#prefs' });
    expect(await cssVar(page, '--bg')).toBe('#14161b');
    const v = page.locator('#view-prefs');
    await expect(v.locator('[data-p]')).toHaveCount(8);
    await expect(v.locator('[data-p=graphite]')).toHaveAttribute('aria-pressed', 'true');
    await v.locator('[data-p=emerald]').click();
    expect(await cssVar(page, '--bg')).toBe('#04231c');
    await expect(v.locator('[data-p=emerald]')).toHaveAttribute('aria-pressed', 'true');
    await expect(v.locator('[data-p=graphite]')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await deviceSettings(page)).palette).toBe('emerald');
    await page.reload();
    await expect(page.locator('#app')).toBeVisible();
    expect(await cssVar(page, '--bg')).toBe('#04231c');
    await expect(v.locator('[data-p=emerald]')).toHaveAttribute('aria-pressed', 'true');
    expect((await deviceSettings(page)).palette).toBe('emerald');
  });

  test('custom palette via color inputs changes --bg and persists', async ({ page }) => {
    await seed(page, { hash: '#prefs' });
    const v = page.locator('#view-prefs');
    await expect(v.locator('#sCustom')).toBeHidden();
    await v.locator('[data-p=custom]').click();
    await expect(v.locator('#sCustom')).toBeVisible();
    await expect(v.locator('#sCustom input[type=color]')).toHaveCount(4);
    await v.locator('#cBg').fill('#203040');
    await v.locator('#cB1').fill('#ff0000');
    expect(await cssVar(page, '--bg')).toBe('#203040');
    expect(await cssVar(page, '--b1')).toBe('#ff0000');
    await expect(page.locator('meta[name=theme-color]')).toHaveAttribute('content', '#203040');
    await expect.poll(async () => (await deviceSettings(page)).customPalette).toEqual(expect.objectContaining({ bg: '#203040', b1: '#ff0000' }));
    await page.reload();
    await expect(page.locator('#app')).toBeVisible();
    expect(await cssVar(page, '--bg')).toBe('#203040');
    expect(await cssVar(page, '--b1')).toBe('#ff0000');
    await expect(v.locator('[data-p=custom]')).toHaveAttribute('aria-pressed', 'true');
    expect((await deviceSettings(page)).palette).toBe('custom');
  });

  test('settings that cannot be read show a notice that they cannot be saved', async ({ page }) => {
    await seed(page);
    await page.addInitScript(() => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (k) {
        if (k === 'settings') throw new DOMException('read failed', 'UnknownError');
        return get.call(this, k);
      };
    });
    await page.goto('./#prefs');
    await page.reload();
    await expect(page.locator('#sSettingsErr')).toBeVisible();
    await expect(page.locator('#sSettingsErr')).toContainText('لا يمكن حفظ الإعدادات');
  });

  test('settings that were read normally show no notice', async ({ page }) => {
    await seed(page, { hash: '#prefs' });
    await expect(page.locator('#view-prefs h1')).toBeVisible();
    await expect(page.locator('#sSettingsErr')).toHaveCount(0);
  });

  test('backup reminder shows after 30 days', async ({ page }) => {
    await seed(page, { settings: { mode: 'local', lastBackupAt: Date.now() - 31 * DAY } });
    const banner = page.locator('#backupBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('30');
    await banner.locator('#backupDismiss').click();
    await expect(banner).toBeHidden();
    // a recent backup: no reminder
    await page.evaluate(async (at) => {
      const store = await import('./core/store.js');
      await store.saveSettings({ ...(await store.loadSettings()), lastBackupAt: at });
    }, Date.now() - 5 * DAY);
    await page.reload();
    await expect(page.locator('#view-home h1')).toBeVisible();
    await expect(page.locator('#backupBanner')).toBeHidden();
    // sync mode: no reminder even when old
    await page.evaluate(async (at) => {
      const store = await import('./core/store.js');
      await store.saveSettings({ ...(await store.loadSettings()), lastBackupAt: at, mode: 'sync' });
    }, Date.now() - 40 * DAY);
    await page.route('https://api.github.com/**', (r) => r.abort());
    await page.reload();
    await expect(page.locator('#view-home h1')).toBeVisible();
    await expect(page.locator('#backupBanner')).toBeHidden();
  });

  test('backup button downloads a backup and clears the reminder', async ({ page }) => {
    await seed(page, { settings: { mode: 'local', lastBackupAt: Date.now() - 31 * DAY } });
    await expect(page.locator('#backupBanner')).toBeVisible();
    await page.goto('./#prefs');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#sBackup').click()]);
    expect(dl.suggestedFilename()).toMatch(/^toolbox-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const body = JSON.parse(await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8'));
    expect(body.kind).toBe('toolbox-backup');
    expect(body.state.tx.length).toBe((await stored(page)).tx.length);
    await expect.poll(async () => (await deviceSettings(page)).lastBackupAt).toBeGreaterThan(Date.now() - 60000);
    await page.goto('./#home');
    await expect(page.locator('#backupBanner')).toBeHidden();
  });

  test('import of a backup file merges (both transactions visible)', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('#welcome')).toBeVisible();
    const json = await page.evaluate(async () => {
      const store = await import('./core/store.js');
      const { fixture } = await import('./tests/fixtures/excel-nov-2026.js');
      const { addTx } = await import('./core/model.js');
      const { todayLocal } = await import('./core/months.js');
      const { exportBackup } = await import('./core/backup.js');
      const s = fixture();
      const b = structuredClone(s);
      const cat = s.cats[0].id;
      addTx(b, { catId: cat, amount: 1234, date: todayLocal(), note: 'from-backup' });
      addTx(s, { catId: cat, amount: 4321, date: todayLocal(), note: 'local-only' });
      await store.saveState(s);
      await store.saveSettings({ onboarded: true, lang: 'ar' });
      return exportBackup(b).json;
    });
    await page.goto('./#prefs');
    await page.reload();
    await expect(page.locator('#view-prefs')).toBeVisible();
    // a broken file is refused and changes nothing
    await page.locator('#sImport').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
    await expect(page.locator('#toast')).toHaveText('هذا الملف ليس نسخة احتياطية صالحة من أدواتي');
    expect((await stored(page)).tx).toHaveLength(6);
    await page.locator('#sImport').setInputFiles({ name: 'toolbox-backup.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await expect(page.locator('#toast')).toHaveText('استُرجعت النسخة ودُمجت مع بياناتك');
    const s = await stored(page);
    expect(s.tx).toHaveLength(7);
    expect(s.tx.map((x) => x.note)).toEqual(expect.arrayContaining(['from-backup', 'local-only']));
    await page.goto('./#expenses'); // PC board: transactions are on it, no tab to pick
    await expect(page.locator('#exTxs')).toContainText('from-backup');
    await expect(page.locator('#exTxs')).toContainText('local-only');
  });
});

test.describe('sync settings', () => {
  test.use({ locale: 'ar-SA', serviceWorkers: 'block' });

  // Mocks the GitHub contents API. remote: envelope object or null (404). Counts requests by method.
  async function mockGitHub(page, remote) {
    const calls = { GET: 0, PUT: 0 };
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type, X-GitHub-Api-Version',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    };
    await page.route('https://api.github.com/**', async (route) => {
      const m = route.request().method();
      if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      calls[m] = (calls[m] || 0) + 1;
      if (m === 'GET') {
        if (!remote) return route.fulfill({ status: 404, headers: cors, body: '{}' });
        const text = JSON.stringify(remote);
        return route.fulfill({
          status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sha: 'abc123', encoding: 'base64', size: text.length, content: Buffer.from(text).toString('base64') }),
        });
      }
      return route.fulfill({ status: 201, headers: { ...cors, 'Content-Type': 'application/json' }, body: '{"content":{"sha":"new"}}' });
    });
    return calls;
  }

  test('welcome sync mode: a tested connection uses the synced data instead of the starter categories', async ({ page }) => {
    await page.goto('./');
    const w = page.locator('#welcome');
    await expect(w).toBeVisible();
    const remote = await page.evaluate(async () => {
      const { encryptJSON } = await import('./core/crypto.js');
      const { createState, addTx } = await import('./core/model.js');
      const { todayLocal } = await import('./core/months.js');
      const s = createState(['cat.food']);
      addTx(s, { catId: s.cats[0].id, amount: 777, date: todayLocal(), note: 'from-remote' });
      return encryptJSON(s, 'shared pass');
    });
    const calls = await mockGitHub(page, remote);
    for (let i = 0; i < 3; i++) await w.locator('#wNext').click();
    await w.locator('#wAdv summary').click();
    await w.locator('input[name=mode][value=sync]').check();
    await w.locator('#wFinish').click();
    await expect(page.locator('#toast')).toHaveText('اختبر الاتصال أولاً، أو اختر «محلي».');
    await expect(w).toBeVisible();
    await w.locator('#wToken').fill('github_pat_test');
    await w.locator('#wPass').fill('shared pass');
    await w.locator('#wTest').click();
    await expect(w.locator('#wTestOut')).toContainText('وُجدت بياناتك', { timeout: 20000 });
    expect(calls.GET).toBe(1);
    expect(calls.PUT).toBe(0); // the connection test is read-only
    await w.locator('#wFinish').click();
    await expect(page.locator('#app')).toBeVisible();
    const s = await stored(page);
    expect(s.cats.filter((c) => !c.deleted).map((c) => c.nameKey)).toEqual(['cat.food']);
    expect(s.tx.map((x) => x.note)).toContain('from-remote');
    const set = await deviceSettings(page);
    expect(set).toEqual(expect.objectContaining({ onboarded: true, mode: 'sync', token: 'github_pat_test', passphrase: 'shared pass' }));
  });

  test('welcome sync mode with no remote file keeps the chosen categories and salary; pressing test twice uploads nothing', async ({ page }) => {
    await page.goto('./');
    const w = page.locator('#welcome');
    await expect(w).toBeVisible();
    const calls = await mockGitHub(page, null);
    await w.locator('#wNext').click();
    await w.locator('label', { hasText: 'البنزين والمواصلات' }).click();
    await w.locator('#wSalary').fill('1000');
    await w.locator('#wNext').click();
    await w.locator('#wNext').click();
    await w.locator('#wAdv summary').click();
    await w.locator('#wToken').fill('github_pat_test');
    await w.locator('#wPass').fill('shared pass');
    for (let i = 0; i < 2; i++) {
      await w.locator('#wTest').click();
      await expect(w.locator('#wTestOut')).toHaveText('تم الاتصال. سيُزامَن هذا الجهاز.', { timeout: 20000 });
    }
    expect(calls.GET).toBe(2);
    expect(calls.PUT).toBe(0);
    await w.locator('#wFinish').click();
    await expect(page.locator('#app')).toBeVisible();
    const s = await stored(page);
    expect(s.cats.filter((c) => !c.deleted)).toHaveLength(8);
    expect(Object.values(s.months).map((m) => m.income)).toEqual([100000]);
    expect((await deviceSettings(page)).mode).toBe('sync');
    // the first auto-sync after boot uploads the new state
    await expect.poll(() => calls.PUT, { timeout: 20000 }).toBe(1);
  });

  test('«إيقاف المزامنة» clears token and passphrase', async ({ page }) => {
    await page.route('https://api.github.com/**', (r) => r.abort());
    await seed(page, { settings: { mode: 'sync', token: 'github_pat_x', passphrase: 'secret pass' }, hash: '#prefs' });
    const v = page.locator('#view-prefs');
    await expect(v.locator('#sToken')).toHaveValue('github_pat_x');
    await expect(v.locator('#sToken')).toHaveAttribute('type', 'password');
    await expect(v.locator('#sPass')).toHaveAttribute('type', 'password');
    await v.locator('#sStop').click();
    await expect(v.locator('#sToken')).toHaveValue('');
    await expect(v.locator('#sPass')).toHaveValue('');
    await expect(v.locator('#sStatus')).toContainText('المزامنة متوقفة');
    const set = await deviceSettings(page);
    expect(set.token).toBeFalsy();
    expect(set.passphrase).toBeFalsy();
    expect(set.mode).toBe('local');
  });

  test('wrong passphrase shows the localized message and nothing is uploaded', async ({ page }) => {
    await seed(page, { hash: '#prefs' });
    const remote = await page.evaluate(async () => {
      const { encryptJSON } = await import('./core/crypto.js');
      const { createState } = await import('./core/model.js');
      return encryptJSON(createState(['cat.food']), 'another passphrase');
    });
    const calls = await mockGitHub(page, remote);
    const v = page.locator('#view-prefs');
    await v.locator('#sAdv summary').click();
    await v.locator('#sToken').fill('github_pat_test');
    await v.locator('#sPass').fill('my passphrase');
    await v.locator('#sSyncNow').click();
    await expect(v.locator('#sStatus')).toContainText('كلمة السر لا تطابق', { timeout: 20000 });
    await expect(v.locator('#sStatus')).toContainText('لم يُرفع شيء');
    expect(calls.GET).toBeGreaterThan(0);
    expect(calls.PUT).toBe(0);
    // a failed first sync saves nothing: previous settings are kept
    const set = await deviceSettings(page);
    expect(set.token).toBeFalsy();
    expect(set.passphrase).toBeFalsy();
    expect(set.mode).not.toBe('sync');
    expect(set.lastSyncAt).toBeFalsy();
    await page.reload();
    await expect(v.locator('#sStatus')).toContainText('المزامنة متوقفة');
  });

  test('a remote from a newer app version shows the update message and nothing is uploaded', async ({ page }) => {
    await seed(page, { hash: '#prefs' });
    const remote = await page.evaluate(async () => {
      const { encryptJSON } = await import('./core/crypto.js');
      const { createState } = await import('./core/model.js');
      return encryptJSON({ ...createState(['cat.food']), v: 2 }, 'shared pass');
    });
    const calls = await mockGitHub(page, remote);
    const v = page.locator('#view-prefs');
    await v.locator('#sAdv summary').click();
    await v.locator('#sToken').fill('github_pat_test');
    await v.locator('#sPass').fill('shared pass');
    await v.locator('#sSyncNow').click();
    await expect(v.locator('#sStatus')).toContainText('بإصدار أحدث من أدواتي', { timeout: 20000 });
    expect(calls.PUT).toBe(0);
  });

  test('sync now merges the remote state and records the time; auto-sync after a save', async ({ page }) => {
    await seed(page, { hash: '#prefs' });
    const remote = await page.evaluate(async () => {
      const { encryptJSON } = await import('./core/crypto.js');
      const { createState, addTx } = await import('./core/model.js');
      const { todayLocal } = await import('./core/months.js');
      const s = createState(['cat.food']);
      addTx(s, { catId: s.cats[0].id, amount: 777, date: todayLocal(), note: 'from-remote' });
      return encryptJSON(s, 'shared pass');
    });
    const calls = await mockGitHub(page, remote);
    const v = page.locator('#view-prefs');
    await v.locator('#sAdv summary').click();
    await v.locator('#sToken').fill('github_pat_test');
    await v.locator('#sPass').fill('shared pass');
    await v.locator('#sSyncNow').click();
    await expect(v.locator('#sStatus')).toContainText('آخر مزامنة', { timeout: 20000 });
    expect(calls.PUT).toBe(1);
    const s = await stored(page);
    expect(s.tx.map((x) => x.note)).toContain('from-remote');
    expect((await deviceSettings(page)).lastSyncAt).toBeGreaterThan(0);
    expect((await deviceSettings(page)).mode).toBe('sync');
    // a save in the app triggers one debounced sync ~5 s later
    await page.goto('./#expenses');
    await expect(page.locator('#exTxs, #exLeft').first()).toBeAttached();
    await page.locator('#exLog').click();
    await page.locator('#logAmt').fill('10');
    await page.locator('#logSheet .chips button').first().click();
    await page.locator('#logSheet button[type=submit]').click();
    await expect(page.locator('#logSheet')).not.toHaveClass(/\bon\b/);
    await expect.poll(() => calls.PUT, { timeout: 9000 }).toBe(2);
  });
});
