import { test, expect } from '@playwright/test';

// Wide-screen dashboard (docs/superpowers/specs/2026-11-19-desktop-dashboard-design.md):
// from 1360px the content fills the width, the summary is a row of figure cards plus three
// cards side by side, and «سجّل صرف» moves from the floating button into the header.
async function seed(page) {
  await page.clock.setFixedTime(new Date('2026-11-15T10:00:00'));
  await page.goto('./');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.evaluate(async () => {
    const store = await import('./core/store.js');
    const f = await import('./tests/fixtures/excel-nov-2026.js');
    await store.saveState(f.fixture());
    await store.saveSettings({ lang: 'ar', onboarded: true });
    location.hash = '#expenses';
  });
  await page.reload();
  await expect(page.locator('#exLeft')).toBeVisible();
}

test.describe('1920×1080', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('content fills the width and the summary is a dashboard', async ({ page }) => {
    await seed(page);
    const main = await page.locator('main').boundingBox();
    expect(main.width).toBeGreaterThan(1600); // was capped at 1100px

    // «الباقي الحالي» and the four figures share one row, as separate cards.
    const hero = await page.locator('#exHero .hero-main').boundingBox();
    const figs = await page.locator('#exHero .figs > div').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    expect(figs).toHaveLength(4);
    for (const top of figs) expect(Math.abs(top - hero.y)).toBeLessThan(2);

    // البنود, آخر الحركات and this month's installments sit side by side under it.
    const cards = await page.locator('#t-sum > .card:not(#exHero)').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    expect(cards).toHaveLength(3);
    expect(new Set(cards.map(Math.round)).size).toBe(1);
    expect(cards[0]).toBeGreaterThan(hero.y + hero.height);

    await expect(page.locator('#exRecent .tx')).toHaveCount(5); // all of November's tx (≤ 6)
    await expect(page.locator('#exRecent [data-del]')).toHaveCount(0); // read-only
    await expect(page.locator('#exDueMini .tx')).toHaveCount(2);
    await expect(page.locator('#exDueMini input')).toHaveCount(0); // paying stays in its tab
  });

  test('header button replaces the floating button; «عرض الكل» opens the tab', async ({ page }) => {
    await seed(page);
    await expect(page.locator('#fab')).toBeHidden();
    await page.locator('#mLog').click();
    await expect(page.locator('#logSheet')).toHaveClass(/\bon\b/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#logSheet')).not.toHaveClass(/\bon\b/);

    await page.locator('#t-sum [data-tab="tx"]').click();
    await expect(page.locator('#t-tx')).toBeVisible();
    await expect(page.locator('.tabs [data-tab="tx"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('home and settings fill the width', async ({ page }) => {
    await seed(page);
    await page.goto('./#home');
    const tool = await page.locator('.tool[data-tool="expenses"]').boundingBox();
    const tools = await page.locator('.tools').boundingBox();
    expect(tool.width).toBeGreaterThan(tools.width * 0.45); // spans two of four columns
    const fb = await page.locator('#fbOpen').boundingBox();
    expect(fb.width).toBeGreaterThan(1500); // was capped at 560px
  });
});

test('1280px keeps the existing layout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seed(page);
  await expect(page.locator('#fab')).toBeVisible();
  await expect(page.locator('#mLog')).toBeHidden();
  await expect(page.locator('#exRecent')).toBeHidden();
  const main = await page.locator('main').boundingBox();
  expect(main.width).toBeLessThanOrEqual(1100);
});
