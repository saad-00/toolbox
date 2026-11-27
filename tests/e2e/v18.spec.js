import { test, expect } from '@playwright/test';

// v1.8: the salary question in the welcome, and the third row of mockups (setup steps, busy month,
// phone bar, past installment payments, budget suggestions and colours). Clock pinned to 15 Nov 2026.
async function seed(page, kind, { hash = '#expenses', lang = 'ar' } = {}) {
  await page.clock.setFixedTime(new Date('2026-11-15T10:00:00'));
  await page.goto('./');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(async ({ kind, lang }) => {
    const store = await import('./core/store.js');
    const m = await import('./core/model.js');
    const mo = await import('./core/months.js');
    const f = await import('./tests/fixtures/excel-nov-2026.js');
    let s;
    if (kind === 'fixture') s = f.fixture();
    else {
      s = m.createState(m.DEFAULT_CAT_KEYS);
      if (kind === 'busy') {
        mo.setIncome(s, '2026-11', 800000);
        for (const c of s.cats) mo.setBudget(s, '2026-11', c.id, 60000);
        for (let i = 0; i < 60; i++) m.addTx(s, { catId: s.cats[i % 9].id, amount: 1000 + i * 937, date: `2026-11-${String(1 + (i % 15)).padStart(2, '0')}` });
      } else if (kind === 'history') {
        mo.setIncome(s, '2026-11', 900000);
        for (const [d, a] of [['2026-08-05', 100000], ['2026-09-05', 200000], ['2026-10-05', 300000]]) m.addTx(s, { catId: 'cat.food', amount: a, date: d });
        m.addTx(s, { catId: 'cat.food', amount: 5000, date: '2026-11-03' });
      }
    }
    await store.saveState(s);
    await store.saveSettings({ lang, onboarded: true, lastBackupAt: Date.now() });
  }, { kind, lang });
  await page.goto(`./${hash}`);
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
}
const stored = (page) => page.evaluate(async () => (await import('./core/store.js')).loadState());

test.describe('welcome: «متى ينزل راتبك؟»', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('payday 27 by default, last day and any other day; the choice starts the month', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ar-SA', viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date('2026-11-15T10:00:00'));
    await page.goto('./');
    const w = page.locator('#welcome');
    await w.locator('#wNext').click();
    await expect(w.locator('input[name=payday]')).toHaveCount(4);
    await expect(w.locator('input[name=payday][value="27"]')).toBeChecked();
    await expect(w.locator('#wRange')).toHaveText('شهر «نوفمبر» يصير من 27 أكتوبر إلى 26 نوفمبر.');
    await w.locator('label', { hasText: 'آخر يوم في الشهر' }).click();
    await expect(w.locator('#wRange')).toHaveText('شهر «نوفمبر» يصير من 31 أكتوبر إلى 29 نوفمبر.');
    await w.locator('label', { hasText: 'يوم آخر' }).click();
    await expect(w.locator('#wDays button')).toHaveCount(28);
    await w.locator('#wDays button', { hasText: /^10$/ }).click();
    await expect(w.locator('#wRange')).toHaveText('شهر «نوفمبر» يصير من 10 نوفمبر إلى 9 ديسمبر.');
    await w.locator('#wSalary').fill('8000');
    await w.locator('#wNext').click();
    await w.locator('#wNext').click();
    await w.locator('#wFinish').click();
    await expect(page.locator('#app')).toBeVisible();
    const s = await stored(page);
    expect(s.prefs.monthStart).toBe(10);
    expect(s.months['2026-11'].income).toBe(800000); // the salary lands in the period that holds today
    await ctx.close();
  });

  test('«أول الشهر» keeps calendar months', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ar-SA', viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date('2026-11-15T10:00:00'));
    await page.goto('./');
    const w = page.locator('#welcome');
    await w.locator('#wNext').click();
    await w.locator('label', { hasText: 'أول الشهر' }).click();
    await expect(w.locator('#wRange')).toHaveText('شهر «نوفمبر» من 1 إلى 30 نوفمبر.');
    for (let i = 0; i < 2; i++) await w.locator('#wNext').click();
    await w.locator('#wFinish').click();
    await expect(page.locator('#app')).toBeVisible();
    expect((await stored(page)).prefs).toBeUndefined();
    await ctx.close();
  });
});

