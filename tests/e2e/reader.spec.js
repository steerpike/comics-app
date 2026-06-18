const { test, expect } = require('@playwright/test');

test.describe('Comic reader', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#comic/xkcd/latest');
    // Wait for the comic image to appear (data loaded)
    await page.waitForSelector('.comic-view');
  });

  test('shows comic image', async ({ page }) => {
    await expect(page.locator('.comic-img-wrap img')).toBeVisible();
  });

  test('shows comic title', async ({ page }) => {
    await expect(page.locator('.comic-title')).not.toBeEmpty();
  });

  test('shows xkcd source name in header', async ({ page }) => {
    await expect(page.locator('#header-title')).toHaveText('xkcd');
  });

  test('back button is visible in reader', async ({ page }) => {
    await expect(page.locator('#header-back')).toBeVisible();
  });

  test('Prev button is disabled on latest comic', async ({ page }) => {
    await expect(page.locator('.comic-nav-btn:has-text("Prev")')).toHaveClass(/disabled/);
  });

  test('Next button navigates to next comic', async ({ page }) => {
    const initialTitle = await page.locator('.comic-title').textContent();
    await page.click('.comic-nav-btn:has-text("Next")');
    await expect(page.locator('.comic-title')).not.toHaveText(initialTitle);
  });

  test('clicking a source card from home loads its reader', async ({ page }) => {
    await page.goto('/');
    await page.click('.source-card[data-source="smbc"]');
    await page.waitForSelector('.comic-view');
    await expect(page.locator('#header-title')).toHaveText('SMBC');
  });

  test('shows alt text hint when alt is present', async ({ page }) => {
    // xkcd always has alt text
    await expect(page.locator('.comic-alt-hint')).toBeVisible();
  });

  test('tapping image reveals alt text', async ({ page }) => {
    await expect(page.locator('.comic-alt')).not.toHaveClass(/visible/);
    await page.click('.comic-img-wrap');
    await expect(page.locator('.comic-alt')).toHaveClass(/visible/);
  });

  test('tapping image again hides alt text', async ({ page }) => {
    await page.click('.comic-img-wrap');
    await page.click('.comic-img-wrap');
    await expect(page.locator('.comic-alt')).not.toHaveClass(/visible/);
  });
});

test.describe('Archive browser', () => {
  test('xkcd shows archive link', async ({ page }) => {
    await page.goto('/#comic/xkcd/latest');
    await page.waitForSelector('.comic-view');
    await expect(page.locator('.comic-nav-btn:has-text("Browse Archive")')).toBeVisible();
  });

  test('smbc has no archive link', async ({ page }) => {
    await page.goto('/#comic/smbc/latest');
    await page.waitForSelector('.comic-view');
    await expect(page.locator('.comic-nav-btn:has-text("Browse Archive")')).toHaveCount(0);
  });

  test('archive page loads and lists comics', async ({ page }) => {
    await page.goto('/#archive/xkcd/0');
    await page.waitForSelector('.archive-list');
    const items = page.locator('.archive-item');
    await expect(items).not.toHaveCount(0);
  });

  test('clicking archive item navigates to reader', async ({ page }) => {
    await page.goto('/#archive/xkcd/0');
    await page.waitForSelector('.archive-list');
    await page.click('.archive-item:first-child');
    await page.waitForSelector('.comic-view');
    await expect(page.locator('#header-title')).toHaveText('xkcd');
  });
});
