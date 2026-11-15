import { test, expect } from '@playwright/test';

// Seeds IndexedDB through the app's own modules (same shape as tests/fixtures/excel-nov-2026.js),
// then reloads on #expenses. The clock is pinned to 15 Nov 2026 so "this month" is 2026-11.
async function seed(page, { lang = 'ar', fixture = true } = {}) {
  await page.clock.setFixedTime(new Date('2026-11-15T10:00:00'));
  await page.goto('./');
  await expect(page.locator('#welcome')).toBeVisible(); // fresh device: first-run welcome
  await page.evaluate(async ({ lang, fixture }) => {
    const store = await import('./core/store.js');
    if (fixture) {
      const f = await import('./tests/fixtures/excel-nov-2026.js');
      await store.saveState(f.fixture());
    }
    await store.saveSettings({ lang, onboarded: true });
    location.hash = '#expenses';
  }, { lang, fixture });
  await page.reload();
  await expect(page.locator('#view-expenses')).toBeVisible();
  await expect(page.locator('#exLeft')).toBeVisible();
}

const stored = (page) => page.evaluate(async () => (await import('./core/store.js')).loadState());
const catId = (s, name) => s.cats.find((c) => c.name === name).id;

async function swipe(page, dx) {
  await page.evaluate((dx) => {
    const el = document.querySelector('#exHero');
    const fire = (type, x) => {
      const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 });
      el.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t],
      }));
    };
    fire('touchstart', 200);
    fire('touchend', 200 + dx);
  }, dx);
}