test.describe('PC', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the month start lives in «الميزانية», with «آخر يوم في الشهر»', async ({ page }) => {
    await seed(page, 'fixture');
    await page.locator('#exBudBtn').click();
    await expect(page.locator('#t-bud #msCard')).toBeVisible();
    await page.locator('[data-ms=payday]').click();
    await page.locator('#msDay').selectOption('31');
    await expect(page.locator('#msRange')).toHaveText('شهر «نوفمبر» من 31 أكتوبر إلى 29 نوفمبر.');
    expect((await stored(page)).prefs.monthStart).toBe(31);
  });

  test('a new account gets «ابدأ في 3 خطوات» instead of a board of zeros', async ({ page }) => {
    await seed(page, 'fresh');
    const card = page.locator('#exSetup');
    await expect(card).toBeVisible();
    await expect(card).toContainText('0 من 3');
    await card.locator('[data-setup=income]').click();
    await expect(page.locator('#t-bud')).toBeVisible();
    await expect(page.locator('#incIn')).toBeFocused();
    await page.locator('#incIn').fill('8000');
    await page.locator('#incIn').press('Tab');
    await page.locator('#exBudBtn').click(); // back to the board
    await expect(card).toContainText('1 من 3');
    await card.locator('[data-setup=split]').click();
    await expect(card).toContainText('2 من 3');
    const s = await stored(page);
    expect(s.months['2026-11'].budget['cat.housing']).toBe(240000);
    await card.locator('[data-setup=log]').click();
    await expect(page.locator('#logSheet')).toHaveClass(/\bon\b/);
    await page.locator('#logAmt').fill('20');
    await page.locator('#logSheet button[type=submit]').click();
    await expect(card).toBeHidden(); // all three done
  });

  test('«أكمل لاحقاً» hides the steps, and they stay hidden', async ({ page }) => {
    await seed(page, 'fresh');
    await page.locator('#exSetup [data-setup=later]').click();
    await expect(page.locator('#exSetup')).toBeHidden();
    await page.reload();
    await expect(page.locator('#exLeft')).toBeVisible();
    await expect(page.locator('#exSetup')).toBeHidden();
  });

  test('a busy month: the last 10 transactions, «عرض كل الحركات», and a category dropdown', async ({ page }) => {
    await seed(page, 'busy');
    await expect(page.locator('#exTxs .tx')).toHaveCount(10);
    await page.locator('#txMore').click();
    await expect(page.locator('#exTxs .tx')).toHaveCount(60);
    await page.locator('#txMore').click(); // «اعرض أقل»
    await expect(page.locator('#exTxs .tx')).toHaveCount(10);
    await page.locator('#txF').selectOption('cat.food');
    await expect(page.locator('#exTxs .tx')).toHaveCount(7); // a filter shows every match
    await page.locator('#txF').selectOption('all');
    await page.locator('#txQ').fill('الأكل');
    await expect(page.locator('#exTxs .tx')).toHaveCount(7);
  });

  test('overspent: «الأكثر تجاوزاً» names the worst three, «راجع الميزانية» opens the budget', async ({ page }) => {
    await seed(page, 'busy');
    const top = page.locator('#exTop .top-row');
    await expect(top).toHaveCount(3);
    await expect(top.first()).toContainText('الاشتراكات'); // 1,568.88 over: the largest in this data
    await page.locator('#exTop [data-tab=bud]').click();
    await expect(page.locator('#t-bud')).toBeVisible();
  });

  test('an installment that started in the past asks which payments were paid', async ({ page }) => {
    await seed(page, 'fresh');
    await page.locator('#exNewPlan').click();
    await expect(page.locator('#pPast')).toBeHidden(); // starts today: the usual «دفعت الدفعة الأولى»
    await expect(page.locator('#pFirst')).toBeVisible();
    await page.locator('#pMonthly').fill('200');
    await page.locator('#pN').fill('24');
    await page.locator('#pStart').fill('2026-03-10');
    await expect(page.locator('#pPast')).toBeVisible();
    await expect(page.locator('#pPast')).toContainText('هذا القسط بدأ قبل 8 أشهر');
    await expect(page.locator('#pFirst')).toBeHidden();
    await page.locator('#pPast input[value=some]').check();
    await expect(page.locator('#pPaidN')).toHaveText('9');
    for (let i = 0; i < 4; i++) await page.locator('#pPaidLess').click();
    await expect(page.locator('#pPaidN')).toHaveText('5');
    await page.locator('#planSheet button[type=submit]').click();
    let s = await stored(page);
    expect(s.plans[0].paid.filter(Boolean)).toHaveLength(5);
    // «نعم، دفعتها كلها» (the default) ticks all nine
    await page.locator('#exNewPlan').click();
    await page.locator('#pMonthly').fill('100');
    await page.locator('#pN').fill('24');
    await page.locator('#pStart').fill('2026-03-10');
    await page.locator('#planSheet button[type=submit]').click();
    s = await stored(page);
    expect(s.plans[1].paid.filter(Boolean)).toHaveLength(9);
  });

  test('budget: suggestions from the last 3 months, «استخدم كل الاقتراحات», and the totals line', async ({ page }) => {
    await seed(page, 'history');
    await page.locator('#exBudBtn').click();
    await expect(page.locator('#budSuggest')).toBeVisible();
    const row = page.locator('#exBuds .brow', { hasText: 'الأكل' });
    await expect(row).toContainText('متوسطك 2,000');
    await row.locator('[data-use]').click();
    await expect(row.locator('input[data-b]')).toHaveValue('2000');
    expect((await stored(page)).months['2026-11'].budget['cat.food']).toBe(200000);
    await expect(page.locator('#budTotal')).toContainText('وزّعت 2,000 من دخلك 9,000');
    await expect(page.locator('#budTotal')).toContainText('يبقى 7,000 ر.س بدون بند');
  });

  test('category colours: picked in the budget, shown in the summary and the transactions', async ({ page }) => {
    await seed(page, 'history');
    await page.locator('#exBudBtn').click();
    await page.locator('#exBuds .brow', { hasText: 'الأكل' }).locator('[data-color]').click();
    await page.locator('#colorPick [data-pick=orange]').click();
    expect((await stored(page)).cats.find((c) => c.id === 'cat.food').color).toBe('orange');
    await page.locator('#exBudBtn').click();
    await expect(page.locator('#exCats .cat', { hasText: 'الأكل' }).locator('.cdot')).toHaveClass(/\bc-orange\b/);
    await expect(page.locator('#exTxs .tx', { hasText: 'الأكل' }).first().locator('.ic')).toHaveClass(/\bc-orange\b/);
  });
});

test.describe('phone bar', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('+ sits in the middle of the bottom bar on every page, and «التقارير» is in the bar', async ({ page }) => {
    await seed(page, 'fixture', { hash: '#home' });
    const fab = page.locator('#bNav #fab');
    await expect(fab).toBeVisible();
    const b = await fab.boundingBox();
    expect(Math.abs(b.x + b.width / 2 - 195)).toBeLessThanOrEqual(6);
    await fab.click(); // from home: opens «سجّل صرف» on Expenses
    await expect(page).toHaveURL(/#expenses$/);
    await expect(page.locator('#logSheet')).toHaveClass(/\bon\b/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.tabs button[data-tab=rep]')).toBeHidden();
    await page.locator('#bNav [data-rep]').click();
    await expect(page.locator('#t-rep')).toBeVisible();
  });
});
