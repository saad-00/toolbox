import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

// v1.6: the review fixes and the approved mockups (board, centred dialog, home summary, reports,
// fixed expenses, payday month, month picker). Clock pinned to 15 Nov 2026; fixture = Nov 2026 sheet
// (income 6,560.19, spent 4,829.94 → 1,730.25 available, 16 days left → 108 per day).
async function seed(page, { lang = 'ar', hash = '#expenses' } = {}) {
  await page.clock.setFixedTime(new Date('2026-11-15T10:00:00'));
  await page.goto('./');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(async ({ lang, hash }) => {
    const store = await import('./core/store.js');
    const f = await import('./tests/fixtures/excel-nov-2026.js');
    await store.saveState(f.fixture());
    await store.saveSettings({ lang, onboarded: true, lastBackupAt: Date.now() });
    location.hash = hash;
  }, { lang, hash });
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
}
const stored = (page) => page.evaluate(async () => (await import('./core/store.js')).loadState());

test.describe('PC', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('N opens «سجّل صرف» from any page as a centred dialog; Tab stays inside it', async ({ page }) => {
    await seed(page, { hash: '#home' });
    await page.keyboard.press('n');
    await expect(page).toHaveURL(/#expenses$/);
    const sheet = page.locator('#logSheet');
    await expect(sheet).toHaveClass(/\bon\b/);
    await expect(page.locator('#logAmt')).toBeFocused();
    const box = await sheet.boundingBox();
    expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThan(40); // vertically centred, not a bottom sheet
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('#logSheet'))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#logSheet'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(sheet).not.toHaveClass(/\bon\b/);
    await expect(page.locator('#logAmt')).toBeHidden(); // a closed sheet is out of the Tab order too
    // typing in a field never triggers the shortcut
    await page.locator('#exBudBtn').click();
    await page.locator('#catName').press('n');
    await expect(sheet).not.toHaveClass(/\bon\b/);
  });

  test('the date reads in words; a wrong amount is explained under the field, then clears', async ({ page }) => {
    await seed(page);
    await page.locator('#exLog').click();
    await expect(page.locator('#logDateTxt')).toHaveText('اليوم، الأحد 15 نوفمبر');
    await page.locator('#logDate').fill('2026-11-14');
    await expect(page.locator('#logDateTxt')).toHaveText('أمس، السبت 14 نوفمبر');
    await page.locator('#logAmt').fill('12,5,0');
    await page.locator('#logSheet button[type=submit]').click();
    await expect(page.locator('#logAmt-err')).toHaveText('اكتب المبلغ بأرقام فقط، مثل 45 أو 12.50');
    await expect(page.locator('#logAmt')).toBeFocused();
    await page.locator('#logAmt').fill('12.50');
    await expect(page.locator('#logAmt-err')).toHaveCount(0);
    await expect(page.locator('#logAmt')).not.toHaveAttribute('aria-invalid', 'true');
    await page.locator('#logSheet button[type=submit]').click();
    await expect(page.locator('#toast')).toContainText('سُجّل 12.50 ر.س');
    expect((await stored(page)).tx.find((x) => x.amount === 1250).date).toBe('2026-11-14');
  });

  test('deleting offers «تراجع», which brings the record back', async ({ page }) => {
    await seed(page);
    const rows = page.locator('#exTxs .tx');
    await expect(rows).toHaveCount(7);
    await page.locator('#exTxs [data-del]').first().click();
    await expect(rows).toHaveCount(6);
    await expect(page.locator('#toast')).toContainText('حُذفت الحركة');
    await page.locator('#toast .t-act').click();
    await expect(rows).toHaveCount(7);
    await expect(page.locator('#toast')).toHaveText('رجعت كما كانت');
    expect((await stored(page)).tx.filter((x) => x.deleted)).toHaveLength(0);
    // categories too
    await page.locator('#exBudBtn').click();
    await page.locator('#catName').fill('هدايا');
    await page.locator('#addCat').click();
    await page.locator('#exBuds .brow', { hasText: 'هدايا' }).locator('[data-cdel]').click();
    await expect(page.locator('#exBuds .brow', { hasText: 'هدايا' })).toHaveCount(0);
    await page.locator('#toast .t-act').click();
    await expect(page.locator('#exBuds .brow', { hasText: 'هدايا' })).toHaveCount(1);
  });

  test('summary: daily allowance, clearer names with an explanation, category states', async ({ page }) => {
    await seed(page);
    await expect(page.locator('#exDailyAmt')).toHaveText('108 ر.س');
    await expect(page.locator('#exDailySub')).toHaveText('لين 30 نوفمبر، باقي 16 يوماً');
    await expect(page.locator('#exHero .lbl')).toContainText('متاح لك الآن');
    await page.locator('.info-btn').click();
    await expect(page.locator('#exInfo')).toBeVisible();
    await expect(page.locator('#exInfo dt')).toHaveText(['متاح لك الآن', 'صرفت', 'خطّطت لصرفه', 'يبقى بعد الخطة']);
    await page.keyboard.press('Escape');
    await expect(page.locator('#exInfo')).toBeHidden();
    const cat = (name) => page.locator('#exCats .cat', { hasText: name });
    await expect(cat('قرض')).toContainText('باقي 200 من 200');
    await expect(cat('فلوس البيت')).toContainText('اكتمل');
    await expect(page.locator('#exLegend')).toBeEmpty();
    // go over a budget: the row says by how much, and the legend appears
    await page.locator('#exLog').click();
    await page.locator('#logAmt').fill('100');
    await page.locator('#logSheet .chips button', { hasText: /^مصروف$/ }).click();
    await page.locator('#logSheet button[type=submit]').click();
    await expect(cat('مصروف')).toHaveClass(/\bover\b/);
    await expect(cat('مصروف')).toContainText('تجاوز بـ 100');
    await expect(page.locator('#exLegend')).toContainText('تجاوز');
  });

  test('transactions: grouped by day, searchable, filterable by category', async ({ page }) => {
    await seed(page);
    await expect(page.locator('#exTxs .tx-day').first()).toContainText('الخميس 5 نوفمبر');
    await expect(page.locator('#exTxs .tx-day').first()).toContainText('2,262.75');
    await page.locator('#txQ').fill('youtube');
    await expect(page.locator('#exTxs .tx')).toHaveCount(1);
    await expect(page.locator('#txQ')).toBeFocused(); // filtering in place keeps the cursor
    await page.locator('#txQ').fill('لا شيء');
    await expect(page.locator('#exTxs')).toHaveText('لا توجد حركات تطابق البحث.');
    await page.locator('#txQ').fill('');
    await page.locator('#txF').selectOption({ label: 'نت الجوال' }); // a dropdown since v1.8
    await expect(page.locator('#exTxs .tx')).toHaveCount(1);
    await page.locator('#txF').selectOption('ins');
    await expect(page.locator('#exTxs .tx')).toHaveCount(2);
    await expect(page.locator('#exTxs .tx-day')).toHaveText([/أقساط مدفوعة هذا الشهر/]);
  });

  test('«أقرب قسط» shows the next unpaid payment and can be marked paid', async ({ page }) => {
    await seed(page);
    const card = page.locator('#exNextCard');
    await expect(card).toBeVisible();
    await expect(card).toContainText('قسط تمارا');
    await expect(card).toContainText('دفعة 2 من 4 · بعد 18 يوماً');
    await card.locator('input[type=checkbox]').check();
    await expect(page.locator('#toast')).toHaveText('سُجّلت الدفعة كمدفوعة');
    const s = await stored(page);
    expect(s.plans.find((p) => p.provider === 'تمارا' || p.provider === 'tamara').paid[1]).toBe(true);
    await expect(card).toContainText('قسط PC'); // the next one is now Tabby's
  });

  test('month picker: the chosen month opens a year grid; the address keeps the month', async ({ page }) => {
    await seed(page);
    const pill = page.locator('#mscroll button.on');
    await expect(pill).toHaveAttribute('aria-expanded', 'false');
    await pill.click();
    const pick = page.locator('#mPick');
    await expect(pick).toBeVisible();
    await expect(pick.locator('[data-pm]')).toHaveCount(12);
    await expect(pick.locator('[data-pm="2026-11"]')).toHaveClass(/\bhas\b/);
    await expect(page.locator('#mscroll button.on')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(pick).toBeHidden();
    await page.locator('#mscroll button.on').click();
    await pick.locator('[data-py="1"]').click();
    await expect(pick.locator('.mp-head b')).toHaveText('2027');
    await pick.locator('[data-pm="2027-03"]').click();
    await expect(pick).toBeHidden();
    await expect(page.locator('#mscroll button.on')).toHaveAttribute('data-m', '2027-03');
    await expect(page).toHaveURL(/#expenses\/2027-03$/);
    await page.reload();
    await expect(page.locator('#mscroll button.on')).toHaveAttribute('data-m', '2027-03');
    await page.locator('#mToday').click();
    await expect(page).toHaveURL(/#expenses$/);
    // a click elsewhere closes it
    await page.locator('#mscroll button.on').click();
    await expect(pick).toBeVisible();
    await page.locator('#t-tx h2').click(); // outside the picker
    await expect(pick).toBeHidden();
  });

  test('reports: six months as a chart or a table, and the Excel export', async ({ page }) => {
    await seed(page);
    await page.locator('#exRepBtn').click();
    await expect(page.locator('#t-rep')).toBeVisible();
    await expect(page.locator('#exHero')).toBeHidden();
    await expect(page.locator('#exRepBtn')).toHaveText('رجوع للملخص');
    await expect(page.locator('.rc-col')).toHaveCount(6);
    await expect(page.locator('.rc-lbl')).toHaveText(['حتى الآن 4,829.94']);
    await page.locator('#repView').click();
    await expect(page.locator('.rc-table tbody tr')).toHaveCount(6);
    await expect(page.locator('.rc-table tbody tr').last()).toContainText('4,829.94');
    const dl = page.waitForEvent('download');
    await page.locator('#exExport').click();
    const file = await dl;
    expect(file.suggestedFilename()).toBe('toolbox-transactions-2026-11-15.csv');
    const text = readFileSync(await file.path(), 'utf8');
    expect(text.startsWith('﻿"التاريخ","الشهر","البند","المبلغ","ملاحظة"')).toBe(true);
    expect(text).toContain('"2026-11-05","2026-11","فلوس البيت","1000",""');
    await expect(page.locator('#toast')).toHaveText('نُزّل ملف الحركات');
  });

  test('fixed expenses: added, logged on its day, paused, deleted with undo', async ({ page }) => {
    await seed(page);
    await page.locator('#exRepBtn').click();
    await expect(page.locator('#fxList')).toContainText('أضف الإيجار أو الاشتراكات');
    await page.locator('#fxAdd').click();
    await expect(page.locator('#fxSheet')).toHaveClass(/\bon\b/);
    await expect(page.locator('#fxDay')).toHaveValue('15');
    await page.locator('#fxDay').fill('31');
    await page.locator('#fxAmt').fill('150');
    await page.locator('#fxSheet button[type=submit]').click();
    await expect(page.locator('#fxDay-err')).toHaveText('اختر يوماً من 1 إلى 28');
    await page.locator('#fxDay').fill('15'); // today: logged at once
    await page.locator('#fxSheet .chips button', { hasText: 'youtube premium' }).click();
    await page.locator('#fxNote').fill('اشتراك');
    await page.locator('#fxSheet button[type=submit]').click();
    await expect(page.locator('#toast')).toHaveText('أُضيف «youtube premium · اشتراك»: 150 ر.س يوم 15 من كل شهر');
    await expect(page.locator('#fxList .fx-row')).toHaveCount(1);
    let s = await stored(page);
    expect(s.fixed).toHaveLength(1);
    const gen = s.tx.find((x) => x.id.startsWith('fx-'));
    expect(gen).toMatchObject({ date: '2026-11-15', month: '2026-11', amount: 15000, note: 'اشتراك' });
    // pause
    await page.locator('#fxList [data-fxon]').uncheck();
    await expect(page.locator('#fxList .fx-row')).toHaveClass(/\boff\b/);
    s = await stored(page);
    expect(s.fixed[0].active).toBe(false);
    // delete, then undo
    await page.locator('#fxList [data-fxdel]').click();
    await expect(page.locator('#fxList .fx-row')).toHaveCount(0);
    await page.locator('#toast .t-act').click();
    await expect(page.locator('#fxList .fx-row')).toHaveCount(1);
    // the generated transaction shows in the month with the repeat icon
    await page.locator('#exRepBtn').click();
    await expect(page.locator('#exTxs .tx', { hasText: 'اشتراك' }).locator('.ic use')).toHaveAttribute('href', '#i-repeat');
  });

  test('payday month: «نوفمبر» becomes 27 Oct – 26 Nov, synced in the state, and re-files entries', async ({ page }) => {
    await seed(page);
    await page.locator('#exBudBtn').click(); // the month start lives in «الميزانية» since v1.8
    await expect(page.locator('#msDayW')).toBeHidden();
    await page.locator('[data-ms=payday]').click();
    await expect(page.locator('#toast')).toHaveText('صار الشهر يبدأ يوم 27');
    await expect(page.locator('#msDay')).toHaveValue('27');
    await expect(page.locator('#msRange')).toHaveText('شهر «نوفمبر» من 27 أكتوبر إلى 26 نوفمبر.');
    expect((await stored(page)).prefs.monthStart).toBe(27);
    // day 10: a period is named after the month holding most of its days → «نوفمبر» = 10 Nov – 9 Dec
    await page.locator('#msDay').selectOption('10');
    await expect(page.locator('#toast')).toHaveText('صار الشهر يبدأ يوم 10');
    await expect(page.locator('#msRange')).toHaveText('شهر «نوفمبر» من 10 نوفمبر إلى 9 ديسمبر.');
    await expect(page.locator('#mscroll button.on')).toHaveAttribute('data-m', '2026-11');
    await page.locator('[data-ms=first]').click();
    await expect(page.locator('#toast')).toHaveText('رجع الشهر يبدأ من أوله');
    await expect(page.locator('#mscroll button.on')).toHaveAttribute('data-m', '2026-11');
    expect((await stored(page)).prefs.monthStart).toBe(1);
  });

  test('home: a summary of the month above the tools; the feedback entry is a tools card', async ({ page }) => {
    await seed(page, { hash: '#home' });
    const sum = page.locator('#homeSum');
    await expect(sum).toBeVisible();
    await expect(sum).toContainText('مصاريف نوفمبر · متاح لك الآن');
    await expect(sum).toContainText('1,730.25');
    await expect(sum).toContainText('108 ر.س تقدر تصرفها يومياً');
    await expect(sum.locator('.card').nth(1).locator('.hs-row')).toHaveCount(2);
    await expect(sum.locator('.card').nth(2).locator('.hs-row')).toHaveCount(3);
    await expect(page.locator('.tools #fbOpen')).toBeVisible();
    await sum.locator('[data-quick=log]').click();
    await expect(page.locator('#logSheet')).toHaveClass(/\bon\b/);
  });

  test('inputs keep a visible focus ring', async ({ page }) => {
    await seed(page);
    await page.locator('#txQ').focus();
    const ring = await page.locator('#txQ').evaluate((e) => getComputedStyle(e).outlineStyle);
    expect(ring).toBe('solid');
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('Reports opens from the bottom bar; the PC-only pieces stay hidden; the tabs fit', async ({ page }) => {
    await seed(page);
    await expect(page.locator('#homeSum')).toBeHidden();
    await expect(page.locator('#exDaily')).toBeVisible(); // the daily allowance helps on a phone too
    await page.locator('#bNav [data-rep]').click(); // in the bottom bar since v1.8
    await expect(page.locator('#t-rep')).toBeVisible();
    await expect(page.locator('#t-sum')).toBeHidden();
    const fits = await page.locator('.tabs').evaluate((e) => e.scrollWidth <= e.clientWidth + 1);
    expect(fits).toBe(true);
    await page.locator('#fab').click();
    const box = await page.locator('#logSheet').boundingBox();
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(840); // still a bottom sheet
  });

  test('English tab labels never overlap', async ({ page }) => {
    await seed(page, { lang: 'en' });
    const boxes = await page.locator('.tabs button:visible').evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect(); return [r.left, r.right, e.scrollWidth <= e.clientWidth + 1];
    }));
    for (const [, , fits] of boxes) expect(fits).toBe(true);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i][0]).toBeGreaterThanOrEqual(boxes[i - 1][1] - 1);
  });

  test('welcome: a wrong salary is explained under the field', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ar-SA', viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto('./');
    const w = page.locator('#welcome');
    await w.locator('#wNext').click();
    await w.locator('#wSalary').fill('abc');
    await w.locator('#wNext').click();
    await expect(page.locator('#wSalary-err')).toHaveText('اكتب المبلغ بأرقام فقط، مثل 45 أو 12.50');
    await expect(page.locator('#wSalary')).toBeFocused();
    await ctx.close();
  });
});