test.describe('Arabic', () => {
  test.use({ hasTouch: true });

  test('log spending updates summary and toast', async ({ page }) => {
    await seed(page);
    await expect(page.locator('#exLeft')).toContainText('1,730.25');
    await page.locator('#fab').click();
    const sheet = page.locator('#logSheet');
    await expect(sheet).toHaveClass(/\bon\b/);
    await expect(sheet.locator('h2')).toHaveText('سجّل صرف');
    await expect(page.locator('#logAmt')).toHaveAttribute('inputmode', 'decimal');
    await page.locator('#logAmt').fill('٥٠');
    await sheet.locator('.chips button', { hasText: /^مصروف$/ }).click();
    await sheet.locator('button[type=submit]').click();
    await expect(sheet).not.toHaveClass(/\bon\b/);
    await expect(page.locator('#exLeft')).toContainText('1,680.25');
    await expect(page.locator('#toast')).toHaveText('أُضيف 50 ر.س إلى تم الصرف · مصروف');
    const s = await stored(page);
    const tx = s.tx.filter((x) => !x.deleted && x.date === '2026-11-15');
    expect(tx).toHaveLength(1);
    expect(tx[0].catId).toBe(catId(s, 'مصروف'));
    expect(tx[0].amount).toBe(5000);
    await page.reload();
    await expect(page.locator('#exLeft')).toContainText('1,680.25');
  });

  test('summary shows Nov fixture figures and provider rows', async ({ page }) => {
    await seed(page);
    await expect(page.locator('#exLeft')).toContainText('1,730.25');
    await expect(page.locator('#fInc')).toHaveText('6,560.19');
    await expect(page.locator('#fSpent')).toHaveText('4,829.94');
    await expect(page.locator('#fBud')).toHaveText('5,029.94');
    await expect(page.locator('#fAct')).toHaveText('1,530.25');
    await expect(page.locator('#exCats')).toContainText('أقساط تابي');
    await expect(page.locator('#exCats')).toContainText('أقساط تمارا');
    await expect(page.locator('.mscroll button.on')).toHaveAttribute('data-m', '2026-11');
  });

  test('month strip and swipe', async ({ page }) => {
    await seed(page);
    const on = page.locator('.mscroll button.on');
    await expect(on).toHaveAttribute('data-m', '2026-11');
    await swipe(page, 120); // finger moves right → next month in Arabic
    await expect(on).toHaveAttribute('data-m', '2026-12');
    await swipe(page, -120);
    await expect(on).toHaveAttribute('data-m', '2026-11');
    await swipe(page, -120);
    await expect(on).toHaveAttribute('data-m', '2026-10');
    await swipe(page, 30); // too short: ignored
    await expect(on).toHaveAttribute('data-m', '2026-10');
    await page.locator('#mNext').click();
    await page.locator('#mNext').click();
    await expect(on).toHaveAttribute('data-m', '2026-12');
    await page.locator('#mPrev').click();
    await expect(on).toHaveAttribute('data-m', '2026-11');
    await page.locator('.mscroll button[data-m="2027-02"]').click();
    await expect(on).toHaveAttribute('data-m', '2027-02');
    await page.locator('#mToday').click();
    await expect(on).toHaveAttribute('data-m', '2026-11');
    await expect(on).toHaveClass(/\btoday\b/);
    await page.keyboard.press('ArrowLeft'); // RTL: left = next
    await expect(on).toHaveAttribute('data-m', '2026-12');
    await page.keyboard.press('ArrowRight');
    await expect(on).toHaveAttribute('data-m', '2026-11');
    // browsing other months never creates month records
    expect(Object.keys((await stored(page)).months)).toEqual(['2026-11']);
  });

  test('new month auto copies budget', async ({ page }) => {
    await seed(page);
    await page.locator('#mNext').click();
    await expect(page.locator('.mscroll button.on')).toHaveAttribute('data-m', '2026-12');
    await page.locator('.tabs button[data-tab=bud]').click();
    await expect(page.locator('#incIn')).toHaveValue('6560.19');
    let s = await stored(page);
    await expect(page.locator(`[data-b="${catId(s, 'مصروف')}"]`)).toHaveValue('1000');
    expect(s.months['2026-12']).toBeUndefined();
    // first write to December creates it from November
    await page.locator('#fab').click();
    await page.locator('#logAmt').fill('20');
    await page.locator('#logSheet .chips button', { hasText: /^قرض$/ }).click();
    await expect(page.locator('#logDate')).toHaveValue('2026-12-15');
    await page.locator('#logSheet button[type=submit]').click();
    await expect(page.locator('#toast')).toHaveText('أُضيف 20 ر.س إلى تم الصرف · قرض');
    s = await stored(page);
    expect(s.months['2026-12'].income).toBe(656019);
    expect(s.months['2026-12'].budget).toEqual(s.months['2026-11'].budget);
    // editing December leaves November alone
    const input = page.locator(`[data-b="${catId(s, 'مصروف')}"]`);
    await input.fill('900');
    await input.press('Enter');
    await expect.poll(async () => (await stored(page)).months['2026-12'].budget[catId(s, 'مصروف')]).toBe(90000);
    expect((await stored(page)).months['2026-11'].budget[catId(s, 'مصروف')]).toBe(100000);
  });

  test('budget row layout does not squeeze names', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await page.locator('.tabs button[data-tab=bud]').click();
    const rows = page.locator('#exBuds .brow');
    await expect(rows).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      const input = await rows.nth(i).locator('input').boundingBox();
      const name = await rows.nth(i).locator('span').first().boundingBox();
      expect(Math.round(input.width)).toBe(130);
      expect(name.width).toBeGreaterThanOrEqual(120);
    }
  });

  test('installments tab lists Tamara and Tabby payments as paid', async ({ page }) => {
    await seed(page);
    await page.locator('.tabs button[data-tab=ins]').click();
    const dues = page.locator('#exDues .due');
    await expect(dues).toHaveCount(2);
    await expect(dues.filter({ hasText: 'تمارا' }).locator('input[type=checkbox]')).toBeChecked();
    await expect(dues.filter({ hasText: 'تابي' }).locator('input[type=checkbox]')).toBeChecked();
    await expect(page.locator('#exPlans .plan')).toHaveCount(2);
    // the FAB opens «أضف قسط» on this tab
    await page.locator('#fab').click();
    await expect(page.locator('#planSheet')).toHaveClass(/\bon\b/);
    await expect(page.locator('#planSheet h2')).toHaveText('أضف قسط');
  });

  test('unmarking a payment updates spent', async ({ page }) => {
    await seed(page);
    await page.locator('.tabs button[data-tab=ins]').click();
    await page.locator('#exDues .due', { hasText: 'تابي' }).locator('input').uncheck();
    await page.locator('.tabs button[data-tab=sum]').click();
    await expect(page.locator('#fSpent')).toHaveText('3,298.94');
    const s = await stored(page);
    expect(s.plans.find((p) => p.provider === 'تابي').paid[0]).toBe(false);
  });

  test('adding a 48-month plan shows its last month 2030-10 in the preview', async ({ page }) => {
    await seed(page);
    await page.locator('.tabs button[data-tab=ins]').click();
    await page.locator('#exNewPlan').click();
    const sheet = page.locator('#planSheet');
    await expect(sheet).toHaveClass(/\bon\b/);
    await sheet.locator('#provs button', { hasText: 'تابي' }).click();
    await page.locator('#pItem').fill('جوال');
    await page.locator('#pTotal').fill('4800');
    await sheet.locator('#nChips button[data-n="48"]').click();
    await expect(page.locator('#pN')).toHaveValue('48');
    await expect(page.locator('#pStart')).toHaveValue('2026-11-15');
    await expect(page.locator('#pPrev')).toHaveAttribute('data-last', '2030-10');
    await expect(page.locator('#pPrev')).toContainText('أكتوبر 2030');
    await expect(page.locator('#pPrev')).toContainText('100');
    await page.locator('#pN').fill('49');
    await expect(page.locator('#pPrev')).toContainText('48');
    await sheet.locator('#nChips button[data-n="48"]').click();
    await sheet.locator('button[type=submit]').click();
    await expect(sheet).not.toHaveClass(/\bon\b/);
    const plan = page.locator('#exPlans .plan', { hasText: 'جوال' });
    await expect(plan).toBeVisible();
    await expect(plan.locator('.sched span')).toHaveCount(6);
    await plan.locator('.sched .more').click();
    await expect(plan.locator('.sched span')).toHaveCount(48);
    const s = await stored(page);
    const p = s.plans.find((x) => x.item === 'جوال');
    expect(p).toMatchObject({ provider: 'tabby', total: 480000, n: 48, start: '2026-11-15' });
    // canonical 'tabby' and the fixture's legacy «تابي» share one summary row
    await page.locator('.tabs button[data-tab=sum]').click();
    await expect(page.locator('#exCats .cat', { hasText: 'أقساط تابي' })).toHaveCount(1);
    await expect(page.locator('#exCats .cat', { hasText: 'أقساط تابي' })).toContainText('1,631 من 1,631');
    expect(p.paid[0]).toBe(true);
  });

  test('deleting a category with transactions shows the error toast', async ({ page }) => {
    await seed(page);
    await page.locator('.tabs button[data-tab=bud]').click();
    const row = page.locator('#exBuds .brow', { hasText: 'مصروف' });
    await row.locator('button').click();
    await expect(page.locator('#toast')).toHaveText('لا يمكن حذف «مصروف» لأن فيه حركات مسجلة');
    expect((await stored(page)).cats.find((c) => c.name === 'مصروف').deleted).toBe(false);
    // a category without transactions can be deleted (soft)
    await page.locator('#exBuds .brow', { hasText: 'قرض' }).locator('button').click();
    await expect(page.locator('#exBuds .brow')).toHaveCount(5);
    expect((await stored(page)).cats.find((c) => c.name === 'قرض').deleted).toBe(true);
    // add a category
    await page.locator('#catName').fill('هدايا');
    await page.locator('#addCat').click();
    await expect(page.locator('#exBuds .brow')).toHaveCount(6);
  });

  test('deleting a transaction is soft and updates the summary', async ({ page }) => {
    await seed(page);
    await page.locator('.tabs button[data-tab=tx]').click();
    const row = page.locator('#exTxs .tx', { hasText: 'قرض' });
    await expect(row).toHaveCount(0);
    await page.locator('#exTxs .tx', { hasText: 'youtube premium' }).locator('button').click();
    await page.locator('.tabs button[data-tab=sum]').click();
    await expect(page.locator('#exLeft')).toContainText('1,780.25');
    const s = await stored(page);
    expect(s.tx.find((x) => x.catId === catId(s, 'youtube premium')).deleted).toBe(true);
  });

  test('invalid amount shows an error and saves nothing', async ({ page }) => {
    await seed(page);
    await page.locator('#fab').click();
    await page.locator('#logAmt').fill('abc');
    await page.locator('#logSheet button[type=submit]').click();
    await expect(page.locator('#toast')).toHaveText('اكتب مبلغاً صحيحاً');
    await expect(page.locator('#logSheet')).toHaveClass(/\bon\b/);
    expect((await stored(page)).tx).toHaveLength(5);
  });

  test('custom provider name is stored as typed', async ({ page }) => {
    await seed(page);
    await page.locator('.tabs button[data-tab=ins]').click();
    await page.locator('#exNewPlan').click();
    await page.locator('#provs button[data-p=other]').click();
    await page.locator('#provOther').fill('مدفوع');
    await page.locator('#pTotal').fill('300');
    await page.locator('#nChips button[data-n="3"]').click();
    await page.locator('#planSheet button[type=submit]').click();
    await expect(page.locator('#planSheet')).not.toHaveClass(/\bon\b/);
    const s = await stored(page);
    expect(s.plans.map((p) => p.provider)).toEqual(['تمارا', 'تابي', 'مدفوع']);
  });

  test('save failure keeps the sheet open and rolls back', async ({ page }) => {
    await seed(page);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (v, k) {
        if (k === 'state') throw new DOMException('quota', 'QuotaExceededError');
        return put.call(this, v, k);
      };
    });
    await page.locator('#fab').click();
    await page.locator('#logAmt').fill('50');
    await page.locator('#logSheet button[type=submit]').click();
    await expect(page.locator('#toast')).toHaveText('تعذّر الحفظ على هذا الجهاز');
    await expect(page.locator('#logSheet')).toHaveClass(/\bon\b/);
    await expect(page.locator('#exLeft')).toContainText('1,730.25');
    // the in-memory state was rolled back: a later successful save does not include the failed tx
    await page.keyboard.press('Escape');
    await page.locator('#mNext').click();
    await expect(page.locator('.mscroll button.on')).toHaveAttribute('data-m', '2026-12');
    await page.locator('.tabs button[data-tab=tx]').click();
    await page.locator('#mPrev').click();
    await expect(page.locator('#exTxs .tx')).toHaveCount(7); // 5 tx + 2 paid installments
  });

  test('a rejected amount leaves no stray month record', async ({ page }) => {
    await seed(page);
    await page.locator('#mNext').click();
    await page.locator('#fab').click();
    await page.locator('#logAmt').fill('0');
    await page.locator('#logSheet button[type=submit]').click();
    await expect(page.locator('#toast')).toHaveText('اكتب مبلغاً صحيحاً');
    expect(Object.keys((await stored(page)).months)).toEqual(['2026-11']);
    await page.keyboard.press('Escape');
    await expect(page.locator('#exNew')).toBeVisible();
  });

  test('hub quick button opens the log sheet', async ({ page }) => {
    await seed(page);
    await page.goto('./#home');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#fab')).toBeHidden();
    await expect(page.locator('#home-sub-expenses')).toContainText('1,730.25');
    await page.locator('.tool[data-tool=expenses] .quick').click();
    await expect(page).toHaveURL(/#expenses$/);
    await expect(page.locator('#logSheet')).toHaveClass(/\bon\b/);
  });
});

