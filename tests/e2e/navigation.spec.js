const { test, expect } = require('@playwright/test');

test.describe('Home screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows all 9 comic sources', async ({ page }) => {
    const cards = page.locator('.source-card');
    await expect(cards).toHaveCount(9);
  });

  test('displays correct header title', async ({ page }) => {
    await expect(page.locator('#header-title')).toHaveText('Comics');
  });

  test('back button is hidden on home screen', async ({ page }) => {
    await expect(page.locator('#header-back')).toBeHidden();
  });

  test('home nav button is active', async ({ page }) => {
    await expect(page.locator('.nav-btn[data-route="home"]')).toHaveClass(/active/);
  });
});

test.describe('Bottom navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('navigates to Discover', async ({ page }) => {
    await page.click('.nav-btn[data-route="discover"]');
    await expect(page.locator('#header-title')).toHaveText('Discover');
    await expect(page.locator('.nav-btn[data-route="discover"]')).toHaveClass(/active/);
  });

  test('navigates to Favourites', async ({ page }) => {
    await page.click('.nav-btn[data-route="favourites"]');
    await expect(page.locator('#header-title')).toHaveText('Favourites');
  });

  test('navigates to Random', async ({ page }) => {
    await page.click('.nav-btn[data-route="random"]');
    // Random immediately redirects to a comic; header should not be "Comics"
    await expect(page.locator('#header-title')).not.toHaveText('Comics');
  });

  test('Home button returns from discover', async ({ page }) => {
    await page.click('.nav-btn[data-route="discover"]');
    await page.click('.nav-btn[data-route="home"]');
    await expect(page.locator('#header-title')).toHaveText('Comics');
  });
});

test.describe('Hash routing', () => {
  test('direct hash navigation to xkcd loads reader', async ({ page }) => {
    await page.goto('/#comic/xkcd/latest');
    await expect(page.locator('#header-title')).toHaveText('xkcd');
  });

  test('direct hash navigation to discover works', async ({ page }) => {
    await page.goto('/#discover');
    await expect(page.locator('#header-title')).toHaveText('Discover');
  });

  test('unknown hash falls back to home', async ({ page }) => {
    await page.goto('/#notarealroute');
    await expect(page.locator('#header-title')).toHaveText('Comics');
  });
});
