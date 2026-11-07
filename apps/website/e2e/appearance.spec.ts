import { expect, test } from '@playwright/test';
import { basePath } from '../scripts/site.config.mjs';

const storageKey = 'remoteai-website-theme';
const white = 'rgb(255, 255, 255)';
const black = 'rgb(9, 9, 11)';

test('defaults to white, and remembers dark across pages, languages and reloads', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  await expect(page.locator('html')).toHaveCSS('background-color', white);
  await page.getByRole('button', { name: '切换深色主题', exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('background-color', black);
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByText('探索功能').click();
  await expect(page.locator('html')).toHaveCSS('background-color', black);
  await page.reload();
  await expect(page.locator('html')).toHaveCSS('background-color', black);
  await page.locator('.language-switch summary').click();
  await page.getByRole('link', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch to white theme' })).toBeVisible();
  const otherPage = await context.newPage();
  await otherPage.goto(`${basePath}guide/`);
  await expect(otherPage.locator('html')).toHaveCSS('background-color', black);
  await page.getByRole('button', { name: 'Switch to white theme' }).click();
  await expect(page.locator('html')).toHaveCSS('background-color', white);
  await expect(otherPage.locator('html')).toHaveCSS('background-color', white);
  await otherPage.close();
});

test('saved white theme and readable controls render before React loads', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'light'), storageKey);
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('./');
  await expect(page.locator('html')).toHaveCSS('background-color', white);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ffffff');
  await expect(page.locator('.hero .ant-btn-primary')).toHaveCSS('color', white);
  await expect(page.locator('.hero .ant-btn-primary')).toHaveCSS('background-color', 'rgb(25, 25, 30)');
  await expect(page.locator('h1')).toBeVisible();
});

test('switching works when browser storage is blocked', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem']) {
      Object.defineProperty(Storage.prototype, method, {
        value: () => {
          throw new DOMException('Storage unavailable', 'SecurityError');
        },
      });
    }
  });
  await page.goto('./');
  await expect(page.locator('html')).toHaveCSS('background-color', white);
  await page.getByRole('button', { name: '切换深色主题', exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('background-color', black);
  await page.getByRole('button', { name: '切换纯白主题', exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('background-color', white);
  expect(errors).toEqual([]);
});

test('product previews support clicks and keyboard navigation with matching detail links', async ({ page }) => {
  await page.goto('./');
  const tabs = page.getByRole('tablist', { name: '产品演示' });
  await tabs.getByRole('tab', { name: '多账号管理' }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel).toHaveAccessibleName('多账号管理');
  await expect(panel.locator('img')).toHaveAttribute('src', /dashboard\.webp$/);
  await expect(panel.getByRole('link')).toHaveAttribute('href', `${basePath}features/accounts/`);
  await page.keyboard.press('ArrowRight');
  await expect(panel).toHaveAccessibleName('Token 用量分析');
  await page.keyboard.press('End');
  await expect(panel).toHaveAccessibleName('Dream Skin 主题');
  await page.keyboard.press('ArrowRight');
  await expect(panel).toHaveAccessibleName('Codex GUI');
  await page.keyboard.press('ArrowLeft');
  await expect(panel).toHaveAccessibleName('Dream Skin 主题');
  await page.keyboard.press('Home');
  await expect(panel).toHaveAccessibleName('Codex GUI');
});

test('white theme remains usable on narrow and tablet screens', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'light'), storageKey);
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const paths = [
      '', 'en/', 'ru/', 'features/', 'features/remote-workspace/', 'download/', 'ru/download/', 'guide/',
      'resources/', 'en/resources/', 'ru/resources/', 'ja/', 'ja/download/', 'ja/resources/',
    ];
    for (const path of paths) {
      await page.goto(`${basePath}${path}`);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('html')).toHaveCSS('background-color', white);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
      // Longer translated button labels must wrap, not push the block past the clipped section edge.
      const blocks = '.remote-copy .ant-btn, .download-card';
      const blocksFit = await page.evaluate(
        (selector) =>
          [...document.querySelectorAll(selector)].every((item) => item.getBoundingClientRect().right <= innerWidth),
        blocks,
      );
      expect(blocksFit, `${path} at ${width}px`).toBe(true);
    }
  }
});