test.describe('storage read failure', () => {
  test('a failed load shows an error, never writes, and retry recovers', async ({ page }) => {
    await seed(page);
    await page.addInitScript(() => {
      window.__failGet = true;
      window.__puts = 0;
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (k) {
        if (k === 'state' && window.__failGet) throw new DOMException('read failed', 'UnknownError');
        return get.call(this, k);
      };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (v, k) {
        if (k === 'state') window.__puts++;
        return put.call(this, v, k);
      };
    });
    await page.reload();
    await expect(page.locator('#exLoadErr')).toBeVisible();
    await expect(page.locator('#exLoadErr')).toContainText('تعذّر قراءة بياناتك');
    await expect(page.locator('#exLeft')).toHaveCount(0);
    await expect(page.locator('#fab')).toBeHidden();
    await page.goto('./#home');
    await page.locator('.tool[data-tool=expenses] .quick').click();
    await expect(page.locator('#exLoadErr')).toBeVisible();
    expect(await page.evaluate(() => window.__puts)).toBe(0);
    // retry while still failing keeps the error; once reads work, the saved data comes back intact
    await page.locator('#exRetry').click();
    await expect(page.locator('#exLoadErr')).toBeVisible();
    await page.evaluate(() => { window.__failGet = false; });
    await page.locator('#exRetry').click();
    await expect(page.locator('#exLeft')).toContainText('1,730.25');
    await expect(page.locator('#fab')).toBeVisible();
    expect(await page.evaluate(() => window.__puts)).toBe(0);
  });
});

