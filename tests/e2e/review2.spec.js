import { test, expect } from '@playwright/test';

// Second design review: the bugs found with an empty account, an overspent heavy month and the
// in-between laptop widths. Clock pinned to 15 Nov 2026.
async function seed(page, kind, { hash = '#expenses', lang = 'ar' } = {}) {
  await page.clock.setFixedTime(new Date('2026-11-15T10:00:00'));
  await page.goto('./');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(async ({ kind, lang }) => {
    const store = await import('./core/store.js');
    const m = await import('./core/model.js');
    const mo = await import('./core/months.js');
    const ins = await import('./tools/expenses/installments.js');
    const f = await import('./tests/fixtures/excel-nov-2026.js');
    let s;
    if (kind === 'fixture') s = f.fixture();
    else {
      s = m.createState(m.DEFAULT_CAT_KEYS);
      if (kind === 'overspent') {
        mo.setIncome(s, '2026-11', 800000);
        m.addTx(s, { catId: s.cats[0].id, amount: 1718490, date: '2026-11-10' });
      } else if (kind === 'longCat') {
        const c = m.addCategory(s, 'مصاريف المدرسة والمواصلات والدروس الخصوصية للأولاد');
        mo.setIncome(s, '2026-11', 800000);
        // all ten rows have a budget, so the long one (last) lands in the second column, where it overflowed
        for (const x of s.cats) mo.setBudget(s, '2026-11', x.id, 10000);
        m.addTx(s, { catId: c, amount: 147148, date: '2026-11-03' });
      } else if (kind === 'oldPlan') {
        ins.addPlan(s, { provider: 'tabby', item: 'جوال', total: 480000, n: 24, start: '2026-03-10', firstPaid: true });
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
const FRESH = 'fresh';
const FIXTURE = 'fixture';
const OVERSPENT = 'overspent';
const LONG_CAT = 'longCat';
const OLD_PLAN = 'oldPlan';

// x of the first character matching `ch` inside el (visual position, after bidi reordering)
const charX = (page, sel, ch) => page.locator(sel).evaluate((el, ch) => {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const i = n.data.indexOf(ch);
    if (i < 0) continue;
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
    return r.getBoundingClientRect().left;
  }
  return null;
}, ch);

test.describe('PC', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('overspent: the minus sign stays in front of the number, and the hero warns', async ({ page }) => {
    await seed(page, OVERSPENT);
    await expect(page.locator('#exLeft')).toContainText('9,184.90');
    expect(await charX(page, '#exLeft', '-')).toBeLessThan(await charX(page, '#exLeft', '9'));
    await expect(page.locator('#exHero')).toHaveClass(/\bneg\b/);
    await expect(page.locator('#exDaily')).toContainText('تجاوزت دخلك بـ 9,184.90 ر.س');
  });

  test('a long category name never pushes its status out of the card', async ({ page }) => {
    await seed(page, LONG_CAT);
    // the status text must fit its own box (a squeezed box let the unwrapped text spill past the card)
    const st = page.locator('#exCats .cat', { hasText: 'مصاريف المدرسة' }).locator('.st');
    await expect(st).toContainText('تجاوز بـ 1,371.48');
    expect(await st.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    const card = await page.locator('#t-sum > .card:not(.hero)').boundingBox();
    const textLeft = await st.evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().left; });
    expect(textLeft).toBeGreaterThanOrEqual(card.x);
  });

  test('a new account: hints name what is on screen, and categories without a budget say how to set one', async ({ page }) => {
    await seed(page, FRESH);
    await expect(page.locator('#exNew')).toBeVisible();
    await expect(page.locator('#exNew')).not.toContainText('تبويب');
    await expect(page.locator('#exTxs')).not.toContainText('زر +');
    await expect(page.locator('#exCats')).toContainText('حدّد ميزانية البنود');
    await page.locator('#exCats [data-tab=bud]').click();
    await expect(page.locator('#t-bud')).toBeVisible();
  });

  test('«أقرب قسط» shows the next payment, not one from months ago, and offers to tick the old ones', async ({ page }) => {
    await seed(page, OLD_PLAN);
    const card = page.locator('#exNextCard');
    await expect(card).toContainText('دفعة 10 من 24 · بعد 25 يوماً'); // 10 Dec
    await expect(card).not.toContainText('متأخر');
    await expect(card.locator('.nx-late')).toContainText('8 دفعات');
    await card.locator('[data-latepaid]').click();
    let s = await stored(page);
    expect(s.plans[0].paid.slice(0, 10)).toEqual([true, true, true, true, true, true, true, true, true, false]);
    await expect(card.locator('.nx-late')).toHaveCount(0);
    await page.locator('#toast .t-act').click(); // «تراجع»
    await expect(card.locator('.nx-late')).toContainText('8 دفعات');
    s = await stored(page);
    expect(s.plans[0].paid.slice(0, 10)).toEqual([true, false, false, false, false, false, false, false, false, false]);
  });
});

test('laptop widths: the header actions stay together on one row', async ({ page }) => {
  for (const width of [1180, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    if (width === 1180) await seed(page, FIXTURE);
    // same row = same vertical centre (the buttons differ in height)
    const mid = async (sel) => { const b = await page.locator(sel).boundingBox(); return Math.round(b.y + b.height / 2); };
    expect(Math.abs(await mid('#exLog') - await mid('#mToday'))).toBeLessThanOrEqual(2);
    expect(Math.abs(await mid('#exLog') - await mid('#exBudBtn'))).toBeLessThanOrEqual(2);
  }
});

test('phone: opening Expenses directly shows the current month in the strip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, OLD_PLAN); // a 24-month plan makes the strip much wider than the screen
  await expect(page.locator('#mscroll button.on')).toHaveAttribute('data-m', '2026-11');
  await expect.poll(() => page.evaluate(() => {
    const sc = document.querySelector('#mscroll').getBoundingClientRect();
    const on = document.querySelector('#mscroll .on').getBoundingClientRect();
    return on.left >= sc.left && on.right <= sc.right;
  })).toBe(true);
});
