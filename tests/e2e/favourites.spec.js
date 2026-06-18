const { test, expect } = require('@playwright/test');

test.describe('Favourites', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('empty favourites shows prompt message', async ({ page }) => {
    await page.click('.nav-btn[data-route="favourites"]');
    await expect(page.locator('.fav-empty')).toBeVisible();
    await expect(page.locator('.fav-empty')).toContainText('No favourites yet');
  });

  test('can favourite a comic', async ({ page }) => {
    await page.goto('/#comic/xkcd/latest');
    await page.waitForSelector('.comic-view');
    await page.click('.comic-fav-btn');
    await expect(page.locator('.comic-fav-btn')).toHaveClass(/is-fav/);
    await expect(page.locator('.comic-fav-btn')).toContainText('Favourited');
  });

  test('can unfavourite a comic', async ({ page }) => {
    await page.goto('/#comic/xkcd/latest');
    await page.waitForSelector('.comic-view');
    await page.click('.comic-fav-btn');
    await page.click('.comic-fav-btn');
    await expect(page.locator('.comic-fav-btn')).not.toHaveClass(/is-fav/);
  });

  test('favourited comic appears in favourites list', async ({ page }) => {
    await page.goto('/#comic/xkcd/latest');
    await page.waitForSelector('.comic-view');
    await page.click('.comic-fav-btn');

    await page.click('.nav-btn[data-route="favourites"]');
    await expect(page.locator('.fav-item')).toHaveCount(1);
    await expect(page.locator('.fav-item-source')).toHaveText('xkcd');
  });

  test('favourites count shows correctly', async ({ page }) => {
    await page.goto('/#comic/xkcd/latest');
    await page.waitForSelector('.comic-view');
    await page.click('.comic-fav-btn');

    await page.click('.nav-btn[data-route="favourites"]');
    await page.waitForSelector('.fav-item');
    await expect(page.locator('.text-center.mb-half').last()).toContainText('1 favourite');
  });

  test('header star button navigates to favourites', async ({ page }) => {
    await page.click('#header-fav');
    await expect(page.locator('#header-title')).toHaveText('Favourites');
  });

  test('favourites persists across page reload', async ({ page }) => {
    await page.goto('/#comic/xkcd/latest');
    await page.waitForSelector('.comic-view');
    await page.click('.comic-fav-btn');

    await page.reload();
    await page.goto('/#comic/xkcd/latest');
    await page.waitForSelector('.comic-view');
    await expect(page.locator('.comic-fav-btn')).toHaveClass(/is-fav/);
  });
});