test.describe('English', () => {
  test.use({ hasTouch: true });

  test('English shows Log spending, ltr, mirrored swipe', async ({ page }) => {
    await seed(page, { lang: 'en' });
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('.tabs button[data-tab=sum]')).toHaveText('Summary');
    await expect(page.locator('#exLeft')).toContainText('1,730.25');
    await page.locator('#fab').click();
    await expect(page.locator('#logSheet h2')).toHaveText('Log spending');
    await expect(page.locator('#logSheet button[type=submit]')).toHaveText('Log');
    await page.keyboard.press('Escape');
    const on = page.locator('.mscroll button.on');
    await swipe(page, -120); // LTR: finger moves left → next month
    await expect(on).toHaveAttribute('data-m', '2026-12');
    await page.keyboard.press('ArrowLeft');
    await expect(on).toHaveAttribute('data-m', '2026-11');
    await page.keyboard.press('ArrowRight');
    await expect(on).toHaveAttribute('data-m', '2026-12');
  });

  test('language change re-renders the expenses view in place', async ({ page }) => {
    await seed(page, { lang: 'ar' });
    await page.locator('.tabs button[data-tab=ins]').click();
    await page.evaluate(async () => (await import('./core/app.js')).applyLanguage('en'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('.tabs button.on')).toHaveText('Installments');
    await expect(page.locator('#exDueTitle')).toHaveText('Due in November 2026');
    await expect(page.locator('#exDues .due').first()).toContainText('Tamara');
  });

  test('onboarded device without saved state falls back to the nine default categories', async ({ page }) => {
    await seed(page, { lang: 'en', fixture: false });
    await page.locator('.tabs button[data-tab=bud]').click();
    await expect(page.locator('#exBuds .brow')).toHaveCount(9);
    await expect(page.locator('#exBuds')).toContainText('Pocket money');
    expect(await stored(page)).toBeNull(); // nothing written until the user writes
  });
});
